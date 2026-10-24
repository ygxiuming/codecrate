import fs from 'node:fs';
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
import { iconPublicUrl, saveIcon } from '../../services/icons';
import {
  coerceTagInput,
  isValidCategoryPath,
  normalizeCategoryPath,
  normalizeTagList,
  parseTagsColumn,
  serializeTags,
} from '../../services/softwareMeta';
import {
  approveSubmission,
  deleteSubmission,
  getSubmissionById,
  listSubmissions,
  rejectSubmission,
  updateSubmission,
  type SubmissionStatus,
} from '../../services/softwareSubmissions';
import { isSoftwareScanRunning, scanSoftware } from '../../services/softwareScan';
import {
  getSoftwareById,
  importSoftwarePackage,
  type SoftwareRow,
} from '../../services/softwareUpload';
import { getSetting } from '../../services/settings';
import { removeIfExists, resolveWithin } from '../../storage/paths';

export const adminSoftwareRouter = Router();

/** LIKE 通配符转义（配合 ESCAPE '\' 使用）。 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

const SORT_ORDERS = {
  updated: 'updated_at DESC, id DESC',
  downloads: 'download_count DESC, id DESC',
  size: 'size_bytes DESC, id DESC',
  name: 'name COLLATE NOCASE ASC, id ASC',
} as const;

type SortKey = keyof typeof SORT_ORDERS;

function parseSort(value: unknown): SortKey {
  const sort = optionalString(value, 20);
  return sort && sort in SORT_ORDERS ? (sort as SortKey) : 'updated';
}

const ICON_MAX_BYTES = 512 * 1024;
const ICON_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);

function uploadMiddleware(req: Request, res: Response, next: NextFunction): void {
  const configured =
    Number(getSetting<number>('upload.software_max_bytes')) || 2 * 1024 * 1024 * 1024;
  const maxBytes = Math.min(Math.max(configured, 1024 * 1024), 4 * 1024 * 1024 * 1024);
  const handler = multer({
    dest: path.join(config.storageDir, 'tmp', 'uploads'),
    limits: { fileSize: maxBytes, files: 2, fields: 10 },
  }).fields([
    { name: 'file', maxCount: 1 },
    { name: 'icon', maxCount: 1 },
  ]);
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

/** 校验并保存随安装包上传的图标；返回存储相对路径（无图标时返回 null）。 */
async function saveIconUpload(file: Express.Multer.File | undefined): Promise<string | null> {
  if (!file) return null;
  const ext = path.extname(file.originalname).replace('.', '').toLowerCase();
  if (!ICON_EXTENSIONS.has(ext)) throw badRequest('图标仅支持 png / jpg / jpeg / webp / gif');
  if (file.size > ICON_MAX_BYTES) throw badRequest('图标文件不能超过 512KB');
  const data = await fs.promises.readFile(file.path);
  return saveIcon(data, ext);
}

function requireSoftware(id: number): SoftwareRow {
  const row = getSoftwareById(id);
  if (!row) throw notFound('软件包不存在');
  return row;
}

/** 删除软件包：先移除落盘文件，再删除索引记录。 */
async function deleteSoftwareRow(row: SoftwareRow): Promise<void> {
  await removeIfExists(resolveWithin(row.stored_path));
  getDb().prepare('DELETE FROM software_packages WHERE id = ?').run(row.id);
}

adminSoftwareRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const search = (optionalString(req.query.q, 120) ?? '').toLowerCase();
    const category = optionalString(req.query.category, 80);
    const tag = optionalString(req.query.tag, 24);
    const sort = parseSort(req.query.sort);
    const { page, pageSize, offset } = parsePagination(req.query as Record<string, unknown>, {
      pageSize: 20,
      maxPageSize: 100,
    });
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (search) {
      conditions.push(
        '(lower(name) LIKE ? OR lower(version) LIKE ? OR lower(platform) LIKE ? OR lower(category) LIKE ? OR lower(filename) LIKE ? OR lower(tags) LIKE ?)',
      );
      const like = `%${search}%`;
      params.push(like, like, like, like, like, like);
    }
    if (category) {
      // 多级分类按前缀匹配：选中「开发工具」时包含「开发工具/IDE」
      conditions.push(`(category = ? OR category LIKE ? ESCAPE '\\')`);
      params.push(category, `${escapeLike(category)}/%`);
    }
    if (tag) {
      conditions.push(
        'EXISTS (SELECT 1 FROM json_each(software_packages.tags) AS jt WHERE jt.value = ?)',
      );
      params.push(tag);
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
        `SELECT id, name, version, platform, category, tags, filename, size_bytes, sha256,
                icon_path, download_count, source, verified_at, created_at, updated_at
         FROM software_packages ${where} ORDER BY ${SORT_ORDERS[sort]} LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, offset) as Array<SoftwareRow & { tags: string }>;
    res.json({
      items: rows.map((row) => ({
        ...row,
        tags: parseTagsColumn(row.tags),
        iconUrl: iconPublicUrl(row.icon_path),
      })),
      total,
      page,
      pageSize,
    });
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
  '/tags',
  asyncHandler(async (_req, res) => {
    const rows = getDb()
      .prepare(
        `SELECT jt.value AS tag, COUNT(*) AS count
         FROM software_packages, json_each(software_packages.tags) AS jt
         GROUP BY jt.value ORDER BY count DESC, tag ASC LIMIT 100`,
      )
      .all() as Array<{ tag: string; count: number }>;
    res.json({ items: rows });
  }),
);

adminSoftwareRouter.get(
  '/summary',
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const totals = db
      .prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(size_bytes), 0) AS bytes,
                COALESCE(SUM(download_count), 0) AS downloads,
                COUNT(DISTINCT category) AS categories
         FROM software_packages`,
      )
      .get() as { total: number; bytes: number; downloads: number; categories: number };
    const tagCount = (
      db
        .prepare(
          `SELECT COUNT(DISTINCT jt.value) AS count
           FROM software_packages, json_each(software_packages.tags) AS jt`,
        )
        .get() as { count: number }
    ).count;
    const pending = (
      db
        .prepare("SELECT COUNT(*) AS count FROM software_submissions WHERE status = 'pending'")
        .get() as { count: number }
    ).count;
    res.json({ ...totals, tags: tagCount, pendingSubmissions: pending });
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
    const source = normalizeCategoryPath(from, '');
    const target = normalizeCategoryPath(to, '');
    if (!source || !target) throw badRequest('分类名不能为空');
    if (source === target) {
      res.json({ changed: 0 });
      return;
    }
    if (!isValidCategoryPath(target)) throw badRequest('新分类路径不合法');
    const db = getDb();
    const info = db
      .prepare(
        `UPDATE software_packages
         SET category = ? || substr(category, ?), updated_at = ?
         WHERE category = ? OR category LIKE ? ESCAPE '\\'`,
      )
      .run(
        target,
        source.length + 1,
        nowIso(),
        source,
        `${escapeLike(source)}/%`,
      );
    audit(req, {
      action: 'software.category_rename',
      targetType: 'software',
      targetId: source,
      detail: { to: target, changed: info.changes },
    });
    res.json({ changed: info.changes });
  }),
);

const batchSchema = z
  .object({
    action: z.enum(['delete', 'set_category', 'add_tags', 'remove_tags']),
    ids: z.array(z.number().int().min(1)).min(1).max(100),
    category: z.string().trim().max(80).optional(),
    tags: z.array(z.string().trim().min(1).max(24)).max(12).optional(),
  })
  .strict();

adminSoftwareRouter.post(
  '/batch',
  asyncHandler(async (req, res) => {
    const fields = parseBody(batchSchema, req.body);
    const db = getDb();
    let changed = 0;

    if (fields.action === 'delete') {
      for (const id of fields.ids) {
        const row = getSoftwareById(id);
        if (!row) continue;
        await deleteSoftwareRow(row);
        changed += 1;
      }
    } else if (fields.action === 'set_category') {
      if (!fields.category) throw badRequest('请提供目标分类');
      const category = normalizeCategoryPath(fields.category, '');
      if (!category) throw badRequest('分类名不能为空');
      const placeholders = fields.ids.map(() => '?').join(',');
      const info = db
        .prepare(
          `UPDATE software_packages SET category = ?, updated_at = ? WHERE id IN (${placeholders})`,
        )
        .run(category, nowIso(), ...fields.ids);
      changed = info.changes;
    } else {
      const patchTags = fields.tags ?? [];
      if (patchTags.length === 0) throw badRequest('请提供标签');
      const update = db.prepare(
        'UPDATE software_packages SET tags = ?, updated_at = ? WHERE id = ?',
      );
      for (const id of fields.ids) {
        const row = getSoftwareById(id);
        if (!row) continue;
        const current = parseTagsColumn(row.tags);
        const next =
          fields.action === 'add_tags'
            ? normalizeTagList([...current, ...patchTags])
            : current.filter((tag) => !patchTags.includes(tag));
        if (next.join('\u0000') === current.join('\u0000')) continue;
        update.run(serializeTags(next), nowIso(), id);
        changed += 1;
      }
    }

    audit(req, {
      action: `software.batch_${fields.action}`,
      targetType: 'software',
      detail: { ids: fields.ids, changed, category: fields.category, tags: fields.tags },
    });
    res.json({ changed });
  }),
);

adminSoftwareRouter.get(
  '/submissions',
  asyncHandler(async (req, res) => {
    const statusRaw = optionalString(req.query.status, 20) ?? 'pending';
    const status: SubmissionStatus | 'all' =
      statusRaw === 'all' || ['pending', 'approved', 'rejected'].includes(statusRaw)
        ? (statusRaw as SubmissionStatus | 'all')
        : 'pending';
    const { page, pageSize } = parsePagination(req.query as Record<string, unknown>, {
      pageSize: 20,
      maxPageSize: 100,
    });
    const result = listSubmissions(status, page, pageSize);
    res.json({ ...result, page, pageSize, status });
  }),
);

adminSoftwareRouter.put(
  '/submissions/:id',
  asyncHandler(async (req, res) => {
    const id = intParam(req.params.id, {
      fallback: 0,
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
      name: 'id',
    });
    const fields = parseBody(
      z
        .object({
          category: z.string().trim().max(80).optional(),
          tags: z.array(z.string().trim().min(1).max(24)).max(12).optional(),
          note: z.string().max(500).optional(),
        })
        .strict(),
      req.body,
    );
    const updated = updateSubmission(id, fields);
    audit(req, {
      action: 'software.submission_update',
      targetType: 'software_submission',
      targetId: id,
      detail: { fields: Object.keys(fields) },
    });
    res.json(updated);
  }),
);

adminSoftwareRouter.post(
  '/submissions/:id/approve',
  asyncHandler(async (req, res) => {
    const id = intParam(req.params.id, {
      fallback: 0,
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
      name: 'id',
    });
    const fields = parseBody(
      z
        .object({
          category: z.string().trim().max(80).optional(),
          tags: z.array(z.string().trim().min(1).max(24)).max(12).optional(),
          note: z.string().max(500).optional(),
        })
        .strict(),
      req.body,
    );
    const result = await approveSubmission(id, fields, req.admin?.username ?? 'admin');
    audit(req, {
      action: 'software.submission_approve',
      targetType: 'software_submission',
      targetId: id,
      detail: { packageId: result.packageId, name: result.name, category: result.category },
    });
    res.json(result);
  }),
);

adminSoftwareRouter.post(
  '/submissions/:id/reject',
  asyncHandler(async (req, res) => {
    const id = intParam(req.params.id, {
      fallback: 0,
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
      name: 'id',
    });
    const fields = parseBody(
      z.object({ comment: z.string().trim().max(500).optional() }).strict(),
      req.body,
    );
    rejectSubmission(id, fields.comment ?? '', req.admin?.username ?? 'admin');
    audit(req, {
      action: 'software.submission_reject',
      targetType: 'software_submission',
      targetId: id,
      detail: { comment: fields.comment ?? '' },
    });
    res.json({ ok: true });
  }),
);

adminSoftwareRouter.delete(
  '/submissions/:id',
  asyncHandler(async (req, res) => {
    const id = intParam(req.params.id, {
      fallback: 0,
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
      name: 'id',
    });
    const row = getSubmissionById(id);
    if (!row) throw notFound('投稿不存在');
    await deleteSubmission(id);
    audit(req, {
      action: 'software.submission_delete',
      targetType: 'software_submission',
      targetId: id,
      detail: { name: row.name, status: row.status },
    });
    res.json({ ok: true });
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
    const row = requireSoftware(id);
    res.json({ ...row, tags: parseTagsColumn(row.tags), iconUrl: iconPublicUrl(row.icon_path) });
  }),
);

adminSoftwareRouter.post(
  '/upload',
  uploadMiddleware,
  asyncHandler(async (req, res) => {
    const uploaded = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
    const file = uploaded.file?.[0];
    const iconFile = uploaded.icon?.[0];
    if (!file) throw badRequest('请选择要上传的安装包文件');
    const tempPath = file.path;
    try {
      const fields = parseBody(
        z.object({
          name: z.string().trim().max(120).optional(),
          version: z.string().trim().max(80).optional(),
          platform: z.string().trim().max(80).optional(),
          category: z.string().trim().max(80).optional(),
          tags: z.union([z.string(), z.array(z.string())]).optional(),
          description_md: z.string().max(200_000).optional(),
        }),
        req.body,
      );
      const iconData = iconFile
        ? await fs.promises.readFile(iconFile.path).catch(() => {
            throw badRequest('图标文件读取失败');
          })
        : undefined;
      if (iconFile) {
        const ext = path.extname(iconFile.originalname).replace('.', '').toLowerCase();
        if (!ICON_EXTENSIONS.has(ext)) throw badRequest('图标仅支持 png / jpg / jpeg / webp / gif');
        if (iconFile.size > ICON_MAX_BYTES) throw badRequest('图标文件不能超过 512KB');
      }
      const result = await importSoftwarePackage({
        tempPath,
        originalName: file.originalname,
        name: fields.name,
        version: fields.version,
        platform: fields.platform,
        category: fields.category,
        tags: coerceTagInput(fields.tags),
        descriptionMd: fields.description_md,
        iconData,
        iconExt: iconFile ? path.extname(iconFile.originalname).replace('.', '') : undefined,
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
          withIcon: Boolean(iconFile),
        },
      });
      res.status(201).json(result);
    } finally {
      await removeIfExists(tempPath);
      if (iconFile) await removeIfExists(iconFile.path);
    }
  }),
);

function iconUploadMiddleware(req: Request, res: Response, next: NextFunction): void {
  const handler = multer({
    dest: path.join(config.storageDir, 'tmp', 'uploads'),
    limits: { fileSize: ICON_MAX_BYTES, files: 1, fields: 2 },
  }).single('icon');
  handler(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof multer.MulterError) {
      next(
        new ApiError(
          400,
          'UPLOAD_ERROR',
          error.code === 'LIMIT_FILE_SIZE' ? '图标文件不能超过 512KB' : `上传失败：${error.message}`,
        ),
      );
      return;
    }
    next(error);
  });
}

adminSoftwareRouter.post(
  '/:id/icon',
  iconUploadMiddleware,
  asyncHandler(async (req, res) => {
    const id = intParam(req.params.id, {
      fallback: 0,
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
      name: 'id',
    });
    const row = requireSoftware(id);
    const file = req.file;
    if (!file) throw badRequest('请选择图标文件');
    try {
      const iconPath = await saveIconUpload(file);
      getDb()
        .prepare('UPDATE software_packages SET icon_path = ?, updated_at = ? WHERE id = ?')
        .run(iconPath, nowIso(), id);
      audit(req, {
        action: 'software.icon_update',
        targetType: 'software',
        targetId: id,
        detail: { name: row.name },
      });
      res.json({ iconUrl: iconPublicUrl(iconPath) });
    } finally {
      await removeIfExists(file.path);
    }
  }),
);

adminSoftwareRouter.delete(
  '/:id/icon',
  asyncHandler(async (req, res) => {
    const id = intParam(req.params.id, {
      fallback: 0,
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
      name: 'id',
    });
    const row = requireSoftware(id);
    getDb()
      .prepare('UPDATE software_packages SET icon_path = NULL, updated_at = ? WHERE id = ?')
      .run(nowIso(), id);
    audit(req, {
      action: 'software.icon_remove',
      targetType: 'software',
      targetId: id,
      detail: { name: row.name },
    });
    res.json({ ok: true });
  }),
);

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    version: z.string().trim().max(80).optional(),
    platform: z.string().trim().max(80).optional(),
    category: z.string().trim().min(1).max(80).optional(),
    tags: z.union([z.string(), z.array(z.string())]).optional(),
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
    const category =
      fields.category !== undefined ? normalizeCategoryPath(fields.category, '') : row.category;
    if (!category) throw badRequest('分类名不能为空');
    const tags =
      fields.tags !== undefined
        ? serializeTags(coerceTagInput(fields.tags))
        : row.tags;
    const next = {
      name: fields.name ?? row.name,
      version: fields.version ?? row.version,
      platform: fields.platform ?? row.platform,
      category,
      tags,
      description_md: fields.description_md ?? row.description_md,
    };
    getDb()
      .prepare(
        `UPDATE software_packages
         SET name = ?, version = ?, platform = ?, category = ?, tags = ?, description_md = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        next.name,
        next.version,
        next.platform,
        next.category,
        next.tags,
        next.description_md,
        nowIso(),
        id,
      );
    audit(req, {
      action: 'software.update',
      targetType: 'software',
      targetId: id,
      detail: { fields: Object.keys(fields) },
    });
    const updated = getSoftwareById(id);
    res.json(updated ? { ...updated, tags: parseTagsColumn(updated.tags) } : updated);
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
    await deleteSoftwareRow(row);
    audit(req, {
      action: 'software.delete',
      targetType: 'software',
      targetId: id,
      detail: { filename: row.filename, name: row.name },
    });
    res.json({ ok: true, filename: row.filename });
  }),
);
