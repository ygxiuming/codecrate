import { Router } from 'express';
import { z } from 'zod';
import { getMarketplaceAdapter, listMarketplaceAdapters } from '../../adapters';
import { resolveRemoteServerPackage } from '../../adapters/remoteServer';
import { invalidateVSCodeCaches, listVSCodeVersions } from '../../adapters/vscode';
import { hashPassword, verifyPassword } from '../../auth/password';
import { config } from '../../config';
import { asyncHandler, badRequest } from '../../http/errors';
import { parseBody } from '../../http/validate';
import { networkErrorHint } from '../../net/networkHints';
import { audit } from '../../services/audit';
import {
  getSetting,
  getSettingsSnapshot,
  setSetting,
  setSettings,
} from '../../services/settings';

export const adminSettingsRouter = Router();

const httpUrl = z
  .string()
  .url()
  .max(500)
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }, '必须是 http/https 地址');

const settingsSchema = z
  .object({
    'site.name': z.string().trim().min(1).max(80).optional(),
    'site.description': z.string().trim().max(300).optional(),
    'marketplace.provider': z.enum(['official', 'openvsx']).optional(),
    'marketplace.official.endpoint': httpUrl.optional(),
    'marketplace.openvsx.endpoint': httpUrl.optional(),
    'gallery.public_base_url': z.union([z.literal(''), httpUrl]).optional(),
    'sources.vscode.releases_url': httpUrl.optional(),
    'sources.vscode.download_base': httpUrl.optional(),
    'sources.remote.download_base': httpUrl.optional(),
    'cache.concurrency': z.number().int().min(1).max(16).optional(),
    'cache.max_attempts': z.number().int().min(1).max(10).optional(),
    'download.max_concurrent_per_ip': z.number().int().min(1).max(64).optional(),
    'upload.max_bytes': z.number().int().min(1024 * 1024).max(4 * 1024 * 1024 * 1024).optional(),
    'upload.remote_max_bytes': z
      .number()
      .int()
      .min(1024 * 1024)
      .max(4 * 1024 * 1024 * 1024)
      .optional(),
    'access_log.enabled': z.boolean().optional(),
    'access_log.retention_days': z
      .number()
      .int()
      .min(0)
      .max(3650)
      .refine((value) => value === 0 || value >= 7, '保留天数需为 0（永久）或至少 7 天')
      .optional(),
    'access.require_login': z.boolean().optional(),
    'access.code': z.union([z.string().min(4).max(128), z.null()]).optional(),
  })
  .strict();

adminSettingsRouter.get('/', (_req, res) => {
  const snapshot = getSettingsSnapshot();
  const accessCodeSet = Boolean(getSetting<string>('access.code_hash'));
  delete snapshot['access.code_hash'];
  delete snapshot['security.cookie_secret'];
  res.json({
    settings: snapshot,
    accessCodeSet,
    info: {
      storageDir: config.storageDir,
      dbPath: config.dbPath,
      webDist: config.webDist,
      dataDir: config.dataDir,
      allowedPrivateHosts: config.networkAllowedPrivateHosts,
      sessionHours: config.sessionHours,
      nodeEnv: config.env,
      version: '1.0.0',
      providers: listMarketplaceAdapters(),
    },
  });
});

adminSettingsRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = parseBody(settingsSchema, req.body);
    const accessCode = parsed['access.code'];
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (key !== 'access.code' && value !== undefined) patch[key] = value;
    }
    if (Object.keys(patch).length > 0) setSettings(patch);

    let accessCodeAction: 'unchanged' | 'updated' | 'cleared' = 'unchanged';
    if (accessCode !== undefined) {
      if (accessCode === null || accessCode === '') {
        setSetting('access.code_hash', '');
        accessCodeAction = 'cleared';
      } else {
        setSetting('access.code_hash', await hashPassword(accessCode));
        accessCodeAction = 'updated';
      }
      setSetting('access.require_login', true);
    }

    invalidateVSCodeCaches();
    audit(req, {
      action: 'settings.update',
      detail: { keys: Object.keys(patch), accessCode: accessCodeAction },
    });
    res.json({ ok: true, accessCode: accessCodeAction });
  }),
);

adminSettingsRouter.post(
  '/test-source',
  asyncHandler(async (req, res) => {
    const { type } = parseBody(
      z.object({ type: z.enum(['vscode', 'marketplace', 'openvsx', 'remote']) }),
      req.body,
    );
    const started = Date.now();
    try {
      if (type === 'vscode') {
        const versions = await listVSCodeVersions();
        res.json({
          ok: true,
          latencyMs: Date.now() - started,
          count: versions.length,
          sample: versions.slice(0, 5),
        });
        return;
      }
      if (type === 'remote') {
        const versions = await listVSCodeVersions();
        const version = versions[0];
        if (!version) throw badRequest('没有可用的 VS Code 版本');
        const artifact = await resolveRemoteServerPackage(version, 'linux-x64');
        res.json({
          ok: true,
          latencyMs: Date.now() - started,
          version,
          commitHash: artifact.commitHash,
          filename: artifact.filename,
          sizeBytes: artifact.sizeBytes,
        });
        audit(req, { action: 'settings.test_source', targetType: 'source', targetId: type });
        return;
      }
      const adapter = getMarketplaceAdapter(type);
      const page = await adapter.search({
        q: '',
        sort: 'downloads',
        page: 1,
        pageSize: 1,
      });
      res.json({
        ok: true,
        latencyMs: Date.now() - started,
        provider: adapter.id,
        total: page.total,
        sample: page.items[0]
          ? { id: page.items[0].id, version: page.items[0].version }
          : null,
      });
      audit(req, { action: 'settings.test_source', targetType: 'source', targetId: type });
    } catch (error) {
      const message = (error as Error).message;
      res.json({
        ok: false,
        latencyMs: Date.now() - started,
        error: message,
        hint: networkErrorHint(message),
      });
    }
  }),
);

// 供后续扩展：校验访问码是否匹配（不返回哈希）
adminSettingsRouter.post(
  '/verify-access-code',
  asyncHandler(async (req, res) => {
    const { code } = parseBody(z.object({ code: z.string().min(1).max(200) }), req.body);
    const hash = getSetting<string>('access.code_hash');
    res.json({ ok: Boolean(hash) && (await verifyPassword(code, hash)) });
  }),
);
