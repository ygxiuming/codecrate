import { Router } from 'express';
import { z } from 'zod';
import {
  getMarketplaceAdapter,
  listMarketplaceAdapters,
} from '../../adapters';
import { MARKETPLACE_CATEGORIES } from '../../adapters/platforms';
import { getDb } from '../../db';
import { asyncHandler, badRequest, conflict, notFound } from '../../http/errors';
import { optionalString, parseBody, parsePagination } from '../../http/validate';
import { audit } from '../../services/audit';
import { enqueueExtension, hasExtensionArtifact } from '../../services/queue';

export const adminMarketplaceRouter = Router();

interface CachedRow {
  id: number;
  extension_id: string;
  version: string;
  target_platform: string;
}

function cachedIndex(): Map<string, CachedRow[]> {
  const rows = getDb()
    .prepare('SELECT id, extension_id, version, target_platform FROM extensions')
    .all() as CachedRow[];
  const map = new Map<string, CachedRow[]>();
  for (const row of rows) {
    const list = map.get(row.extension_id) ?? [];
    list.push(row);
    map.set(row.extension_id, list);
  }
  return map;
}

adminMarketplaceRouter.get('/providers', (_req, res) => {
  res.json({ providers: listMarketplaceAdapters(), categories: MARKETPLACE_CATEGORIES });
});

adminMarketplaceRouter.get(
  '/search',
  asyncHandler(async (req, res) => {
    const provider = optionalString(req.query.provider, 20);
    const q = optionalString(req.query.q, 120) ?? '';
    const category = optionalString(req.query.category, 80);
    const sortRaw = optionalString(req.query.sort, 20) ?? 'downloads';
    const sort = (['relevance', 'downloads', 'updated'] as const).includes(
      sortRaw as 'relevance' | 'downloads' | 'updated',
    )
      ? (sortRaw as 'relevance' | 'downloads' | 'updated')
      : 'downloads';
    const { page, pageSize } = parsePagination(req.query as Record<string, unknown>, {
      pageSize: 20,
      maxPageSize: 50,
    });
    const adapter = getMarketplaceAdapter(provider);
    const result = await adapter.search({ q, category, sort, page, pageSize });
    const cached = cachedIndex();
    res.json({
      ...result,
      providers: listMarketplaceAdapters(),
      categories: MARKETPLACE_CATEGORIES,
      items: result.items.map((item) => {
        const rows = cached.get(item.id) ?? [];
        return {
          ...item,
          cached: rows.length > 0,
          cachedVersions: [...new Set(rows.map((row) => row.version))].slice(0, 8),
        };
      }),
    });
  }),
);

adminMarketplaceRouter.get(
  '/extension',
  asyncHandler(async (req, res) => {
    const provider = optionalString(req.query.provider, 20);
    const id = optionalString(req.query.id, 120);
    if (!id) throw badRequest('缺少插件 ID');
    const adapter = getMarketplaceAdapter(provider);
    const detail = await adapter.detail(id);
    const cached = getDb()
      .prepare(
        'SELECT id, version, target_platform FROM extensions WHERE extension_id = ? ORDER BY version DESC',
      )
      .all(id.toLowerCase()) as CachedRow[];
    res.json({
      detail,
      cached: cached.map((row) => ({
        artifactId: row.id,
        version: row.version,
        targetPlatform: row.target_platform || 'universal',
      })),
    });
  }),
);

adminMarketplaceRouter.post(
  '/cache',
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        provider: z.enum(['official', 'openvsx']).optional(),
        id: z.string().min(3).max(120),
        version: z.string().min(1).max(64).optional(),
        targetPlatform: z.string().max(40).optional(),
      }),
      req.body,
    );
    const adapter = getMarketplaceAdapter(body.provider);
    const resolved = await adapter.resolvePackage(body.id, body.version, body.targetPlatform);
    if (!resolved.version) throw notFound('无法确定插件版本');
    if (hasExtensionArtifact(resolved.id, resolved.version, resolved.targetPlatform)) {
      throw conflict(
        `插件 ${resolved.id}@${resolved.version} (${resolved.targetPlatform || 'universal'}) 已缓存`,
      );
    }
    const result = enqueueExtension(resolved, req.admin?.id ?? null);
    if (!result.created) {
      throw conflict('该插件的缓存任务已存在', {
        taskId: result.taskId,
        status: result.status,
      });
    }
    audit(req, {
      action: 'marketplace.cache',
      targetType: 'extension',
      targetId: resolved.id,
      detail: {
        provider: resolved.provider,
        version: resolved.version,
        targetPlatform: resolved.targetPlatform,
        taskId: result.taskId,
      },
    });
    res.status(202).json({
      taskId: result.taskId,
      resolved: {
        provider: resolved.provider,
        id: resolved.id,
        displayName: resolved.displayName,
        version: resolved.version,
        targetPlatform: resolved.targetPlatform,
        engineRange: resolved.engineRange,
      },
    });
  }),
);
