import { Router } from 'express';
import { getDb } from '../../db';
import { asyncHandler } from '../../http/errors';
import { queueStats } from '../../services/queue';
import { getStorageUsage } from '../../storage/usage';

export const adminOverviewRouter = Router();

adminOverviewRouter.get(
  ['/', '/overview'],
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const scalar = (sql: string): number =>
      (db.prepare(sql).get() as { count: number }).count;
    const usage = await getStorageUsage();
    const recentTasks = db
      .prepare(
        `SELECT id, kind, target_key, status, progress_bytes, total_bytes, error_message,
                created_at, finished_at FROM tasks ORDER BY id DESC LIMIT 8`,
      )
      .all();
    const recentAudit = db
      .prepare(
        `SELECT id, actor, action, target_type, target_id, ip, created_at
         FROM audit_logs ORDER BY id DESC LIMIT 8`,
      )
      .all();
    const recentDownloads = db
      .prepare(
        `SELECT id, target, resource_type, resource_id, ip, bytes_sent, created_at
         FROM access_events WHERE event_type = 'download' ORDER BY id DESC LIMIT 8`,
      )
      .all();
    const today = new Date().toISOString().slice(0, 10);
    const todayStats = db
      .prepare(
        `SELECT
          COALESCE(SUM(CASE WHEN event_type='page_view' THEN 1 ELSE 0 END),0) AS pv,
          COUNT(DISTINCT CASE WHEN event_type='page_view' THEN COALESCE(visitor_id, ip) END) AS uv,
          COALESCE(SUM(CASE WHEN event_type='download' THEN 1 ELSE 0 END),0) AS downloads
         FROM access_events WHERE created_at >= ?`,
      )
      .get(`${today}T00:00:00.000Z`) as { pv: number; uv: number; downloads: number };

    res.json({
      vscodeVersions: scalar('SELECT COUNT(DISTINCT version) AS count FROM vscode_packages'),
      vscodePackages: scalar('SELECT COUNT(*) AS count FROM vscode_packages'),
      extensionCount: scalar('SELECT COUNT(DISTINCT extension_id) AS count FROM extensions'),
      extensionVersions: scalar('SELECT COUNT(*) AS count FROM extensions'),
      remoteVersions: scalar('SELECT COUNT(DISTINCT version) AS count FROM remote_servers'),
      remotePackages: scalar('SELECT COUNT(*) AS count FROM remote_servers'),
      tasks: queueStats(),
      storage: usage,
      today: todayStats,
      recentTasks,
      recentAudit,
      recentDownloads,
    });
  }),
);
