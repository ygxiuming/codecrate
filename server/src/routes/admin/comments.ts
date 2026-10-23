import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, badRequest, notFound } from '../../http/errors';
import { intParam, optionalString, parseBody, parsePagination } from '../../http/validate';
import { audit } from '../../services/audit';
import {
  deleteCommentWithReplies,
  getCommentById,
  listCommentsForAdmin,
  setCommentPinned,
} from '../../services/comments';

export const adminCommentsRouter = Router();

adminCommentsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const search = optionalString(req.query.q, 120) ?? '';
    const targetType = optionalString(req.query.target_type, 20) ?? null;
    if (targetType && !['board', 'software'].includes(targetType)) {
      throw badRequest('未知评论对象类型');
    }
    const onlyPinned = optionalString(req.query.pinned, 10) === '1';
    const { page, pageSize, offset } = parsePagination(req.query as Record<string, unknown>, {
      pageSize: 20,
      maxPageSize: 100,
    });
    const result = listCommentsForAdmin({
      search,
      targetType,
      onlyPinned,
      page,
      pageSize,
      offset,
    });
    res.json({
      items: result.items.map((row) => ({
        id: row.id,
        targetType: row.target_type,
        targetId: row.target_id,
        parentId: row.parent_id,
        replyToId: row.reply_to_id,
        replyToNickname: row.reply_to_nickname,
        nickname: row.nickname,
        content: row.content,
        ip: row.ip,
        ipFamily: row.ip_family,
        userAgent: row.user_agent,
        pinned: Boolean(row.pinned),
        replyCount: row.reply_count,
        createdAt: row.created_at,
      })),
      total: result.total,
      page,
      pageSize,
    });
  }),
);

adminCommentsRouter.put(
  '/:id/pin',
  asyncHandler(async (req, res) => {
    const id = intParam(req.params.id, {
      fallback: 0,
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
      name: 'id',
    });
    const fields = parseBody(z.object({ pinned: z.boolean() }).strict(), req.body);
    const row = getCommentById(id);
    if (!row) throw notFound('评论不存在');
    if (row.parent_id !== null) throw badRequest('只能置顶顶层评论');
    setCommentPinned(id, fields.pinned);
    audit(req, {
      action: 'comment.pin',
      targetType: 'comment',
      targetId: id,
      detail: { pinned: fields.pinned, targetType: row.target_type, targetId: row.target_id },
    });
    res.json({ ok: true, pinned: fields.pinned });
  }),
);

adminCommentsRouter.post(
  '/batch-delete',
  asyncHandler(async (req, res) => {
    const fields = parseBody(
      z.object({ ids: z.array(z.number().int().min(1)).min(1).max(200) }).strict(),
      req.body,
    );
    let deleted = 0;
    for (const id of fields.ids) {
      deleted += deleteCommentWithReplies(id).deleted;
    }
    audit(req, {
      action: 'comment.batch_delete',
      targetType: 'comment',
      detail: { requested: fields.ids.length, deleted },
    });
    res.json({ deleted });
  }),
);

adminCommentsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = intParam(req.params.id, {
      fallback: 0,
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
      name: 'id',
    });
    const row = getCommentById(id);
    if (!row) throw notFound('评论不存在');
    const result = deleteCommentWithReplies(id);
    if (result.deleted === 0) throw notFound('评论不存在');
    audit(req, {
      action: 'comment.delete',
      targetType: 'comment',
      targetId: id,
      detail: { deleted: result.deleted, targetType: row.target_type, targetId: row.target_id },
    });
    res.json({ ok: true, deleted: result.deleted });
  }),
);
