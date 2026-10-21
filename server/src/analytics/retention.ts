import { cleanupExpiredSessions } from '../auth/sessions';
import { getDb } from '../db';
import { logger } from '../logger';
import { getSetting } from '../services/settings';
import { cleanupTempFiles } from '../storage/usage';

export function pruneAccessEvents(retentionDays: number): number {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const statement = getDb().prepare(
    `DELETE FROM access_events
     WHERE id IN (SELECT id FROM access_events WHERE created_at < ? LIMIT 5000)`,
  );
  let removed = 0;
  for (let batch = 0; batch < 200; batch += 1) {
    const info = statement.run(cutoff);
    removed += info.changes;
    if (info.changes < 5000) break;
  }
  return removed;
}

async function runMaintenance(): Promise<void> {
  try {
    cleanupExpiredSessions();
    const enabled = getSetting<boolean>('access_log.enabled');
    const retentionDays = getSetting<number>('access_log.retention_days');
    if (enabled && retentionDays > 0) {
      const removed = pruneAccessEvents(retentionDays);
      if (removed > 0) logger.info({ removed, retentionDays }, '已清理过期访问日志');
    }
    const temp = await cleanupTempFiles();
    if (temp.removed > 0) {
      logger.info({ removed: temp.removed, bytes: temp.bytes }, '已清理临时文件');
    }
  } catch (error) {
    logger.error({ err: error }, '维护任务执行失败');
  }
}

function msUntilNextRun(): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(3, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export function startMaintenanceJob(): () => void {
  let timer: NodeJS.Timeout | null = null;
  const schedule = (): void => {
    timer = setTimeout(() => {
      void runMaintenance().finally(schedule);
    }, msUntilNextRun());
    timer.unref();
  };
  void runMaintenance();
  schedule();
  return () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
}
