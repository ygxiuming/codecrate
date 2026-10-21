import { z } from 'zod';
import type { Request } from 'express';
import { getDb, nowIso } from '../db';
import { ipFamily } from '../net/ipGuard';
import { getSetting } from '../services/settings';
import { findArtifact } from '../storage/artifacts';
import { normalizeIp } from './visitor';

export const clientEventSchema = z.object({
  type: z.enum(['page_view', 'click', 'search']),
  path: z.string().max(300).optional(),
  target: z.string().max(200).optional(),
  resourceType: z.enum(['vscode', 'extension', 'remote-server']).optional(),
  resourceId: z.number().int().positive().optional(),
  metadata: z
    .record(z.union([z.string().max(200), z.number(), z.boolean()]))
    .optional(),
});

export const eventBatchSchema = z.object({
  events: z.array(clientEventSchema).min(1).max(20),
});

export type ClientEvent = z.infer<typeof clientEventSchema>;

const BOT_PATTERN =
  /bot|crawler|spider|slurp|bingpreview|facebookexternalhit|headlesschrome|phantomjs|curl\/|wget\/|python-requests|go-http-client|java\/|libwww-perl|scrapy/i;

export function isBot(userAgent: string): boolean {
  return BOT_PATTERN.test(userAgent);
}

function cleanText(value: string | undefined, maxLength: number): string | null {
  if (!value) return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return text ? text.slice(0, maxLength) : null;
}

function metadataJson(metadata: ClientEvent['metadata']): string | null {
  if (!metadata) return null;
  const json = JSON.stringify(metadata);
  return json.length <= 2000 ? json : null;
}

export function isAccessLogEnabled(): boolean {
  return getSetting<boolean>('access_log.enabled');
}

/**
 * 批量写入前端上报的页面浏览/点击/搜索事件。
 * IP 与 visitor_id 均由服务端补齐，客户端伪造无效。
 */
export function recordClientEvents(req: Request, events: ClientEvent[]): number {
  if (!isAccessLogEnabled()) return 0;
  const userAgent = req.get('user-agent') ?? '';
  if (isBot(userAgent)) return 0;

  const db = getDb();
  const visitorId = req.visitorId ?? null;
  const ip = normalizeIp(req.ip);
  const family = ipFamily(ip);
  const referer = cleanText(req.get('referer'), 500);
  const insert = db.prepare(
    `INSERT INTO access_events
      (event_type, path, target, resource_type, resource_id, metadata, ip, ip_family, user_agent, referer, visitor_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const recentPageView = db.prepare(
    `SELECT 1 AS hit FROM access_events
     WHERE visitor_id = ? AND event_type = 'page_view' AND path = ? AND created_at > ?
     LIMIT 1`,
  );

  let accepted = 0;
  const run = db.transaction(() => {
    const now = nowIso();
    for (const event of events) {
      const path = cleanText(event.path, 300);
      const target = cleanText(event.target, event.type === 'search' ? 100 : 200);
      if (event.type === 'page_view') {
        if (!path || !visitorId) continue;
        const cutoff = new Date(Date.now() - 30_000).toISOString();
        if (recentPageView.get(visitorId, path, cutoff)) continue;
      }
      let resourceType = event.resourceType ?? null;
      let resourceId = event.resourceId ?? null;
      if (resourceType && resourceId) {
        if (!findArtifact(resourceType, resourceId)) {
          resourceType = null;
          resourceId = null;
        }
      }
      insert.run(
        event.type,
        path,
        target,
        resourceType,
        resourceId,
        metadataJson(event.metadata),
        ip || null,
        family,
        userAgent.slice(0, 500),
        referer,
        visitorId,
        now,
      );
      accepted += 1;
    }
  });
  run();
  return accepted;
}

export interface DownloadEventInput {
  resourceType: 'vscode' | 'extension' | 'remote-server';
  resourceId: number;
  filename: string;
  statusCode: number;
  bytesSent: number;
  rangeStart: number;
  durationMs: number;
}

/** 服务端权威下载记录：点击事件与成功下载分开统计。 */
export function recordDownloadEvent(req: Request, input: DownloadEventInput): void {
  if (!isAccessLogEnabled()) return;
  const ip = normalizeIp(req.ip);
  try {
    getDb()
      .prepare(
        `INSERT INTO access_events
          (event_type, path, target, resource_type, resource_id, metadata, ip, ip_family, user_agent, referer, visitor_id, status_code, bytes_sent, duration_ms, created_at)
         VALUES ('download', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        cleanText(req.originalUrl, 300),
        cleanText(input.filename, 200),
        input.resourceType,
        input.resourceId,
        JSON.stringify({ rangeStart: input.rangeStart }),
        ip || null,
        ipFamily(ip),
        (req.get('user-agent') ?? '').slice(0, 500),
        cleanText(req.get('referer'), 500),
        req.visitorId ?? null,
        input.statusCode,
        input.bytesSent,
        input.durationMs,
        nowIso(),
      );
  } catch {
    // 统计失败不影响下载
  }
}
