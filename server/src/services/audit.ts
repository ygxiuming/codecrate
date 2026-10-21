import type { Request } from 'express';
import { getDb } from '../db';
import { logger } from '../logger';

export interface AuditOptions {
  action: string;
  targetType?: string;
  targetId?: string | number;
  detail?: unknown;
  actor?: string;
  actorId?: number | null;
}

/** 审计写入失败不能影响主流程，因此仅记录日志。 */
export function audit(req: Request | null, options: AuditOptions): void {
  const ip = req?.ip ?? null;
  const userAgent = req?.get('user-agent') ?? null;
  const actor = options.actor ?? req?.admin?.username ?? 'system';
  const actorId = options.actorId ?? req?.admin?.id ?? null;
  try {
    getDb()
      .prepare(
        `INSERT INTO audit_logs (actor, actor_id, action, target_type, target_id, detail, ip, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        actor,
        actorId,
        options.action,
        options.targetType ?? null,
        options.targetId === undefined ? null : String(options.targetId),
        options.detail === undefined ? null : JSON.stringify(options.detail),
        ip,
        userAgent,
      );
  } catch (error) {
    logger.error({ err: error, action: options.action }, '写入审计日志失败');
  }
}
