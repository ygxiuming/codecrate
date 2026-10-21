import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { getDb } from '../db';

export interface TypeUsage {
  count: number;
  bytes: number;
}

export interface StorageUsage {
  artifacts: {
    vscode: TypeUsage;
    extensions: TypeUsage;
    remoteServers: TypeUsage;
    total: TypeUsage;
  };
  disk: {
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
  };
  temp: {
    count: number;
    bytes: number;
  };
}

function sumTable(table: 'vscode_packages' | 'extensions' | 'remote_servers'): TypeUsage {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS bytes FROM ${table}`)
    .get() as { count: number; bytes: number };
  return { count: row.count, bytes: row.bytes };
}

async function walkFiles(
  dir: string,
  visit: (absolutePath: string, stats: fs.Stats) => Promise<void>,
  depth = 0,
): Promise<void> {
  if (depth > 10) return;
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(absolute, visit, depth + 1);
    } else if (entry.isFile()) {
      try {
        const stats = await fs.promises.stat(absolute);
        await visit(absolute, stats);
      } catch {
        // 文件在遍历期间消失时忽略
      }
    }
  }
}

export async function getTempUsage(): Promise<{ count: number; bytes: number }> {
  let count = 0;
  let bytes = 0;
  await walkFiles(path.join(config.storageDir, 'tmp'), async (_file, stats) => {
    count += 1;
    bytes += stats.size;
  });
  return { count, bytes };
}

export async function getStorageUsage(): Promise<StorageUsage> {
  const vscode = sumTable('vscode_packages');
  const extensions = sumTable('extensions');
  const remoteServers = sumTable('remote_servers');
  const total = {
    count: vscode.count + extensions.count + remoteServers.count,
    bytes: vscode.bytes + extensions.bytes + remoteServers.bytes,
  };
  const stats = await fs.promises.statfs(config.storageDir);
  const blockSize = Number(stats.bsize);
  const totalBytes = Number(stats.blocks) * blockSize;
  const freeBytes = Number(stats.bavail) * blockSize;
  const temp = await getTempUsage();
  return {
    artifacts: { vscode, extensions, remoteServers, total },
    disk: { totalBytes, freeBytes, usedBytes: totalBytes - freeBytes },
    temp,
  };
}

/** 清理临时上传与超期未完成的 .part 分片。 */
export async function cleanupTempFiles(maxAgeMs = 24 * 60 * 60 * 1000): Promise<{
  removed: number;
  bytes: number;
}> {
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  let bytes = 0;
  const targets = [path.join(config.storageDir, 'tmp'), config.storageDir];
  const seen = new Set<string>();

  for (const target of targets) {
    await walkFiles(target, async (file, stats) => {
      if (seen.has(file)) return;
      seen.add(file);
      const isTemp = file.startsWith(path.join(config.storageDir, 'tmp') + path.sep);
      const isPartial = file.endsWith('.part');
      if (!isTemp && !isPartial) return;
      if (stats.mtimeMs > cutoff) return;
      try {
        await fs.promises.unlink(file);
        removed += 1;
        bytes += stats.size;
      } catch {
        // 忽略并发删除
      }
    });
  }
  return { removed, bytes };
}
