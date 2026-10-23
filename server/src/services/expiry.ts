import fs from 'node:fs';
import { getDb, nowIso } from '../db';
import { logger } from '../logger';
import { audit } from './audit';
import { resolveWithin } from '../storage/paths';

export interface ExpirySweepResult {
  publicFiles: number;
  shares: number;
}

function removeFileQuietly(storedPath: string): void {
  try {
    fs.unlinkSync(resolveWithin(storedPath));
  } catch {
    // 文件可能已被手动清理
  }
}

/**
 * 删除已到期的公共区文件与私人取件（DB 行 + 磁盘文件），并写入系统审计。
 * 列表查询同时按 expires_at 过滤，确保到期即刻不可见，不依赖清理周期。
 */
export function sweepExpiredUploads(): ExpirySweepResult {
  const db = getDb();
  const now = nowIso();
  const result: ExpirySweepResult = { publicFiles: 0, shares: 0 };

  const expiredPublicFiles = db
    .prepare('SELECT id, filename, stored_path FROM public_files WHERE expires_at <= ?')
    .all(now) as Array<{ id: number; filename: string; stored_path: string }>;
  const expiredShares = db
    .prepare('SELECT id, filename, stored_path FROM file_shares WHERE expires_at <= ?')
    .all(now) as Array<{ id: number; filename: string; stored_path: string }>;

  if (expiredPublicFiles.length === 0 && expiredShares.length === 0) return result;

  const run = db.transaction(() => {
    const deletePublicFile = db.prepare('DELETE FROM public_files WHERE id = ? AND expires_at <= ?');
    const deleteShare = db.prepare('DELETE FROM file_shares WHERE id = ? AND expires_at <= ?');
    for (const row of expiredPublicFiles) {
      result.publicFiles += deletePublicFile.run(row.id, now).changes;
    }
    for (const row of expiredShares) {
      result.shares += deleteShare.run(row.id, now).changes;
    }
  });
  run();

  for (const row of expiredPublicFiles) removeFileQuietly(row.stored_path);
  for (const row of expiredShares) removeFileQuietly(row.stored_path);

  if (result.publicFiles > 0 || result.shares > 0) {
    audit(null, {
      action: 'file.expire',
      detail: { publicFiles: result.publicFiles, shares: result.shares },
    });
    logger.info(
      { publicFiles: result.publicFiles, shares: result.shares },
      '已清理到期的公共区文件与私人取件',
    );
  }
  return result;
}

const SWEEP_INTERVAL_MS = 30 * 60 * 1000;

export function startExpiryJob(): () => void {
  const run = (): void => {
    try {
      sweepExpiredUploads();
    } catch (error) {
      logger.error({ err: error }, '到期文件清理失败');
    }
  };
  run();
  const timer = setInterval(run, SWEEP_INTERVAL_MS);
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}
