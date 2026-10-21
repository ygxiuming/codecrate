import { getDb } from '../db';

export type AccessEventType = 'page_view' | 'click' | 'download' | 'search';

export interface AccessEventFilters {
  type?: AccessEventType;
  ip?: string;
  resourceType?: string;
  resourceId?: number;
  from?: string;
  to?: string;
}

export interface AccessEventRow {
  id: number;
  event_type: AccessEventType;
  path: string | null;
  target: string | null;
  resource_type: string | null;
  resource_id: number | null;
  metadata: string | null;
  ip: string | null;
  ip_family: string | null;
  user_agent: string | null;
  referer: string | null;
  visitor_id: string | null;
  status_code: number | null;
  bytes_sent: number | null;
  duration_ms: number | null;
  created_at: string;
}

interface Counts {
  pv: number;
  uv: number;
  downloads: number;
  clicks: number;
  searches: number;
}

function sinceIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function readCounts(from: string, to: string): Omit<Counts, 'uv'> {
  return getDb()
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END), 0) AS pv,
         COALESCE(SUM(CASE WHEN event_type = 'download' THEN 1 ELSE 0 END), 0) AS downloads,
         COALESCE(SUM(CASE WHEN event_type = 'click' THEN 1 ELSE 0 END), 0) AS clicks,
         COALESCE(SUM(CASE WHEN event_type = 'search' THEN 1 ELSE 0 END), 0) AS searches
       FROM access_events
       WHERE created_at >= ? AND created_at < ?`,
    )
    .get(from, to) as Omit<Counts, 'uv'>;
}

function readUniqueVisitors(from: string, to: string): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(DISTINCT COALESCE(visitor_id, ip)) AS uv
       FROM access_events
       WHERE event_type = 'page_view' AND created_at >= ? AND created_at < ?`,
    )
    .get(from, to) as { uv: number };
  return row.uv;
}

export function getAnalyticsOverview(days: number): {
  days: number;
  current: Counts;
  previous: Counts;
} {
  const now = new Date().toISOString();
  const currentFrom = sinceIso(days);
  const previousFrom = sinceIso(days * 2);
  const currentCounts = readCounts(currentFrom, now);
  const previousCounts = readCounts(previousFrom, currentFrom);
  return {
    days,
    current: {
      ...currentCounts,
      uv: readUniqueVisitors(currentFrom, now),
    },
    previous: {
      ...previousCounts,
      uv: readUniqueVisitors(previousFrom, currentFrom),
    },
  };
}

export interface TimeseriesPoint {
  date: string;
  pv: number;
  uv: number;
  downloads: number;
  clicks: number;
  searches: number;
}

export function getTimeseries(days: number): TimeseriesPoint[] {
  const db = getDb();
  const from = sinceIso(days);
  const rows = db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS day, event_type, COUNT(*) AS count
       FROM access_events WHERE created_at >= ?
       GROUP BY day, event_type`,
    )
    .all(from) as Array<{ day: string; event_type: AccessEventType; count: number }>;
  const uvRows = db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS day, COUNT(DISTINCT COALESCE(visitor_id, ip)) AS uv
       FROM access_events WHERE event_type = 'page_view' AND created_at >= ?
       GROUP BY day`,
    )
    .all(from) as Array<{ day: string; uv: number }>;

  const map = new Map<string, TimeseriesPoint>();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.now() - offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    map.set(date, { date, pv: 0, uv: 0, downloads: 0, clicks: 0, searches: 0 });
  }
  for (const row of rows) {
    const point = map.get(row.day);
    if (!point) continue;
    if (row.event_type === 'page_view') point.pv += row.count;
    if (row.event_type === 'download') point.downloads += row.count;
    if (row.event_type === 'click') point.clicks += row.count;
    if (row.event_type === 'search') point.searches += row.count;
  }
  for (const row of uvRows) {
    const point = map.get(row.day);
    if (point) point.uv = row.uv;
  }
  return [...map.values()];
}

export interface TopContent {
  pages: Array<{ path: string; count: number }>;
  downloads: Array<{
    resource_type: string | null;
    resource_id: number | null;
    target: string | null;
    count: number;
    bytes: number;
  }>;
  searches: Array<{ target: string; count: number }>;
}

export function getTopContent(days: number, limit: number): TopContent {
  const db = getDb();
  const from = sinceIso(days);
  const pages = db
    .prepare(
      `SELECT path, COUNT(*) AS count FROM access_events
       WHERE event_type = 'page_view' AND path IS NOT NULL AND created_at >= ?
       GROUP BY path ORDER BY count DESC LIMIT ?`,
    )
    .all(from, limit) as Array<{ path: string; count: number }>;
  const downloads = db
    .prepare(
      `SELECT resource_type, resource_id, target, COUNT(*) AS count,
              COALESCE(SUM(bytes_sent), 0) AS bytes
       FROM access_events
       WHERE event_type = 'download' AND created_at >= ?
       GROUP BY resource_type, resource_id, target
       ORDER BY count DESC LIMIT ?`,
    )
    .all(from, limit) as TopContent['downloads'];
  const searches = db
    .prepare(
      `SELECT target, COUNT(*) AS count FROM access_events
       WHERE event_type = 'search' AND target IS NOT NULL AND target <> '' AND created_at >= ?
       GROUP BY target ORDER BY count DESC LIMIT ?`,
    )
    .all(from, limit) as Array<{ target: string; count: number }>;
  return { pages, downloads, searches };
}

function buildWhere(filters: AccessEventFilters): { clause: string; params: Array<string | number> } {
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (filters.type) {
    conditions.push('event_type = ?');
    params.push(filters.type);
  }
  if (filters.ip) {
    conditions.push('ip LIKE ?');
    params.push(`${filters.ip}%`);
  }
  if (filters.resourceType) {
    conditions.push('resource_type = ?');
    params.push(filters.resourceType);
  }
  if (filters.resourceId) {
    conditions.push('resource_id = ?');
    params.push(filters.resourceId);
  }
  if (filters.from) {
    conditions.push('created_at >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    conditions.push('created_at <= ?');
    params.push(filters.to);
  }
  return {
    clause: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

const EVENT_COLUMNS = `id, event_type, path, target, resource_type, resource_id, metadata,
  ip, ip_family, user_agent, referer, visitor_id, status_code, bytes_sent, duration_ms, created_at`;

export function listAccessEvents(
  filters: AccessEventFilters,
  page: number,
  pageSize: number,
): { items: AccessEventRow[]; total: number } {
  const db = getDb();
  const { clause, params } = buildWhere(filters);
  const total = (
    db.prepare(`SELECT COUNT(*) AS count FROM access_events ${clause}`).get(...params) as {
      count: number;
    }
  ).count;
  const items = db
    .prepare(
      `SELECT ${EVENT_COLUMNS} FROM access_events ${clause}
       ORDER BY id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (page - 1) * pageSize) as AccessEventRow[];
  return { items, total };
}

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function exportAccessEventsCsv(filters: AccessEventFilters): string {
  const db = getDb();
  const { clause, params } = buildWhere(filters);
  const rows = db
    .prepare(
      `SELECT ${EVENT_COLUMNS} FROM access_events ${clause}
       ORDER BY id DESC LIMIT 50000`,
    )
    .all(...params) as AccessEventRow[];
  const header = [
    'id',
    'created_at',
    'event_type',
    'path',
    'target',
    'resource_type',
    'resource_id',
    'ip',
    'ip_family',
    'visitor_id',
    'status_code',
    'bytes_sent',
    'duration_ms',
    'user_agent',
    'referer',
    'metadata',
  ];
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.created_at,
        row.event_type,
        row.path,
        row.target,
        row.resource_type,
        row.resource_id,
        row.ip,
        row.ip_family,
        row.visitor_id,
        row.status_code,
        row.bytes_sent,
        row.duration_ms,
        row.user_agent,
        row.referer,
        row.metadata,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
