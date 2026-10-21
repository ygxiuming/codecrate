import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, badRequest } from '../../http/errors';
import { intParam, normalizePageParams, parseBody } from '../../http/validate';
import { audit } from '../../services/audit';
import { scanStorage } from '../../services/storageScan';
import {
  assertArtifactType,
  deleteArtifact,
  listArtifacts,
} from '../../storage/artifacts';
import { verifyArtifact } from '../../storage/integrity';
import { cleanupTempFiles, getStorageUsage } from '../../storage/usage';

export const adminStorageRouter = Router();

adminStorageRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const usage = await getStorageUsage();
    res.json(usage);
  }),
);

adminStorageRouter.get(
  '/artifacts',
  asyncHandler(async (req, res) => {
    const type = assertArtifactType(String(req.query.type ?? 'vscode'));
    const { search, page } = normalizePageParams(req.query as Record<string, unknown>);
    const result = listArtifacts(type, {
      search,
      page: page.page,
      pageSize: page.pageSize,
      offset: page.offset,
    });
    res.json({ ...result, type });
  }),
);

adminStorageRouter.post(
  '/verify',
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        type: z.enum(['vscode', 'extension', 'remote-server']),
        id: z.number().int().positive(),
      }),
      req.body,
    );
    if (!Number.isSafeInteger(body.id) || body.id < 1) throw badRequest('非法的资源 ID');
    const result = await verifyArtifact(body.type, body.id);
    audit(req, {
      action: 'storage.verify',
      targetType: body.type,
      targetId: body.id,
      detail: { ok: result.ok },
    });
    res.json(result);
  }),
);

adminStorageRouter.delete(
  '/:type/:id',
  asyncHandler(async (req, res) => {
    const type = assertArtifactType(String(req.params.type));
    const id = intParam(req.params.id, {
      fallback: 0,
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
      name: 'id',
    });
    if (!Number.isSafeInteger(id) || id < 1) throw badRequest('非法的资源 ID');
    const record = await deleteArtifact(type, id);
    audit(req, {
      action: 'storage.delete',
      targetType: type,
      targetId: id,
      detail: { filename: record.filename, sha256: record.sha256 },
    });
    res.json({ ok: true, filename: record.filename });
  }),
);

adminStorageRouter.post(
  '/cleanup',
  asyncHandler(async (req, res) => {
    const result = await cleanupTempFiles();
    audit(req, {
      action: 'storage.cleanup',
      detail: result,
    });
    res.json(result);
  }),
);

adminStorageRouter.post(
  '/scan',
  asyncHandler(async (req, res) => {
    const result = await scanStorage();
    audit(req, {
      action: 'storage.scan',
      detail: result,
    });
    res.json(result);
  }),
);
