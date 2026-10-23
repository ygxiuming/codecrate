import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { getDb, nowIso } from '../db';
import { ApiError } from '../http/errors';
import { hashFile, resolveWithin, toRelative } from '../storage/paths';
import { logger } from '../logger';
import { getSetting } from './settings';

export interface SoftwareScanResult {
  scannedFiles: number;
  added: number;
  updated: number;
  removed: number;
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

const SOFTWARE_ROOT = 'software';
/** 上传接口用「通用」占位空版本目录，扫描时视为空版本。 */
const GENERIC_VERSION_DIR = '通用';
const MAX_DEPTH = 5;
/** 单个说明文档上限，避免超大 md 拖慢扫描。 */
const MAX_SIDECAR_BYTES = 512 * 1024;

let scanning = false;

export function isSoftwareScanRunning(): boolean {
  return scanning;
}

async function collectSoftwareFiles(): Promise<FileEntry[]> {
  const root = path.join(config.storageDir, SOFTWARE_ROOT);
  const files: FileEntry[] = [];

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) return;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (error) {
      // 根目录不存在或不可读时直接返回，避免误判为“文件已删除”。
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

function isMarkdown(name: string): boolean {
  return /\.md$/i.test(name);
}

/** 同目录 readme.md / 说明.md 对该目录下所有安装包生效；<同名>.md 只对单个安装包生效。 */
function loadSidecars(files: FileEntry[]): Map<string, string> {
  const sidecars = new Map<string, string>();
  for (const file of files) {
    if (!isMarkdown(file.segments[file.segments.length - 1])) continue;
    if (file.size > MAX_SIDECAR_BYTES) continue;
    try {
      const content = fs.readFileSync(file.absolute, 'utf8').slice(0, 200_000);
      const dir = file.segments.slice(0, -1).join('/');
      const base = path.basename(file.relative, path.extname(file.relative)).toLowerCase();
      if (base === 'readme' || base === '说明') {
        sidecars.set(`dir:${dir}`, content);
      } else {
        sidecars.set(`file:${dir}/${base}`, content);
      }
    } catch {
      // 读取失败时忽略该说明文件
    }
  }
  return sidecars;
}

function sidecarFor(sidecars: Map<string, string>, file: FileEntry): string {
  const dir = file.segments.slice(0, -1).join('/');
  const base = path
    .basename(file.relative, path.extname(file.relative))
    .toLowerCase();
  const own = sidecars.get(`file:${dir}/${base}`);
  if (own) return own;
  return sidecars.get(`dir:${dir}`) ?? '';
}

interface ParsedLocation {
  category: string;
  name: string;
  version: string;
}

function parseLocation(file: FileEntry, filename: string): ParsedLocation | null {
  const parts = file.segments;
  const stem = filename.replace(/\.[^.]+$/, '');
  if (parts.length === 1) return { category: '未分类', name: stem, version: '' };
  if (parts.length === 2) return { category: parts[0], name: stem, version: '' };
  if (parts.length === 3) return { category: parts[0], name: parts[1], version: '' };
  if (parts.length === 4) {
    return {
      category: parts[0],
      name: parts[1],
      version: parts[2] === GENERIC_VERSION_DIR ? '' : parts[2],
    };
  }
  return null;
}

function scanSoftwarePackages(
  files: FileEntry[],
  result: SoftwareScanResult,
  recordError: (message: string) => void,
): Promise<void> {
  const db = getDb();
  const rows = db
    .prepare('SELECT id, stored_path, size_bytes FROM software_packages')
    .all() as Array<{ id: number; stored_path: string; size_bytes: number }>;
  const byPath = new Map(rows.map((row) => [row.stored_path, row]));
  const sidecars = loadSidecars(files);
  const seen = new Set<string>();

  const insert = db.prepare(
    `INSERT INTO software_packages
      (name, version, platform, category, description_md, filename, stored_path, size_bytes, sha256, source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scan', ?)
     ON CONFLICT(stored_path) DO UPDATE SET
       filename = excluded.filename,
       size_bytes = excluded.size_bytes,
       sha256 = excluded.sha256,
       verified_at = NULL,
       updated_at = excluded.updated_at`,
  );

  return (async () => {
    for (const file of files) {
      const filename = file.segments[file.segments.length - 1];
      if (isMarkdown(filename)) continue;
      const location = parseLocation(file, filename);
      if (!location) {
        recordError(`跳过 ${file.relative}：目录层级过深，应为 <分类>/<软件名>/<版本>/<文件>`);
        result.skipped += 1;
        continue;
      }
      const key = file.relative;
      if (seen.has(key)) {
        result.skipped += 1;
        continue;
      }
      seen.add(key);

      const existing = byPath.get(file.relative);
      if (existing && existing.size_bytes === file.size) continue;

      try {
        const sha256 = await hashFile(file.absolute);
        const description = existing ? undefined : sidecarFor(sidecars, file);
        const info = insert.run(
          location.name,
          location.version,
          '',
          location.category,
          description ?? '',
          filename,
          file.relative,
          file.size,
          sha256,
          nowIso(),
        );
        if (info.changes > 0) {
          if (existing) result.updated += 1;
          else result.added += 1;
        }
      } catch (error) {
        recordError(`无法导入 ${file.relative}：${(error as Error).message}`);
      }
    }
  })();
}

function removeMissingSoftware(result: SoftwareScanResult): void {
  const db = getDb();
  const rows = db
    .prepare("SELECT id, stored_path FROM software_packages WHERE stored_path LIKE 'software/%'")
    .all() as Array<{ id: number; stored_path: string }>;
  for (const row of rows) {
    let exists = false;
    try {
      exists = fs.existsSync(resolveWithin(row.stored_path));
    } catch {
      exists = false;
    }
    if (exists) continue;
    db.prepare('DELETE FROM software_packages WHERE id = ?').run(row.id);
    result.removed += 1;
  }
}

/**
 * 扫描 data/files/software 目录：
 * - 约定 <分类>/<软件名>/<版本>/<安装包文件>，兼容 1~3 层浅目录；
 * - 同目录 readme.md / 说明.md 或 <同名>.md 作为安装包说明导入；
 * - 已存在文件大小变化时重算 SHA256；文件被删除时移除索引（说明编辑不受影响）。
 */
export async function scanSoftware(): Promise<SoftwareScanResult> {
  if (scanning) {
    throw new ApiError(409, 'SCAN_RUNNING', '软件包目录扫描正在进行，请稍后再试');
  }
  scanning = true;
  const started = Date.now();
  const result: SoftwareScanResult = {
    scannedFiles: 0,
    added: 0,
    updated: 0,
    removed: 0,
    skipped: 0,
    errors: [],
    durationMs: 0,
  };
  const errors: string[] = [];
  const recordError = (message: string): void => {
    if (errors.length < 50) errors.push(message);
  };

  try {
    const files = await collectSoftwareFiles();
    result.scannedFiles = files.length;
    await scanSoftwarePackages(files, result, recordError);
    removeMissingSoftware(result);
    result.errors = errors;
    result.durationMs = Date.now() - started;
    return result;
  } finally {
    scanning = false;
  }
}

const CHECK_INTERVAL_MS = 60 * 1000;

/** 周期自动扫描：间隔 software.scan_interval_minutes（0 = 关闭自动扫描）。 */
export function startSoftwareScanJob(): () => void {
  let stopped = false;
  let lastScanAt = 0;

  const tick = (): void => {
    if (stopped) return;
    const intervalMinutes = Number(getSetting<number>('software.scan_interval_minutes')) || 0;
    if (intervalMinutes > 0 && Date.now() - lastScanAt >= intervalMinutes * 60 * 1000) {
      lastScanAt = Date.now();
      void scanSoftware().catch((error) => {
        if ((error as ApiError).code !== 'SCAN_RUNNING') {
          logger.warn({ err: error }, '软件包自动扫描失败');
        }
      });
    }
    timer = setTimeout(tick, CHECK_INTERVAL_MS);
    timer.unref();
  };

  let timer: NodeJS.Timeout | null = null;
  timer = setTimeout(tick, CHECK_INTERVAL_MS);
  timer.unref();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
  };
}
