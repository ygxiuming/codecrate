import { Router } from 'express';
import { z } from 'zod';
import { getDb, nowIso } from '../../db';
import { asyncHandler, badRequest, notFound } from '../../http/errors';
import { intParam, parseBody } from '../../http/validate';
import { audit } from '../../services/audit';

export const adminAnnouncementsRouter = Router();

const announcementSchema = z
  .object({
    title: z.string().trim().min(1, '请填写标题').max(120),
    content: z.string().trim().min(1, '请填写内容').max(5000),
    level: z.enum(['info', 'success', 'warning', 'error']).default('info'),
    pinned: z.boolean().default(false),
    published: z.boolean().default(false),
    startsAt: z.string().datetime({ offset: true }).nullable().optional(),
    endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .refine(
    (value) =>
      !value.startsAt || !value.endsAt || Date.parse(value.startsAt) <= Date.parse(value.endsAt),
    { message: '结束时间不能早于开始时间', path: ['endsAt'] },
  );

interface AnnouncementRow {
  id: number;
  title: string;
  content: string;
  level: string;
  pinned: number;
  published: number;
  starts_at: string | null;
  ends_at: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

function serialize(row: AnnouncementRow): Record<string, unknown> {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    level: row.level,
    pinned: Boolean(row.pinned),
    published: Boolean(row.published),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

adminAnnouncementsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = getDb()
      .prepare(
        `SELECT id, title, content, level, pinned, published, starts_at, ends_at,
                created_by, created_at, updated_at
         FROM announcements
         ORDER BY pinned DESC, id DESC`,
      )
      .all() as AnnouncementRow[];
    res.json({ items: rows.map(serialize) });
  }),
);

adminAnnouncementsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = parseBody(announcementSchema, req.body);
    const timestamp = nowIso();
    const result = getDb()
      .prepare(
        `INSERT INTO announcements
          (title, content, level, pinned, published, starts_at, ends_at, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        body.title,
        body.content,
        body.level,
        body.pinned ? 1 : 0,
        body.published ? 1 : 0,
        body.startsAt ?? null,
        body.endsAt ?? null,
        req.admin?.id ?? null,
        timestamp,
        timestamp,
      );
    const id = Number(result.lastInsertRowid);
    audit(req, {
      action: 'announcement.create',
      targetType: 'announcement',
      targetId: id,
      detail: { title: body.title, published: body.published, pinned: body.pinned },
    });
    const row = getDb()
      .prepare('SELECT * FROM announcements WHERE id = ?')
      .all(id) as AnnouncementRow[];
    res.status(201).json({ announcement: serialize(row[0]) });
  }),
);

adminAnnouncementsRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = intParam(req.params.id, {
      fallback: 0,
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
      name: 'id',
    });
    const body = parseBody(announcementSchema, req.body);
    const db = getDb();
    const existing = db.prepare('SELECT id FROM announcements WHERE id = ?').all(id);
    if (existing.length === 0) throw notFound('公告不存在');
    db.prepare(
      `UPDATE announcements SET
         title = ?, content = ?, level = ?, pinned = ?, published = ?,
         starts_at = ?, ends_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      body.title,
      body.content,
      body.level,
      body.pinned ? 1 : 0,
      body.published ? 1 : 0,
      body.startsAt ?? null,
      body.endsAt ?? null,
      nowIso(),
      id,
    );
    audit(req, {
      action: 'announcement.update',
      targetType: 'announcement',
      targetId: id,
      detail: { title: body.title, published: body.published },
    });
    const row = db.prepare('SELECT * FROM announcements WHERE id = ?').all(id) as AnnouncementRow[];
    res.json({ announcement: serialize(row[0]) });
  }),
);

adminAnnouncementsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = intParam(req.params.id, {
      fallback: 0,
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
      name: 'id',
    });
    if (!id) throw badRequest('非法的公告 ID');
    const result = getDb().prepare('DELETE FROM announcements WHERE id = ?').run(id);
    if (result.changes === 0) throw notFound('公告不存在');
    audit(req, { action: 'announcement.delete', targetType: 'announcement', targetId: id });
    res.json({ ok: true });
  }),
);
