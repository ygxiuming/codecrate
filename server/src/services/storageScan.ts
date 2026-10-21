import fs from 'node:fs';
import path from 'node:path';
import { findRemotePlatform, findVSCodePlatform } from '../adapters/platforms';
import { config } from '../config';
import { getDb } from '../db';
import { ApiError } from '../http/errors';
import { hashFile, resolveWithin, toRelative } from '../storage/paths';
import { isExtensionVersion, isValidVSCodeVersion } from '../utils/semver';
import { saveIcon } from './icons';
import { inspectServerArchive } from './serverArchive';
import { parseVsix } from './vsix';

export interface TypeCounts {
  vscode: number;
  extensions: number;
  remoteServers: number;
}

export interface StorageScanResult {
  scannedFiles: number;
  added: TypeCounts;
  updated: TypeCounts;
  removed: TypeCounts;
  skipped: number;
  errors: string[];
  durationMs: number;
}

interface FileEntry {
  absolute: string;
  relative: string;
  segments: string[];
  size: number;
}

interface DbFileRow {
  id: number;
  stored_path: string;
  size_bytes: number;
  icon_path?: string | null;
}

let scanning = false;

function emptyCounts(): TypeCounts {
  return { vscode: 0, extensions: 0, remoteServers: 0 };
}

export function isStorageScanRunning(): boolean {
  return scanning;
}

async function collectFiles(
  rootName: string,
  maxDepth: number,
): Promise<FileEntry[]> {
  const root = path.join(config.storageDir, rootName);
  const files: FileEntry[] = [];

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (error) {
      // 根目录不可读时中止扫描，避免把临时故障误判为“文件已删除”。
      if (depth === 0 && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name.startsWith('.') || entry.name.endsWith('.part')) continue;
      try {
        const stats = await fs.promises.stat(absolute);
        const relative = toRelative(absolute);
        files.push({
          absolute,
          relative,
          segments: relative.split('/').slice(1),
          size: stats.size,
        });
      } catch {
        // 扫描期间文件被移除时忽略
      }
    }
  };

  await walk(root, 0);
  return files;
}

function extractBuildTime(filename: string): string | null {
  const match = filename.match(/-(\d{10})(?=[._-]|$)/);
  if (!match) return null;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds < 1_000_000_000) return null;
  return new Date(seconds * 1000).toISOString();
}

function knownCommit(version: string): string | null {
  const db = getDb();
  const local = db
    .prepare(
      'SELECT commit_hash FROM vscode_packages WHERE version = ? AND commit_hash IS NOT NULL ORDER BY id DESC LIMIT 1',
    )
    .get(version) as { commit_hash: string } | undefined;
  if (local) return local.commit_hash;
  const remote = db
    .prepare(
      'SELECT commit_hash FROM remote_servers WHERE version = ? ORDER BY id DESC LIMIT 1',
    )
    .get(version) as { commit_hash: string } | undefined;
  return remote?.commit_hash ?? null;
}

async function scanVSCode(
  files: FileEntry[],
  result: StorageScanResult,
  recordError: (message: string) => void,
): Promise<void> {
  const db = getDb();
  const rows = db
    .prepare('SELECT id, stored_path, size_bytes FROM vscode_packages')
    .all() as DbFileRow[];
  const byPath = new Map(rows.map((row) => [row.stored_path, row]));
  const seen = new Set<string>();

  for (const file of files) {
    const parts = file.segments;
    const flexible = parts.length === 3;
    const channel = flexible ? 'stable' : parts[0];
    const version = flexible ? parts[0] : parts[1];
    const platform = flexible ? parts[1] : parts[2];
    const filename = parts[parts.length - 1];

    if (channel !== 'stable') {
      recordError(`跳过 ${file.relative}：仅支持 stable 渠道`);
      result.skipped += 1;
      continue;
    }
    if (!isValidVSCodeVersion(version) || !findVSCodePlatform(platform)) {
      recordError(`跳过 ${file.relative}：无法从路径识别版本或平台`);
      result.skipped += 1;
      continue;
    }
    const key = `${channel}/${version}/${platform}`;
    if (seen.has(key)) {
      recordError(`跳过 ${file.relative}：同一版本与平台存在重复文件`);
      result.skipped += 1;
      continue;
    }
    seen.add(key);

    const existing = byPath.get(file.relative);
    if (existing && existing.size_bytes === file.size) continue;

    try {
      const sha256 = await hashFile(file.absolute);
      const commitHash = knownCommit(version);
      const buildTime = extractBuildTime(filename);
      const conflict = db
        .prepare(
          'SELECT id FROM vscode_packages WHERE channel = ? AND version = ? AND platform = ?',
        )
        .get(channel, version, platform) as { id: number } | undefined;

      db.prepare(
        `INSERT INTO vscode_packages
          (channel, version, platform, filename, stored_path, size_bytes, sha256, commit_hash, build_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(channel, version, platform) DO UPDATE SET
           filename = excluded.filename,
           stored_path = excluded.stored_path,
           size_bytes = excluded.size_bytes,
           sha256 = excluded.sha256,
           commit_hash = COALESCE(excluded.commit_hash, vscode_packages.commit_hash),
           build_time = COALESCE(excluded.build_time, vscode_packages.build_time),
           verified_at = NULL`,
      ).run(
        channel,
        version,
        platform,
        filename,
        file.relative,
        file.size,
        sha256,
        commitHash,
        buildTime,
      );

      if (conflict || existing) result.updated.vscode += 1;
      else result.added.vscode += 1;
    } catch (error) {
      recordError(`无法导入 ${file.relative}：${(error as Error).message}`);
    }
  }
}

async function scanRemoteServers(
  files: FileEntry[],
  result: StorageScanResult,
  recordError: (message: string) => void,
): Promise<void> {
  const db = getDb();
  const rows = db
    .prepare('SELECT id, stored_path, size_bytes FROM remote_servers')
    .all() as DbFileRow[];
  const byPath = new Map(rows.map((row) => [row.stored_path, row]));
  const seen = new Set<string>();

  for (const file of files) {
    const parts = file.segments;
    const filename = parts[parts.length - 1];
    let version = parts[0] ?? '';
    let commit = (parts[1] ?? '').toLowerCase();
    let platform = parts[2] ?? '';

    const standard =
      parts.length === 4 &&
      isValidVSCodeVersion(version) &&
      /^[0-9a-f]{40}$/.test(commit) &&
      Boolean(findRemotePlatform(platform));

    if (!standard) {
      try {
        const info = await inspectServerArchive(file.absolute);
        if (info?.version) version = info.version;
        if (info?.commit) commit = info.commit;
        if (!platform) {
          const match = filename.match(/^vscode-server-(.+)\.(?:tar\.gz|tgz|zip)$/i);
          platform = match?.[1] ?? '';
        }
      } catch (error) {
        recordError(`无法解析 ${file.relative}：${(error as Error).message}`);
        result.skipped += 1;
        continue;
      }
    }

    if (!isValidVSCodeVersion(version) || !/^[0-9a-f]{40}$/.test(commit)) {
      recordError(`跳过 ${file.relative}：无法识别版本或 commit`);
      result.skipped += 1;
      continue;
    }
    if (!findRemotePlatform(platform)) {
      recordError(`跳过 ${file.relative}：无法识别 server 平台`);
      result.skipped += 1;
      continue;
    }
    const key = `${version}/${platform}`;
    if (seen.has(key)) {
      recordError(`跳过 ${file.relative}：同一版本与平台存在重复文件`);
      result.skipped += 1;
      continue;
    }
    seen.add(key);

    const existing = byPath.get(file.relative);
    if (existing && existing.size_bytes === file.size) continue;

    try {
      const sha256 = await hashFile(file.absolute);
      const conflict = db
        .prepare('SELECT id FROM remote_servers WHERE version = ? AND platform = ?')
        .get(version, platform) as { id: number } | undefined;
      db.prepare(
        `INSERT INTO remote_servers
          (version, commit_hash, platform, filename, stored_path, size_bytes, sha256)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(version, platform) DO UPDATE SET
           commit_hash = excluded.commit_hash,
           filename = excluded.filename,
           stored_path = excluded.stored_path,
           size_bytes = excluded.size_bytes,
           sha256 = excluded.sha256,
           verified_at = NULL`,
      ).run(
        version,
        commit,
        platform,
        filename,
        file.relative,
        file.size,
        sha256,
      );
      if (conflict || existing) result.updated.remoteServers += 1;
      else result.added.remoteServers += 1;
    } catch (error) {
      recordError(`无法导入 ${file.relative}：${(error as Error).message}`);
    }
  }
}

async function scanExtensions(
  files: FileEntry[],
  result: StorageScanResult,
  recordError: (message: string) => void,
): Promise<void> {
  const db = getDb();
  const rows = db
    .prepare('SELECT id, stored_path, size_bytes FROM extensions')
    .all() as DbFileRow[];
  const byPath = new Map(rows.map((row) => [row.stored_path, row]));
  const seen = new Set<string>();

  for (const file of files) {
    const parts = file.segments;
    if (parts.length !== 4 || !/\.vsix$/i.test(parts[3])) {
      recordError(`跳过 ${file.relative}：扩展目录结构应为 <publisher>/<name>/<version>/<file>.vsix`);
      result.skipped += 1;
      continue;
    }
    const folder = parts[2];
    const at = folder.lastIndexOf('@');
    const version = at >= 0 ? folder.slice(0, at) : folder;
    const targetPlatform = at >= 0 ? folder.slice(at + 1) : '';
    if (!isExtensionVersion(version)) {
      recordError(`跳过 ${file.relative}：版本目录 ${folder} 不合法`);
      result.skipped += 1;
      continue;
    }

    const existing = byPath.get(file.relative);
    if (existing && existing.size_bytes === file.size) continue;

    try {
      const parsed = await parseVsix(file.absolute);
      const metadata = parsed.metadata;
      const key = `${metadata.extensionId}/${metadata.version}/${targetPlatform}`;
      if (seen.has(key)) {
        recordError(`跳过 ${file.relative}：同一插件版本与平台存在重复文件`);
        result.skipped += 1;
        continue;
      }
      seen.add(key);

      const sha256 = await hashFile(file.absolute);
      const conflict = db
        .prepare(
          'SELECT id FROM extensions WHERE extension_id = ? AND version = ? AND target_platform = ?',
        )
        .get(metadata.extensionId, metadata.version, targetPlatform) as
        | { id: number }
        | undefined;

      let iconPath: string | null = null;
      if (parsed.icon) {
        iconPath = await saveIcon(parsed.icon.data, path.extname(parsed.icon.filename).slice(1));
      }

      const run = db.transaction(() => {
        const upsert = db.prepare(
          `INSERT INTO extensions
            (extension_id, publisher, name, display_name, version, target_platform, description,
             engine_range, categories, keywords, dependencies, extension_pack, icon_path, source,
             license, repository_url, homepage, filename, stored_path, size_bytes, sha256, published_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(extension_id, version, target_platform) DO UPDATE SET
             display_name = excluded.display_name,
             description = excluded.description,
             engine_range = excluded.engine_range,
             categories = excluded.categories,
             keywords = excluded.keywords,
             dependencies = excluded.dependencies,
             extension_pack = excluded.extension_pack,
             icon_path = COALESCE(excluded.icon_path, extensions.icon_path),
             source = excluded.source,
             license = excluded.license,
             repository_url = excluded.repository_url,
             homepage = excluded.homepage,
             filename = excluded.filename,
             stored_path = excluded.stored_path,
             size_bytes = excluded.size_bytes,
             sha256 = excluded.sha256,
             verified_at = NULL
           RETURNING id`,
        ).get(
          metadata.extensionId,
          metadata.publisher,
          metadata.name,
          metadata.displayName,
          metadata.version,
          targetPlatform,
          metadata.description,
          metadata.engineRange ?? null,
          JSON.stringify(metadata.categories),
          JSON.stringify(metadata.keywords),
          JSON.stringify(metadata.dependencies),
          JSON.stringify(metadata.extensionPack),
          iconPath,
          'scan',
          metadata.license ?? null,
          metadata.repositoryUrl ?? null,
          metadata.homepage ?? null,
          parts[3],
          file.relative,
          file.size,
          sha256,
          null,
        ) as { id: number };
        db.prepare('DELETE FROM extension_categories WHERE extension_pk = ?').run(upsert.id);
        const insertCategory = db.prepare(
          'INSERT OR IGNORE INTO extension_categories (extension_pk, category) VALUES (?, ?)',
        );
        for (const category of metadata.categories) insertCategory.run(upsert.id, category);
      });
      run();
      if (conflict || existing) result.updated.extensions += 1;
      else result.added.extensions += 1;
    } catch (error) {
      recordError(`无法导入 ${file.relative}：${(error as Error).message}`);
    }
  }
}

async function removeMissing(
  result: StorageScanResult,
  recordError: (message: string) => void,
): Promise<void> {
  const db = getDb();
  const removeRows = async (
    table: 'vscode_packages' | 'extensions' | 'remote_servers',
    type: keyof TypeCounts,
  ): Promise<void> => {
    const rows = db
      .prepare(`SELECT id, stored_path, ${table === 'extensions' ? 'icon_path' : 'NULL AS icon_path'} FROM ${table}`)
      .all() as DbFileRow[];
    for (const row of rows) {
      let exists = false;
      try {
        exists = fs.existsSync(resolveWithin(row.stored_path));
      } catch {
        exists = false;
      }
      if (exists) continue;
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(row.id);
      if (table === 'extensions' && row.icon_path) {
        const shared = db
          .prepare('SELECT 1 AS hit FROM extensions WHERE icon_path = ? LIMIT 1')
          .get(row.icon_path) as { hit: number } | undefined;
        if (!shared) {
          try {
            fs.unlinkSync(resolveWithin(row.icon_path));
          } catch {
            // 图标可能已被删除
          }
        }
      }
      result.removed[type] += 1;
    }
  };

  try {
    await removeRows('vscode_packages', 'vscode');
    await removeRows('extensions', 'extensions');
    await removeRows('remote_servers', 'remoteServers');
  } catch (error) {
    recordError(`清理失效索引失败：${(error as Error).message}`);
  }
}

/**
 * 扫描 data/files 下的 vscode、remote-server 与 extensions 目录：
 * - 目录中新增的文件写入索引；
 * - 已存在文件大小变化时重算 SHA256 并更新；
 * - 文件被直接删除时移除对应索引。
 */
export async function scanStorage(): Promise<StorageScanResult> {
  if (scanning) {
    throw new ApiError(409, 'SCAN_RUNNING', '缓存目录扫描正在进行，请稍后再试');
  }
  if (!fs.existsSync(config.storageDir)) {
    throw new ApiError(500, 'STORAGE_UNAVAILABLE', '存储目录不可访问，已中止扫描');
  }
  scanning = true;
  const started = Date.now();
  const result: StorageScanResult = {
    scannedFiles: 0,
    added: emptyCounts(),
    updated: emptyCounts(),
    removed: emptyCounts(),
    skipped: 0,
    errors: [],
    durationMs: 0,
  };
  const errors: string[] = [];
  const recordError = (message: string): void => {
    if (errors.length < 50) errors.push(message);
  };

  try {
    const vscodeFiles = await collectFiles('vscode', 8);
    const remoteFiles = await collectFiles('remote-server', 8);
    const extensionFiles = await collectFiles('extensions', 8);
    result.scannedFiles = vscodeFiles.length + remoteFiles.length + extensionFiles.length;

    await scanVSCode(vscodeFiles, result, recordError);
    await scanRemoteServers(remoteFiles, result, recordError);
    await scanExtensions(extensionFiles, result, recordError);
    await removeMissing(result, recordError);

    result.errors = errors;
    result.durationMs = Date.now() - started;
    return result;
  } finally {
    scanning = false;
  }
}
