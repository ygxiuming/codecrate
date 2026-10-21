import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../../config';
import { ApiError, asyncHandler, badRequest, conflict } from '../../http/errors';
import { intParam, normalizePageParams } from '../../http/validate';
import { audit } from '../../services/audit';
import { iconPublicUrl, saveIcon } from '../../services/icons';
import { hasExtensionArtifact, upsertExtension } from '../../services/queue';
import { parseVsix } from '../../services/vsix';
import { getSetting } from '../../services/settings';
import { deleteArtifact, listArtifacts } from '../../storage/artifacts';
import {
  hashFile,
  removeIfExists,
  resolveWithin,
  safeFilename,
  storageRelative,
} from '../../storage/paths';

export const adminExtensionsRouter = Router();

function uploadMiddleware(req: Request, res: Response, next: NextFunction): void {
  const configured = Number(getSetting<number>('upload.max_bytes')) || config.uploadMaxBytes;
  const maxBytes = Math.min(Math.max(configured, 1024 * 1024), 4 * 1024 * 1024 * 1024);
  const handler = multer({
    dest: path.join(config.storageDir, 'tmp', 'uploads'),
    limits: { fileSize: maxBytes, files: 1, fields: 10 },
    fileFilter: (_request, file, callback) => {
      if (!/\.vsix$/i.test(file.originalname)) {
        callback(new ApiError(400, 'INVALID_FILE_TYPE', '只允许上传 .vsix 插件包'));
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

function ensureVsixName(name: string): string {
  return name.toLowerCase().endsWith('.vsix') ? name : `${name}.vsix`;
}

async function moveFile(from: string, to: string): Promise<void> {
  try {
    await fs.promises.rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await fs.promises.copyFile(from, to);
    await fs.promises.unlink(from);
  }
}

adminExtensionsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { search, page } = normalizePageParams(req.query as Record<string, unknown>);
    const result = listArtifacts('extension', {
      search,
      page: page.page,
      pageSize: page.pageSize,
      offset: page.offset,
    });
    res.json(result);
  }),
);

adminExtensionsRouter.post(
  '/upload',
  uploadMiddleware,
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) throw badRequest('请选择要上传的 .vsix 文件');
    const tempPath = file.path;
    try {
      const parsed = await parseVsix(tempPath);
      const metadata = parsed.metadata;
      if (hasExtensionArtifact(metadata.extensionId, metadata.version, '')) {
        throw conflict(`插件 ${metadata.extensionId}@${metadata.version} 已存在，请勿重复上传`);
      }

      const filename = ensureVsixName(
        safeFilename(
          file.originalname,
          `${metadata.extensionId}-${metadata.version}.vsix`,
        ),
      );
      const relativeDir = storageRelative(
        'extensions',
        metadata.publisher,
        metadata.name,
        metadata.version,
      );
      const relativePath = `${relativeDir}/${filename}`;
      const absolute = resolveWithin(relativePath);
      await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
      const sha256 = await hashFile(tempPath);
      const size = (await fs.promises.stat(tempPath)).size;
      await removeIfExists(absolute);
      await moveFile(tempPath, absolute);

      let iconPath: string | null = null;
      if (parsed.icon) {
        iconPath = await saveIcon(parsed.icon.data, path.extname(parsed.icon.filename).slice(1));
      }

      const artifactId = upsertExtension({
        extensionId: metadata.extensionId,
        publisher: metadata.publisher,
        name: metadata.name,
        displayName: metadata.displayName,
        version: metadata.version,
        targetPlatform: '',
        description: metadata.description,
        engineRange: metadata.engineRange,
        categories: metadata.categories,
        keywords: metadata.keywords,
        dependencies: metadata.dependencies,
        extensionPack: metadata.extensionPack,
        iconPath,
        source: 'upload',
        license: metadata.license,
        repositoryUrl: metadata.repositoryUrl,
        homepage: metadata.homepage,
        filename,
        storedPath: relativePath,
        size,
        sha256,
      });

      audit(req, {
        action: 'extension.upload',
        targetType: 'extension',
        targetId: metadata.extensionId,
        detail: { version: metadata.version, size, filename },
      });

      res.status(201).json({
        artifactId,
        filename,
        sizeBytes: size,
        sha256,
        iconUrl: iconPublicUrl(iconPath),
        metadata,
      });
    } finally {
      await removeIfExists(tempPath);
    }
  }),
);

adminExtensionsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = intParam(req.params.id, {
      fallback: 0,
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
      name: 'id',
    });
    const record = await deleteArtifact('extension', id);
    audit(req, {
      action: 'extension.delete',
      targetType: 'extension',
      targetId: id,
      detail: { filename: record.filename, extensionId: record.extension_id },
    });
    res.json({ ok: true, filename: record.filename });
  }),
);
