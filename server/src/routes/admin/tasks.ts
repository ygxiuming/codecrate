import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../../db';
import { asyncHandler, badRequest, notFound } from '../../http/errors';
import { intParam, optionalString, parseBody, parsePagination } from '../../http/validate';
import { audit } from '../../services/audit';
import {
  cancelTask,
  clearFinishedTasks,
  getTask,
  getTaskEvents,
  queueStats,
  retryAllFailed,
  retryTask,
  type TaskRow,
} from '../../services/queue';

export const adminTasksRouter = Router();

const STATUSES = new Set(['queued', 'running', 'success', 'failed', 'canceled']);
const KINDS = new Set(['vscode_package', 'remote_server', 'extension']);

function hydrate(task: TaskRow): Record<string, unknown> {
  let payload: unknown = null;
  try {
    payload = JSON.parse(task.payload);
  } catch {
    payload = null;
  }
  return { ...task, payload };
}

adminTasksRouter.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    res.json({ stats: queueStats() });
  }),
);

adminTasksRouter.post(
  '/clear',
  asyncHandler(async (req, res) => {
    const fields = parseBody(
      z.object({
        statuses: z
          .array(z.enum(['success', 'failed', 'canceled']))
          .min(1)
          .max(3)
          .optional(),
      })
        .strict()
        .optional(),
      req.body ?? {},
    );
    const statuses = fields?.statuses ?? ['success', 'canceled'];
    const cleared = clearFinishedTasks(statuses);
    audit(req, {
      action: 'task.clear',
      detail: { statuses, cleared },
    });
    res.json({ cleared, stats: queueStats() });
  }),
);

adminTasksRouter.post(
  '/retry-failed',
  asyncHandler(async (req, res) => {
    const count = retryAllFailed(100);
    audit(req, { action: 'task.retry_failed', detail: { count } });
    res.json({ retried: count });
  }),
);

adminTasksRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const status = optionalString(req.query.status, 20) ?? null;
    const kind = optionalString(req.query.kind, 30) ?? null;
    if (status && !STATUSES.has(status)) throw badRequest('未知任务状态');
    if (kind && !KINDS.has(kind)) throw badRequest('未知任务类型');
    const { page, pageSize, offset } = parsePagination(req.query as Record<string, unknown>, {
      pageSize: 20,
      maxPageSize: 100,
    });
    const db = getDb();
    const countRows = db
      .prepare(
        `SELECT COUNT(*) AS count FROM tasks
         WHERE (? IS NULL OR status = ?) AND (? IS NULL OR kind = ?)`,
      )
      .all(status, status, kind, kind) as Array<{ count: number }>;
    const total = countRows[0]?.count ?? 0;
    const rows = db
      .prepare(
        `SELECT * FROM tasks
         WHERE (? IS NULL OR status = ?) AND (? IS NULL OR kind = ?)
         ORDER BY id DESC LIMIT ? OFFSET ?`,
      )
      .all(status, status, kind, kind, pageSize, offset) as TaskRow[];
    res.json({ items: rows.map(hydrate), total, page, pageSize });
  }),
);

adminTasksRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = intParam(req.params.id, {
      fallback: 0,
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
      name: 'id',
    });
    const task = getTask(id);
    if (!task) throw notFound('任务不存在');
    res.json({ task: hydrate(task), events: getTaskEvents(id) });
  }),
);

adminTasksRouter.post(
  '/:id/retry',
  asyncHandler(async (req, res) => {
    const id = intParam(req.params.id, {
      fallback: 0,
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
      name: 'id',
    });
    const task = retryTask(id);
    audit(req, { action: 'task.retry', targetType: 'task', targetId: id });
    res.json({ task: hydrate(task) });
  }),
);

adminTasksRouter.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const id = intParam(req.params.id, {
      fallback: 0,
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
      name: 'id',
    });
    const task = cancelTask(id);
    audit(req, { action: 'task.cancel', targetType: 'task', targetId: id });
    res.json({ task: hydrate(task) });
  }),
);
