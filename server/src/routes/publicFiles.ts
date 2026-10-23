import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { hashPassword } from '../auth/password';
import { originGuard, requireUserAccess } from '../auth/middleware';
import { uploadLimiter } from '../auth/rateLimit';
import { config } from '../config';
import { getDb, nowIso } from '../db';
import { ApiError, asyncHandler, badRequest, forbidden } from '../http/errors';
import { optionalString, parseBody, parsePagination } from '../http/validate';
import { audit } from '../services/audit';
import {
  assertUploadAllowed,
  findUploadDuplicates,
  getUploadLimits,
  importZoneFile,
  zoneExpiryFromHours,
  zoneExpiryFromNow,
} from '../services/fileZone';
import {
  generatePickupCode,
  hmacPickupCode,
  isValidCustomCode,
  normalizePickupCode,
} from '../services/pickup';
import { getSetting } from '../services/settings';
import { removeIfExists, resolveWithin } from '../storage/paths';

export const publicFilesRouter = Router();

interface PublicFileRow {
  id: number;
  filename: string;
  stored_path: string;
  size_bytes: number;
  sha256: string;
  note: string;
  download_count: number;
  expires_at: string;
  created_at: string;
}

function uploadMiddleware(req: Request, res: Response, next: NextFunction): void {
  const limits = getUploadLimits();
  const maxBytes = Math.min(Math.max(limits.maxFileBytes, 1024 * 1024), 4 * 1024 * 1024 * 1024);
  const handler = multer({
    dest: path.join(config.storageDir, 'tmp', 'uploads'),
    limits: { fileSize: maxBytes, files: 1, fields: 6 },
  }).single('file');
  handler(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        next(new ApiError(413, 'FILE_TOO_LARGE', '文件超过大小限制'));
        return;
      }
      next(new ApiError(400, 'UPLOAD_ERROR', `上传失败：${error.message}`));
      return;
    }
    next(error);
  });
}

publicFilesRouter.use(requireUserAccess);

publicFilesRouter.get(
  '/files',
  asyncHandler(async (req, res) => {
    const search = (optionalString(req.query.q, 120) ?? '').toLowerCase();
    const sort = optionalString(req.query.sort, 20) ?? 'newest';
    const { page, pageSize, offset } = parsePagination(req.query as Record<string, unknown>, {
      pageSize: 20,
      maxPageSize: 60,
    });
    const now = nowIso();
    const where = search ? 'AND (lower(filename) LIKE ? OR lower(note) LIKE ?)' : '';
    const like = `%${search}%`;
    const order =
      sort === 'size' ? 'size_bytes DESC' : sort === 'downloads' ? 'download_count DESC' : 'created_at DESC';
    const db = getDb();
    const total = (
      db
        .prepare(`SELECT COUNT(*) AS count FROM public_files WHERE expires_at > ? ${where}`)
        .get(now, ...(search ? [like, like] : [])) as { count: number }
    ).count;
    const rows = db
      .prepare(
        `SELECT id, filename, size_bytes, sha256, note, download_count, expires_at, created_at
         FROM public_files WHERE expires_at > ? ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
      )
      .all(now, ...(search ? [like, like] : []), pageSize, offset) as PublicFileRow[];
    const limits = getUploadLimits();
    res.json({
      items: rows.map((row) => ({
        id: row.id,
        filename: row.filename,
        sizeBytes: row.size_bytes,
        sha256: row.sha256,
        note: row.note,
        downloadCount: row.download_count,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
      })),
      total,
      page,
      pageSize,
      limits: {
        maxFileBytes: limits.maxFileBytes,
        blockedExtensions: limits.blockedExtensions,
        quotaBytes: limits.quotaBytes,
        retentionDays: Number(getSetting<number>('public.retention_days')) || 7,
      },
    });
  }),
);

publicFilesRouter.post(
  '/files',
  uploadLimiter,
  originGuard,
  uploadMiddleware,
  asyncHandler(async (req, res) => {
    if (!getSetting<boolean>('public.enabled')) throw forbidden('公共文件区已关闭');
    const file = req.file;
    if (!file) throw badRequest('请选择要上传的文件');
    const tempPath = file.path;
    try {
      const fields = parseBody(
        z.object({ note: z.string().max(300).optional() }),
        req.body,
      );
      const size = (await fs.promises.stat(tempPath)).size;
      assertUploadAllowed(file.originalname, size);
      const imported = await importZoneFile('public', tempPath, file.originalname);

      // 内容查重：与未过期的公共区文件或软件包哈希相同时拒绝，并清理刚落盘的文件
      const duplicates = findUploadDuplicates(imported.sha256);
      if (duplicates.length > 0) {
        await removeIfExists(resolveWithin(imported.storedPath));
        throw new ApiError(409, 'DUPLICATE_FILE', '文件内容与已有资源重复，本次上传未保存', {
          duplicates,
        });
      }
      const retentionDays = Math.min(Math.max(Number(getSetting<number>('public.retention_days')) || 7, 1), 3650);
      const expiresAt = zoneExpiryFromNow(retentionDays);
      const result = getDb()
        .prepare(
          `INSERT INTO public_files
            (filename, stored_path, size_bytes, sha256, note, uploader_ip, visitor_id, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          imported.displayName,
          imported.storedPath,
          imported.sizeBytes,
          imported.sha256,
          fields.note ?? '',
          req.ip ?? '',
          req.visitorId ?? '',
          expiresAt,
        );
      audit(req, {
        action: 'public_file.upload',
        targetType: 'public_file',
        targetId: Number(result.lastInsertRowid),
        detail: { filename: imported.displayName, size: imported.sizeBytes, expiresAt },
      });
      res.status(201).json({
        id: Number(result.lastInsertRowid),
        filename: imported.displayName,
        sizeBytes: imported.sizeBytes,
        sha256: imported.sha256,
        expiresAt,
      });
    } finally {
      await removeIfExists(tempPath);
    }
  }),
);

publicFilesRouter.post(
  '/share',
  uploadLimiter,
  originGuard,
  uploadMiddleware,
  asyncHandler(async (req, res) => {
    if (!getSetting<boolean>('share.enabled')) throw forbidden('私人文件传递已关闭');
    const file = req.file;
    if (!file) throw badRequest('请选择要上传的文件');
    const tempPath = file.path;
    try {
      const defaultHours = Math.min(
        Math.max(Number(getSetting<number>('share.default_hours')) || 72, 1),
        8760,
      );
      const maxHours = Math.min(
        Math.max(Number(getSetting<number>('share.max_hours')) || 720, defaultHours),
        8760,
      );
      const fields = parseBody(
        z.object({
          note: z.string().max(300).optional(),
          expires_hours: z.coerce.number().int().min(1).max(8760).optional(),
          pickup_code: z.string().max(32).optional(),
          max_downloads: z.coerce.number().int().min(1).max(10000).optional(),
        }),
        req.body,
      );
      const hours = Math.min(fields.expires_hours ?? defaultHours, maxHours);
      const customCode = fields.pickup_code ? normalizePickupCode(fields.pickup_code) : null;
      if (customCode !== null && !isValidCustomCode(customCode)) {
        throw badRequest('自定义取件码需为 4-16 位字母或数字');
      }

      const size = (await fs.promises.stat(tempPath)).size;
      assertUploadAllowed(file.originalname, size);
      const imported = await importZoneFile('shares', tempPath, file.originalname);

      const code = customCode ?? generatePickupCode();
      const codeHmac = hmacPickupCode(code);
      const codeHash = await hashPassword(code);
      const expiresAt = zoneExpiryFromHours(hours);
      const db = getDb();
      let shareId = 0;
      try {
        const result = db
          .prepare(
            `INSERT INTO file_shares
              (filename, stored_path, size_bytes, sha256, note, code_hash, code_hmac, max_downloads, uploader_ip, visitor_id, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            imported.displayName,
            imported.storedPath,
            imported.sizeBytes,
            imported.sha256,
            fields.note ?? '',
            codeHash,
            codeHmac,
            fields.max_downloads ?? null,
            req.ip ?? '',
            req.visitorId ?? '',
            expiresAt,
          );
        shareId = Number(result.lastInsertRowid);
      } catch (error) {
        // 自定义取件码冲突（UNIQUE code_hmac）时清理已落盘文件
        await removeIfExists(resolveWithin(imported.storedPath));
        if ((error as Error).message?.includes('UNIQUE')) {
          throw badRequest('该取件码已被占用，请换一个');
        }
        throw error;
      }

      audit(req, {
        action: 'share.create',
        targetType: 'file_share',
        targetId: shareId,
        detail: { filename: imported.displayName, size: imported.sizeBytes, expiresAt, customCode: Boolean(customCode) },
      });
      res.status(201).json({
        id: shareId,
        code,
        filename: imported.displayName,
        sizeBytes: imported.sizeBytes,
        expiresAt,
        maxDownloads: fields.max_downloads ?? null,
      });
    } finally {
      await removeIfExists(tempPath);
    }
  }),
);
