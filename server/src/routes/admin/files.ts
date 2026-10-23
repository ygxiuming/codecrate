import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../../db';
import { asyncHandler, notFound } from '../../http/errors';
import { intParam, optionalString, parseBody, parsePagination } from '../../http/validate';
import { audit } from '../../services/audit';
import {
  deletePublicFileRecord,
  deleteShareRecord,
  EXPIRY_UNIT_MS,
  getZoneUsage,
  PERMANENT_EXPIRY,
} from '../../services/fileZone';

export const adminFilesRouter = Router();

adminFilesRouter.get(
  '/usage',
  asyncHandler(async (_req, res) => {
    res.json(getZoneUsage());
  }),
);

/* ---------------- 公共区文件管理 ---------------- */

adminFilesRouter.get(
  '/public',
  asyncHandler(async (req, res) => {
    const search = (optionalString(req.query.q, 120) ?? '').toLowerCase();
    const includeExpired = optionalString(req.query.include_expired, 10) === '1';
    const { page, pageSize, offset } = parsePagination(req.query as Record<string, unknown>, {
      pageSize: 20,
      maxPageSize: 100,
    });
    const like = `%${search}%`;
    const db = getDb();
    const filterExpired = includeExpired ? 0 : 1;
    const filterSearch = search ? 1 : 0;
    const totalRows = db
      .prepare(
        `SELECT COUNT(*) AS count FROM public_files
         WHERE (? = 0 OR expires_at > ?)
           AND (? = 0 OR lower(filename) LIKE ? OR lower(note) LIKE ?)`,
      )
      .all(filterExpired, new Date().toISOString(), filterSearch, like, like) as Array<{
      count: number;
    }>;
    const total = totalRows[0]?.count ?? 0;
    const rows = db
      .prepare(
        `SELECT id, filename, size_bytes, sha256, note, uploader_ip, visitor_id, download_count, expires_at, created_at
         FROM public_files
         WHERE (? = 0 OR expires_at > ?)
           AND (? = 0 OR lower(filename) LIKE ? OR lower(note) LIKE ?)
         ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(
        filterExpired,
        new Date().toISOString(),
        filterSearch,
        like,
        like,
        pageSize,
        offset,
      ) as Array<{
      id: number;
      filename: string;
      size_bytes: number;
      sha256: string;
      note: string;
      uploader_ip: string;
      visitor_id: string;
      download_count: number;
      expires_at: string;
      created_at: string;
    }>;
    res.json({
      items: rows.map((row) => ({
        id: row.id,
        filename: row.filename,
        sizeBytes: row.size_bytes,
        sha256: row.sha256,
        note: row.note,
        uploaderIp: row.uploader_ip,
        visitorId: row.visitor_id,
        downloadCount: row.download_count,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
      })),
      total,
      page,
      pageSize,
      usage: getZoneUsage(),
    });
  }),
);

const publicFileUpdateSchema = z
  .object({
    note: z.string().max(300).optional(),
    expires_at: z.string().datetime({ offset: true }).optional(),
    extend_value: z.number().int().min(1).max(5_256_000).optional(),
    extend_unit: z.enum(['minutes', 'hours', 'days']).optional(),
    permanent: z.boolean().optional(),
  })
  .strict();

adminFilesRouter.put(
  '/public/:id',
  asyncHandler(async (req, res) => {
    const id = intParam(req.params.id, {
      fallback: 0,
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
      name: 'id',
    });
    const fields = parseBody(publicFileUpdateSchema, req.body);
    let expiresAt: string | undefined = fields.expires_at;
    if (fields.permanent) {
      expiresAt = PERMANENT_EXPIRY;
    } else if (fields.extend_value && fields.extend_unit) {
      expiresAt = new Date(
        Date.now() + fields.extend_value * EXPIRY_UNIT_MS[fields.extend_unit],
      ).toISOString();
    }
    const info = getDb()
      .prepare(
        `UPDATE public_files SET
           note = COALESCE(?, note),
           expires_at = COALESCE(?, expires_at)
         WHERE id = ?`,
      )
      .run(fields.note ?? null, expiresAt ?? null, id);
    if (info.changes === 0) throw notFound('文件不存在');
    audit(req, {
      action: 'public_file.update',
      targetType: 'public_file',
      targetId: id,
      detail: { fields: Object.keys(fields) },
    });
    res.json({ ok: true });
  }),
);

adminFilesRouter.delete(
  '/public/:id',
  asyncHandler(async (req, res) => {
    const id = intParam(req.params.id, {
      fallback: 0,
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
      name: 'id',
    });
    const filename = await deletePublicFileRecord(id);
    if (filename === null) throw notFound('文件不存在');
    audit(req, {
      action: 'public_file.delete',
      targetType: 'public_file',
      targetId: id,
      detail: { filename },
    });
    res.json({ ok: true, filename });
  }),
);

/* ---------------- 私人取件管理 ---------------- */

adminFilesRouter.get(
  '/shares',
  asyncHandler(async (req, res) => {
    const search = (optionalString(req.query.q, 120) ?? '').toLowerCase();
    const { page, pageSize, offset } = parsePagination(req.query as Record<string, unknown>, {
      pageSize: 20,
      maxPageSize: 100,
    });
    const like = `%${search}%`;
    const filterSearch = search ? 1 : 0;
    const db = getDb();
    const totalRows = db
      .prepare(
        `SELECT COUNT(*) AS count FROM file_shares
         WHERE (? = 0 OR lower(filename) LIKE ? OR lower(note) LIKE ?)`,
      )
      .all(filterSearch, like, like) as Array<{ count: number }>;
    const total = totalRows[0]?.count ?? 0;
    const rows = db
      .prepare(
        `SELECT id, filename, size_bytes, sha256, note, max_downloads, download_count,
                uploader_ip, visitor_id, revoked, expires_at, created_at
         FROM file_shares
         WHERE (? = 0 OR lower(filename) LIKE ? OR lower(note) LIKE ?)
         ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(filterSearch, like, like, pageSize, offset) as Array<{
      id: number;
      filename: string;
      size_bytes: number;
      sha256: string;
      note: string;
      max_downloads: number | null;
      download_count: number;
      uploader_ip: string;
      visitor_id: string;
      revoked: number;
      expires_at: string;
      created_at: string;
    }>;
    res.json({
      items: rows.map((row) => ({
        id: row.id,
        filename: row.filename,
        sizeBytes: row.size_bytes,
        sha256: row.sha256,
        note: row.note,
        maxDownloads: row.max_downloads,
        downloadCount: row.download_count,
        uploaderIp: row.uploader_ip,
        visitorId: row.visitor_id,
        revoked: Boolean(row.revoked),
        expiresAt: row.expires_at,
        createdAt: row.created_at,
      })),
      total,
      page,
      pageSize,
    });
  }),
);

const shareUpdateSchema = z
  .object({
    revoked: z.boolean().optional(),
    expires_at: z.string().datetime({ offset: true }).optional(),
    extend_value: z.number().int().min(1).max(5_256_000).optional(),
    extend_unit: z.enum(['minutes', 'hours', 'days']).optional(),
    permanent: z.boolean().optional(),
    max_downloads: z.number().int().min(1).max(10000).nullable().optional(),
  })
  .strict();

adminFilesRouter.put(
  '/shares/:id',
  asyncHandler(async (req, res) => {
    const id = intParam(req.params.id, {
      fallback: 0,
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
      name: 'id',
    });
    const fields = parseBody(shareUpdateSchema, req.body);
    let expiresAt: string | undefined = fields.expires_at;
    if (fields.permanent) {
      expiresAt = PERMANENT_EXPIRY;
    } else if (fields.extend_value && fields.extend_unit) {
      expiresAt = new Date(
        Date.now() + fields.extend_value * EXPIRY_UNIT_MS[fields.extend_unit],
      ).toISOString();
    }
    const info = getDb()
      .prepare(
        `UPDATE file_shares SET
           revoked = COALESCE(?, revoked),
           expires_at = COALESCE(?, expires_at),
           max_downloads = CASE WHEN ? THEN ? ELSE max_downloads END
         WHERE id = ?`,
      )
      .run(
        fields.revoked === undefined ? null : fields.revoked ? 1 : 0,
        expiresAt ?? null,
        fields.max_downloads === undefined ? 0 : 1,
        fields.max_downloads ?? null,
        id,
      );
    if (info.changes === 0) throw notFound('取件不存在');
    audit(req, {
      action: 'share.update',
      targetType: 'file_share',
      targetId: id,
      detail: { fields: Object.keys(fields) },
    });
    res.json({ ok: true });
  }),
);

adminFilesRouter.delete(
  '/shares/:id',
  asyncHandler(async (req, res) => {
    const id = intParam(req.params.id, {
      fallback: 0,
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
      name: 'id',
    });
    const filename = await deleteShareRecord(id);
    if (filename === null) throw notFound('取件不存在');
    audit(req, {
      action: 'share.delete',
      targetType: 'file_share',
      targetId: id,
      detail: { filename },
    });
    res.json({ ok: true, filename });
  }),
);
