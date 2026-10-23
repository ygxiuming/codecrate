import type { Request } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { ipFamily } from '../net/ipGuard';
import { normalizeIp } from '../analytics/visitor';
import { originGuard, requireUserAccess } from '../auth/middleware';
import { commentLimiter } from '../auth/rateLimit';
import { asyncHandler, badRequest, forbidden, notFound } from '../http/errors';
import { intParam, optionalString, parseBody, parsePagination } from '../http/validate';
import { createComment, listCommentThreads, type CommentTargetType } from '../services/comments';
import { getSoftwareById } from '../services/softwareUpload';
import { getSetting } from '../services/settings';

export const publicCommentsRouter = Router();

const TARGET_TYPES = new Set(['board', 'software']);

function clientIp(req: Request): { ip: string; family: string | null } {
  const ip = normalizeIp(req.ip);
  return { ip, family: ipFamily(ip) };
}

function resolveTarget(
  targetType: string,
  rawTargetId: unknown,
): { targetType: CommentTargetType; targetId: number } {
  if (!TARGET_TYPES.has(targetType)) throw badRequest('评论对象不合法');
  if (targetType === 'board') return { targetType: 'board', targetId: 0 };
  const targetId = intParam(rawTargetId, {
    fallback: 0,
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
    name: 'target_id',
  });
  if (targetId < 1) throw badRequest('评论对象不合法');
  if (!getSoftwareById(targetId)) throw notFound('评论对象不存在');
  return { targetType: 'software', targetId };
}

publicCommentsRouter.use(requireUserAccess);

publicCommentsRouter.get(
  '/comments',
  asyncHandler(async (req, res) => {
    if (!getSetting<boolean>('comments.enabled')) throw forbidden('评论区已关闭');
    const targetType = optionalString(req.query.target_type, 20) ?? 'board';
    const target = resolveTarget(targetType, req.query.target_id);
    const { page, pageSize, offset } = parsePagination(req.query as Record<string, unknown>, {
      pageSize: 20,
      maxPageSize: 50,
    });
    const result = listCommentThreads(target.targetType, target.targetId, page, pageSize, offset);
    res.json({
      ...result,
      page,
      pageSize,
      maskIp: getSetting<boolean>('comments.mask_ip'),
    });
  }),
);

publicCommentsRouter.post(
  '/comments',
  commentLimiter,
  originGuard,
  asyncHandler(async (req, res) => {
    if (!getSetting<boolean>('comments.enabled')) throw forbidden('评论区已关闭');
    const fields = parseBody(
      z.object({
        target_type: z.enum(['board', 'software']),
        target_id: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
        nickname: z.string().trim().max(30).optional(),
        content: z.string().trim().min(1).max(1000),
        parent_id: z.number().int().min(1).optional(),
        reply_to_id: z.number().int().min(1).optional(),
      }),
      req.body,
    );
    const target = resolveTarget(fields.target_type, fields.target_id);
    const { ip, family } = clientIp(req);
    const created = createComment({
      targetType: target.targetType,
      targetId: target.targetId,
      nickname: fields.nickname || '访客',
      content: fields.content,
      ip,
      ipFamily: family,
      userAgent: req.get('user-agent') ?? '',
      parentId: fields.parent_id ?? null,
      replyToId: fields.reply_to_id ?? null,
    });
    res.status(201).json({ id: created.id, parentId: created.parentId });
  }),
);
