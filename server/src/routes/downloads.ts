import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { recordDownloadEvent } from '../analytics/events';
import { requireUserAccess } from '../auth/middleware';
import { config } from '../config';
import { ApiError, asyncHandler, notFound } from '../http/errors';
import { intParam } from '../http/validate';
import { logger } from '../logger';
import { getSetting } from '../services/settings';
import { getPublicFileById } from '../services/fileZone';
import { getDb, nowIso } from '../db';
import {
  assertArtifactType,
  findArtifact,
  incrementDownloadCount,
} from '../storage/artifacts';
import { contentDisposition, resolveWithin } from '../storage/paths';

export const downloadRouter = Router();

const activeDownloads = new Map<string, number>();

downloadRouter.use(requireUserAccess);

async function handlePublicFileDownload(req: Request, res: Response, next: NextFunction): Promise<void> {
  await (async () => {
    const id = intParam(req.params.id, {
      fallback: 0,
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
      name: 'id',
    });
    const row = getPublicFileById(id);
    if (!row) throw notFound('文件不存在或已过期');
    if (row.expires_at <= nowIso()) throw notFound('文件已过期清理');

    // 仅允许发送 public/ 区内的落盘文件：前缀白名单 + 存储根双重校验
    const storedKey = row.stored_path;
    if (!storedKey || storedKey.startsWith('/') || storedKey.split('/').includes('..')) {
      throw new ApiError(400, 'INVALID_PATH', '非法的存储路径');
    }
    if (!storedKey.startsWith('public/')) {
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
        resourceType: 'public_file',
        resourceId: id,
        filename: row.filename,
        statusCode: res.statusCode,
        bytesSent: Number(res.getHeader('content-length') ?? 0),
        rangeStart,
        durationMs: Date.now() - startedAt,
      });
      if (rangeStart === 0 && (res.statusCode === 200 || res.statusCode === 206)) {
        getDb()
          .prepare('UPDATE public_files SET download_count = download_count + 1 WHERE id = ?')
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
  })();
}

// 同一处理器同时接受连字符与下划线两种拼写，避免前端/第三方拼写不一致
downloadRouter.get('/public-file/:id', asyncHandler(handlePublicFileDownload));
downloadRouter.get('/public_file/:id', asyncHandler(handlePublicFileDownload));

downloadRouter.get(
  '/:type/:id',
  asyncHandler(async (req, res, next) => {
    const type = assertArtifactType(String(req.params.type));
    const id = intParam(req.params.id, {
      fallback: 0,
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
      name: 'id',
    });
    const record = findArtifact(type, id);
    if (!record) throw notFound('资源不存在');

    const storedPath = record.stored_path;
    if (!storedPath || storedPath.startsWith('/') || storedPath.split('/').includes('..')) {
      throw new ApiError(400, 'INVALID_PATH', '非法的存储路径');
    }
    const absolute = resolveWithin(storedPath);
    const root = path.resolve(config.storageDir);
    if (!absolute.startsWith(`${root}${path.sep}`)) {
      throw new ApiError(400, 'INVALID_PATH', '非法的存储路径');
    }
    const stat = await fs.promises.stat(absolute).catch(() => null);
    if (!stat || !stat.isFile()) throw notFound('文件已丢失，请管理员重新缓存');

    const limit = Math.max(
      1,
      Number(getSetting<number>('download.max_concurrent_per_ip')) ||
        config.downloadConcurrencyPerIp,
    );
    const ipKey = req.ip || 'unknown';
    const current = activeDownloads.get(ipKey) ?? 0;
    if (current >= limit) {
      res.setHeader('Retry-After', '30');
      throw new ApiError(429, 'DOWNLOAD_LIMIT', '同一 IP 并发下载数已达上限，请稍后重试');
    }
    activeDownloads.set(ipKey, current + 1);
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      const left = (activeDownloads.get(ipKey) ?? 1) - 1;
      if (left <= 0) activeDownloads.delete(ipKey);
      else activeDownloads.set(ipKey, left);
    };
    res.on('close', release);
    res.on('finish', release);

    const startedAt = Date.now();
    const rangeHeader = typeof req.headers.range === 'string' ? req.headers.range : '';
    const rangeMatch = rangeHeader.match(/^bytes=(\d+)-/);
    const rangeStart = rangeMatch ? Number(rangeMatch[1]) : 0;

    res.once('finish', () => {
      if (req.method !== 'GET') return;
      recordDownloadEvent(req, {
        resourceType: type,
        resourceId: id,
        filename: record.filename,
        statusCode: res.statusCode,
        bytesSent: Number(res.getHeader('content-length') ?? 0),
        rangeStart,
        durationMs: Date.now() - startedAt,
      });
      if (rangeStart === 0 && (res.statusCode === 200 || res.statusCode === 206)) {
        try {
          incrementDownloadCount(type, id);
        } catch (error) {
          logger.warn({ err: error, type, id }, '更新下载计数失败');
        }
      }
    });

    res.sendFile(
      record.stored_path,
      {
        root: config.storageDir,
        dotfiles: 'deny',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': contentDisposition(record.filename),
          'X-Content-Type-Options': 'nosniff',
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=3600',
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
