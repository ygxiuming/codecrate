import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { recordDownloadEvent } from '../analytics/events';
import { verifyPassword } from '../auth/password';
import { originGuard } from '../auth/middleware';
import { shareRedeemLimiter } from '../auth/rateLimit';
import { config } from '../config';
import { getDb } from '../db';
import { ApiError, asyncHandler, notFound } from '../http/errors';
import { intParam, parseBody } from '../http/validate';
import { assertShareUsable, getActiveShare, type ShareRow } from '../services/fileZone';
import {
  hmacPickupCode,
  issueShareToken,
  normalizePickupCode,
  verifyShareToken,
} from '../services/pickup';
import { contentDisposition, resolveWithin } from '../storage/paths';

export const shareRouter = Router();

interface RedeemResultRow {
  id: number;
  filename: string;
  size_bytes: number;
  sha256: string;
  note: string;
  code_hash: string;
  max_downloads: number | null;
  download_count: number;
  revoked: number;
  expires_at: string;
}

shareRouter.post(
  '/redeem',
  shareRedeemLimiter,
  originGuard,
  asyncHandler(async (req, res) => {
    const { code } = parseBody(z.object({ code: z.string().min(4).max(32) }), req.body);
    const normalized = normalizePickupCode(code);
    const codeHmac = hmacPickupCode(normalized);
    const rows = getDb()
      .prepare(
        `SELECT id, filename, size_bytes, sha256, note, code_hash, max_downloads, download_count, revoked, expires_at
         FROM file_shares WHERE code_hmac = ?`,
      )
      .all(codeHmac) as RedeemResultRow[];

    let matched: RedeemResultRow | null = null;
    for (const row of rows) {
      if (await verifyPassword(normalized, row.code_hash)) {
        matched = row;
        break;
      }
    }
    if (!matched) throw notFound('取件码不正确');
    assertShareUsable(matched as ShareRow);

    const token = issueShareToken(matched.id);
    res.json({
      id: matched.id,
      filename: matched.filename,
      sizeBytes: matched.size_bytes,
      sha256: matched.sha256,
      note: matched.note,
      expiresAt: matched.expires_at,
      downloadUrl: `/api/share/${matched.id}/file?token=${encodeURIComponent(token.token)}`,
      tokenExpiresAt: new Date(token.expiresAt).toISOString(),
    });
  }),
);

shareRouter.get(
  '/:id/file',
  asyncHandler(async (req, res, next) => {
    const id = intParam(req.params.id, {
      fallback: 0,
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
      name: 'id',
    });
    if (!verifyShareToken(id, req.query.token)) {
      throw new ApiError(403, 'INVALID_TOKEN', '下载链接无效或已过期，请重新取件');
    }
    const row = getActiveShare(id);

    // 仅允许发送 shares/ 区内的落盘文件：前缀白名单 + 存储根双重校验
    const storedKey = row.stored_path;
    if (!storedKey || storedKey.startsWith('/') || storedKey.split('/').includes('..')) {
      throw new ApiError(400, 'INVALID_PATH', '非法的存储路径');
    }
    if (!storedKey.startsWith('shares/')) {
      throw new ApiError(400, 'INVALID_PATH', '非法的存储路径');
    }
    const absolute = resolveWithin(storedKey);
    const root = path.resolve(config.storageDir);
    if (!absolute.startsWith(`${root}${path.sep}`)) {
      throw new ApiError(400, 'INVALID_PATH', '非法的存储路径');
    }
    const stat = await fs.promises.stat(absolute).catch(() => null);
    if (!stat || !stat.isFile()) throw notFound('文件已丢失');

    const startedAt = Date.now();
    const rangeHeader = typeof req.headers.range === 'string' ? req.headers.range : '';
    const rangeMatch = rangeHeader.match(/^bytes=(\d+)-/);
    const rangeStart = rangeMatch ? Number(rangeMatch[1]) : 0;

    res.once('finish', () => {
      if (req.method !== 'GET') return;
      recordDownloadEvent(req, {
        resourceType: 'share',
        resourceId: id,
        filename: row.filename,
        statusCode: res.statusCode,
        bytesSent: Number(res.getHeader('content-length') ?? 0),
        rangeStart,
        durationMs: Date.now() - startedAt,
      });
      if (rangeStart === 0 && (res.statusCode === 200 || res.statusCode === 206)) {
        getDb()
          .prepare('UPDATE file_shares SET download_count = download_count + 1 WHERE id = ?')
          .run(id);
      }
    });

    res.sendFile(
      storedKey,
      {
        root: config.storageDir,
        dotfiles: 'deny',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': contentDisposition(row.filename),
          'X-Content-Type-Options': 'nosniff',
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store',
        },
      },
      (error) => {
        if (!error) return;
        if (res.headersSent) {
          res.destroy();
          return;
        }
        next(error);
      },
    );
  }),
);
