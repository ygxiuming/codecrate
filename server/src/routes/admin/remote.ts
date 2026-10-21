import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../../config';
import { ApiError, asyncHandler, badRequest } from '../../http/errors';
import { parseBody } from '../../http/validate';
import { audit } from '../../services/audit';
import { importRemoteServerPackage } from '../../services/remoteUpload';
import { getSetting } from '../../services/settings';
import { removeIfExists } from '../../storage/paths';

export const adminRemoteRouter = Router();

function uploadMiddleware(req: Request, res: Response, next: NextFunction): void {
  const configured = Number(getSetting<number>('upload.remote_max_bytes')) || 1024 * 1024 * 1024;
  const maxBytes = Math.min(Math.max(configured, 1024 * 1024), 4 * 1024 * 1024 * 1024);
  const handler = multer({
    dest: path.join(config.storageDir, 'tmp', 'uploads'),
    limits: { fileSize: maxBytes, files: 1, fields: 10 },
    fileFilter: (_request, file, callback) => {
      if (!/\.(tar\.gz|tgz|zip)$/i.test(file.originalname)) {
        callback(
          new ApiError(400, 'INVALID_FILE_TYPE', '只允许上传 .tar.gz、.tgz 或 .zip 的 server 包'),
        );
        return;
      }
      callback(null, true);
    },
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

adminRemoteRouter.post(
  '/upload',
  uploadMiddleware,
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) throw badRequest('请选择要上传的 server 包');
    const tempPath = file.path;
    try {
      const body = parseBody(
        z.object({
          version: z.string().trim().max(40).optional(),
          platform: z.string().trim().max(40).optional(),
          commit: z.string().trim().max(40).optional(),
        }),
        req.body,
      );
      if (body.version && !/^[0-9A-Za-z][0-9A-Za-z._-]{0,39}$/.test(body.version)) {
        throw badRequest('版本号格式不合法');
      }
      if (body.platform && !/^[a-z0-9][a-z0-9-]{0,39}$/.test(body.platform)) {
        throw badRequest('平台标识格式不合法');
      }
      if (body.commit && !/^[0-9a-fA-F]{7,40}$/.test(body.commit)) {
        throw badRequest('commit 格式不合法');
      }
      const result = await importRemoteServerPackage({
        tempPath,
        originalName: file.originalname,
        version: body.version,
        platform: body.platform,
        commit: body.commit,
      });
      audit(req, {
        action: 'remote.upload',
        targetType: 'remote_server',
        targetId: `${result.version}/${result.commitHash}/${result.platform}`,
        detail: {
          version: result.version,
          platform: result.platform,
          commitHash: result.commitHash,
          filename: result.filename,
          size: result.sizeBytes,
        },
      });
      res.status(201).json(result);
    } finally {
      await removeIfExists(tempPath);
    }
  }),
);
