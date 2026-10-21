import { Router } from 'express';
import {
  getAnalyticsOverview,
  getTimeseries,
  getTopContent,
  listAccessEvents,
  type AccessEventFilters,
  type AccessEventType,
} from '../../analytics/query';
import { getDb } from '../../db';
import { asyncHandler, badRequest } from '../../http/errors';
import { intParam, optionalString, parsePagination } from '../../http/validate';
import { getSetting } from '../../services/settings';

export const adminLogsRouter = Router();

const EVENT_TYPES = new Set(['page_view', 'click', 'download', 'search']);

function accessFilters(query: Record<string, unknown>): AccessEventFilters {
  const filters: AccessEventFilters = {};
  const type = optionalString(query.type, 20);
  if (type) {
    if (!EVENT_TYPES.has(type)) throw badRequest('未知事件类型');
    filters.type = type as AccessEventType;
  }
  const ip = optionalString(query.ip, 64);
  if (ip) filters.ip = ip;
  const resourceType = optionalString(query.resourceType, 30);
  if (resourceType) filters.resourceType = resourceType;
  const resourceId = intParam(query.resourceId, {
    fallback: 0,
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
    name: 'resourceId',
  });
  if (resourceId) filters.resourceId = resourceId;
  const from = optionalString(query.from, 40);
  if (from) {
    if (Number.isNaN(Date.parse(from))) throw badRequest('from 不是合法时间');
    filters.from = new Date(from).toISOString();
  }
  const to = optionalString(query.to, 40);
  if (to) {
    if (Number.isNaN(Date.parse(to))) throw badRequest('to 不是合法时间');
    filters.to = new Date(to).toISOString();
  }
  return filters;
}

adminLogsRouter.get(
  '/audit',
  asyncHandler(async (req, res) => {
    const q = optionalString(req.query.q, 100) ?? null;
    const action = optionalString(req.query.action, 80) ?? null;
    const { page, pageSize, offset } = parsePagination(req.query as Record<string, unknown>, {
      pageSize: 30,
      maxPageSize: 100,
    });
    const like = q ? `%${q}%` : null;
    const db = getDb();
    const countRows = db
      .prepare(
        `SELECT COUNT(*) AS count FROM audit_logs
         WHERE (? IS NULL OR action = ?)
           AND (? IS NULL OR actor LIKE ? OR action LIKE ? OR target_id LIKE ?)`,
      )
      .all(action, action, like, like, like, like) as Array<{ count: number }>;
    const items = db
      .prepare(
        `SELECT id, actor, actor_id, action, target_type, target_id, detail, ip, user_agent, created_at
         FROM audit_logs
         WHERE (? IS NULL OR action = ?)
           AND (? IS NULL OR actor LIKE ? OR action LIKE ? OR target_id LIKE ?)
         ORDER BY id DESC LIMIT ? OFFSET ?`,
      )
      .all(action, action, like, like, like, like, pageSize, offset) as Array<{
      id: number;
      actor: string;
      actor_id: number | null;
      action: string;
      target_type: string | null;
      target_id: string | null;
      detail: string | null;
      ip: string | null;
      user_agent: string | null;
      created_at: string;
    }>;
    res.json({
      items: items.map((item) => ({
        ...item,
        detail: item.detail ? safeParse(item.detail) : null,
      })),
      total: countRows[0]?.count ?? 0,
      page,
      pageSize,
    });
  }),
);

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

adminLogsRouter.get(
  '/analytics/overview',
  asyncHandler(async (req, res) => {
    const days = intParam(req.query.days, { fallback: 7, min: 1, max: 365, name: 'days' });
    res.json({
      ...getAnalyticsOverview(days),
      enabled: getSetting<boolean>('access_log.enabled'),
      retentionDays: getSetting<number>('access_log.retention_days'),
    });
  }),
);

adminLogsRouter.get(
  '/analytics/timeseries',
  asyncHandler(async (req, res) => {
    const days = intParam(req.query.days, { fallback: 14, min: 1, max: 365, name: 'days' });
    res.json({ days, points: getTimeseries(days) });
  }),
);

adminLogsRouter.get(
  '/analytics/top',
  asyncHandler(async (req, res) => {
    const days = intParam(req.query.days, { fallback: 7, min: 1, max: 365, name: 'days' });
    const limit = intParam(req.query.limit, { fallback: 10, min: 1, max: 50, name: 'limit' });
    res.json(getTopContent(days, limit));
  }),
);

adminLogsRouter.get(
  '/access-events',
  asyncHandler(async (req, res) => {
    const filters = accessFilters(req.query as Record<string, unknown>);
    const { page, pageSize } = parsePagination(req.query as Record<string, unknown>, {
      pageSize: 30,
      maxPageSize: 100,
    });
    const result = listAccessEvents(filters, page, pageSize);
    res.json({
      ...result,
      items: result.items.map((item) => ({
        ...item,
        metadata: item.metadata ? safeParse(item.metadata) : null,
      })),
      page,
      pageSize,
      retentionDays: getSetting<number>('access_log.retention_days'),
      enabled: getSetting<boolean>('access_log.enabled'),
    });
  }),
);

adminLogsRouter.get(
  '/access-events/export',
  asyncHandler(async (req, res) => {
    const filters = accessFilters(req.query as Record<string, unknown>);
    const result = listAccessEvents(filters, 1, 20000);
    res.json({
      items: result.items.map((item) => ({
        ...item,
        metadata: item.metadata ? safeParse(item.metadata) : null,
      })),
      count: result.items.length,
      total: result.total,
      exportedAt: new Date().toISOString(),
    });
  }),
);
