import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../../config';
import { getDb, nowIso } from '../../db';
import { ApiError, asyncHandler, badRequest, notFound } from '../../http/errors';
import { intParam, optionalString, parseBody, parsePagination } from '../../http/validate';
import { audit } from '../../services/audit';
import { isSoftwareScanRunning, scanSoftware } from '../../services/softwareScan';
import {
  getSoftwareById,
  importSoftwarePackage,
  type SoftwareRow,
} from '../../services/softwareUpload';
import { getSetting } from '../../services/settings';
import { removeIfExists, resolveWithin } from '../../storage/paths';

export const adminSoftwareRouter = Router();

function uploadMiddleware(req: Request, res: Response, next: NextFunction): void {
  const configured =
    Number(getSetting<number>('upload.software_max_bytes')) || 2 * 1024 * 1024 * 1024;
  const maxBytes = Math.min(Math.max(configured, 1024 * 1024), 4 * 1024 * 1024 * 1024);
  const handler = multer({
    dest: path.join(config.storageDir, 'tmp', 'uploads'),
    limits: { fileSize: maxBytes, files: 1, fields: 10 },
  }).single('file');
  handler(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof multer.MulterError) {
      next(new ApiError(400, 'UPLOAD_ERROR', `上传失败：${error.message}`));
      return;
    }
    next(error);
  });
}

function requireSoftware(id: number): SoftwareRow {
  const row = getSoftwareById(id);
  if (!row) throw notFound('软件包不存在');
  return row;
}

adminSoftwareRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const search = (optionalString(req.query.q, 120) ?? '').toLowerCase();
    const category = optionalString(req.query.category, 80);
    const { page, pageSize, offset } = parsePagination(req.query as Record<string, unknown>, {
      pageSize: 20,
      maxPageSize: 100,
    });
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (search) {
      conditions.push(
        '(lower(name) LIKE ? OR lower(version) LIKE ? OR lower(platform) LIKE ? OR lower(category) LIKE ? OR lower(filename) LIKE ?)',
      );
      const like = `%${search}%`;
      params.push(like, like, like, like, like);
    }
    if (category) {
      conditions.push('category = ?');
      params.push(category);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const db = getDb();
    const total = (
      db.prepare(`SELECT COUNT(*) AS count FROM software_packages ${where}`).get(...params) as {
        count: number;
      }
    ).count;
    const rows = db
      .prepare(
        `SELECT id, name, version, platform, category, filename, size_bytes, sha256,
                download_count, source, verified_at, created_at, updated_at
         FROM software_packages ${where} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, offset) as SoftwareRow[];
    res.json({ items: rows, total, page, pageSize });
  }),
);

adminSoftwareRouter.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    const rows = getDb()
      .prepare(
        `SELECT category, COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS bytes
         FROM software_packages GROUP BY category ORDER BY category`,
      )
      .all() as Array<{ category: string; count: number; bytes: number }>;
    res.json({ items: rows });
  }),
);

adminSoftwareRouter.get(
  '/scan-status',
  asyncHandler(async (_req, res) => {
    res.json({ running: isSoftwareScanRunning() });
  }),
);

adminSoftwareRouter.post(
  '/scan',
  asyncHandler(async (req, res) => {
    if (isSoftwareScanRunning()) {
      throw new ApiError(409, 'SCAN_RUNNING', '软件包目录扫描正在进行，请稍后再试');
    }
    const result = await scanSoftware();
    audit(req, {
      action: 'software.scan',
      detail: {
        added: result.added,
        updated: result.updated,
        removed: result.removed,
        skipped: result.skipped,
      },
    });
    res.json(result);
  }),
);

adminSoftwareRouter.post(
  '/category-rename',
  asyncHandler(async (req, res) => {
    const schema = z
      .object({ from: z.string().trim().min(1).max(80), to: z.string().trim().min(1).max(80) })
      .strict();
    const { from, to } = parseBody(schema, req.body);
    const info = getDb()
      .prepare('UPDATE software_packages SET category = ?, updated_at = ? WHERE category = ?')
      .run(to, nowIso(), from);
    audit(req, {
      action: 'software.category_rename',
      targetType: 'software',
      targetId: from,
      detail: { to, changed: info.changes },
    });
    res.json({ changed: info.changes });
  }),
);

adminSoftwareRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = intParam(req.params.id, {
      fallback: 0,
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
      name: 'id',
    });
    res.json(requireSoftware(id));
  }),
);

adminSoftwareRouter.post(
  '/upload',
  uploadMiddleware,
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) throw badRequest('请选择要上传的安装包文件');
    const tempPath = file.path;
    try {
      const fields = parseBody(
        z.object({
          name: z.string().trim().max(120).optional(),
          version: z.string().trim().max(80).optional(),
          platform: z.string().trim().max(80).optional(),
          category: z.string().trim().max(80).optional(),
          description_md: z.string().max(200_000).optional(),
        }),
        req.body,
      );
      const result = await importSoftwarePackage({
        tempPath,
        originalName: file.originalname,
        name: fields.name,
        version: fields.version,
        platform: fields.platform,
        category: fields.category,
        descriptionMd: fields.description_md,
      });
      audit(req, {
        action: 'software.upload',
        targetType: 'software',
        targetId: result.id,
        detail: {
          name: result.name,
          version: result.version,
          category: result.category,
          size: result.sizeBytes,
          filename: result.filename,
        },
      });
      res.status(201).json(result);
    } finally {
      await removeIfExists(tempPath);
    }
  }),
);

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    version: z.string().trim().max(80).optional(),
    platform: z.string().trim().max(80).optional(),
    category: z.string().trim().min(1).max(80).optional(),
    description_md: z.string().max(200_000).optional(),
  })
  .strict();

adminSoftwareRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = intParam(req.params.id, {
      fallback: 0,
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
      name: 'id',
    });
    const row = requireSoftware(id);
    const fields = parseBody(updateSchema, req.body);
    const next = {
      name: fields.name ?? row.name,
      version: fields.version ?? row.version,
      platform: fields.platform ?? row.platform,
      category: fields.category ?? row.category,
      description_md: fields.description_md ?? row.description_md,
    };
    getDb()
      .prepare(
        `UPDATE software_packages
         SET name = ?, version = ?, platform = ?, category = ?, description_md = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(next.name, next.version, next.platform, next.category, next.description_md, nowIso(), id);
    audit(req, {
      action: 'software.update',
      targetType: 'software',
      targetId: id,
      detail: { fields: Object.keys(fields) },
    });
    res.json(getSoftwareById(id));
  }),
);

adminSoftwareRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = intParam(req.params.id, {
      fallback: 0,
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
      name: 'id',
    });
    const row = requireSoftware(id);
    await removeIfExists(resolveWithin(row.stored_path));
    getDb().prepare('DELETE FROM software_packages WHERE id = ?').run(id);
    audit(req, {
      action: 'software.delete',
      targetType: 'software',
      targetId: id,
      detail: { filename: row.filename, name: row.name },
    });
    res.json({ ok: true, filename: row.filename });
  }),
);
