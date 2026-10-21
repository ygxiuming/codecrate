import { Router } from 'express';
import { z } from 'zod';
import {
  DEFAULT_REMOTE_PLATFORMS,
  DEFAULT_VSCODE_PLATFORMS,
  REMOTE_SERVER_PLATFORMS,
  VSCODE_PLATFORMS,
  findRemotePlatform,
  findVSCodePlatform,
} from '../../adapters/platforms';
import { resolveRemoteServerPackage } from '../../adapters/remoteServer';
import { invalidateVSCodeCaches, listVSCodeVersions, resolveVSCodePackage } from '../../adapters/vscode';
import { getDb } from '../../db';
import { badRequest, asyncHandler } from '../../http/errors';
import { optionalString, parseBody, parsePagination } from '../../http/validate';
import { logger } from '../../logger';
import { networkErrorHint } from '../../net/networkHints';
import { audit } from '../../services/audit';
import { lookupCommitByPrefix } from '../../services/commitLookup';
import {
  enqueueRemoteServer,
  enqueueVSCode,
  hasRemoteArtifact,
  hasVSCodeArtifact,
} from '../../services/queue';
import { getSetting } from '../../services/settings';
import { compareVersions, isValidVSCodeVersion } from '../../utils/semver';

export const adminVscodeRouter = Router();

interface CachedRow {
  version: string;
  count: number;
  platforms: string | null;
  commit_hash?: string | null;
}

function cachedVSCode(): Map<string, CachedRow> {
  const rows = getDb()
    .prepare(
      `SELECT version, COUNT(*) AS count, GROUP_CONCAT(platform) AS platforms,
              MAX(commit_hash) AS commit_hash
       FROM vscode_packages GROUP BY version`,
    )
    .all() as CachedRow[];
  return new Map(rows.map((row) => [row.version, row]));
}

function cachedRemote(): Map<string, CachedRow> {
  const rows = getDb()
    .prepare(
      `SELECT version, COUNT(*) AS count, GROUP_CONCAT(platform) AS platforms,
              MAX(commit_hash) AS commit_hash
       FROM remote_servers GROUP BY version`,
    )
    .all() as CachedRow[];
  return new Map(rows.map((row) => [row.version, row]));
}

async function loadVersionCatalog(): Promise<{
  versions: string[];
  sourceAvailable: boolean;
  warning?: string;
}> {
  const vscodeCache = cachedVSCode();
  const remoteCache = cachedRemote();
  const fallback = [...new Set([...vscodeCache.keys(), ...remoteCache.keys()])].sort((a, b) =>
    compareVersions(b, a),
  );
  try {
    const versions = await listVSCodeVersions();
    const merged = [...new Set([...versions, ...fallback])].sort((a, b) => compareVersions(b, a));
    return { versions: merged, sourceAvailable: true };
  } catch (error) {
    logger.warn({ err: error }, '无法访问 VS Code 版本源，回退到已缓存版本');
    const message = (error as Error).message;
    const hint = networkErrorHint(message);
    return {
      versions: fallback,
      sourceAvailable: false,
      warning: [
        `无法访问官方版本源：${message}。当前展示已缓存的版本。`,
        hint ?? '',
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }
}

adminVscodeRouter.get(
  '/vscode/versions',
  asyncHandler(async (req, res) => {
    const search = (optionalString(req.query.q, 80) ?? '').toLowerCase();
    const { page, pageSize } = parsePagination(req.query as Record<string, unknown>, {
      pageSize: 20,
      maxPageSize: 100,
    });
    const catalog = await loadVersionCatalog();
    const vscodeCache = cachedVSCode();
    const remoteCache = cachedRemote();
    let items = catalog.versions
      .filter((version) => !search || version.toLowerCase().includes(search))
      .map((version) => {
        const local = vscodeCache.get(version);
        const remote = remoteCache.get(version);
        return {
          version,
          cachedPlatforms: local?.platforms ? local.platforms.split(',') : [],
          cachedCount: local?.count ?? 0,
          remotePlatforms: remote?.platforms ? remote.platforms.split(',') : [],
          remoteCount: remote?.count ?? 0,
          commitHash: local?.commit_hash ?? remote?.commit_hash ?? null,
        };
      });
    const total = items.length;
    items = items.slice((page - 1) * pageSize, page * pageSize);
    res.json({
      items,
      total,
      page,
      pageSize,
      sourceAvailable: catalog.sourceAvailable,
      warning: catalog.warning,
      platforms: VSCODE_PLATFORMS,
      defaultPlatforms: DEFAULT_VSCODE_PLATFORMS,
      remotePlatforms: REMOTE_SERVER_PLATFORMS,
      defaultRemotePlatforms: DEFAULT_REMOTE_PLATFORMS,
    });
  }),
);

adminVscodeRouter.post(
  '/vscode/probe',
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        version: z.string().min(3).max(40),
        channel: z.literal('stable').optional(),
      }),
      req.body,
    );
    if (!isValidVSCodeVersion(body.version)) {
      throw badRequest('VS Code 版本号格式不正确');
    }
    const results: Array<Record<string, unknown>> = [];
    for (let index = 0; index < VSCODE_PLATFORMS.length; index += 4) {
      const chunk = VSCODE_PLATFORMS.slice(index, index + 4);
      const probed = await Promise.all(
        chunk.map(async (platform) => {
          try {
            const artifact = await resolveVSCodePackage(body.version, platform.id);
            return {
              id: platform.id,
              label: platform.label,
              available: true,
              sizeBytes: artifact.sizeBytes,
              filename: artifact.filename,
              commitHash: artifact.commitHash,
              buildTime: artifact.buildTime,
            };
          } catch (error) {
            return {
              id: platform.id,
              label: platform.label,
              available: false,
              error: (error as Error).message,
            };
          }
        }),
      );
      results.push(...probed);
    }
    audit(req, {
      action: 'vscode.probe',
      targetType: 'version',
      targetId: body.version,
      detail: { available: results.filter((item) => item.available).length },
    });
    res.json({ version: body.version, platforms: results });
  }),
);

adminVscodeRouter.post(
  '/vscode/cache',
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        versions: z.array(z.string().min(3).max(40)).min(1).max(20),
        platforms: z.array(z.string().min(2).max(40)).min(1).max(20),
        channel: z.literal('stable').default('stable'),
        force: z.boolean().optional(),
      }),
      req.body,
    );
    const versions: string[] = [...new Set(body.versions.map((item) => item.trim()))];
    const platforms: string[] = [...new Set(body.platforms)];
    const channel: string = body.channel ?? 'stable';
    for (const version of versions) {
      if (!isValidVSCodeVersion(version)) throw badRequest(`版本号格式不正确：${version}`);
    }
    for (const platform of platforms) {
      if (!findVSCodePlatform(platform)) throw badRequest(`未知平台：${platform}`);
    }
    if (versions.length * platforms.length > 60) {
      throw badRequest('单次最多创建 60 个缓存任务，请分批操作');
    }

    const created: Array<{ version: string; platform: string; taskId: number }> = [];
    const skipped: Array<{ version: string; platform: string; reason: string; taskId?: number }> = [];
    for (const version of versions) {
      for (const platform of platforms) {
        if (!body.force && hasVSCodeArtifact(version, platform, channel)) {
          skipped.push({ version, platform, reason: 'cached' });
          continue;
        }
        const result = enqueueVSCode(version, platform, channel, req.admin?.id ?? null);
        if (result.created) created.push({ version, platform, taskId: result.taskId });
        else skipped.push({ version, platform, reason: result.status, taskId: result.taskId });
      }
    }
    invalidateVSCodeCaches();
    audit(req, {
      action: 'vscode.cache',
      targetType: 'version',
      targetId: versions.join(','),
      detail: { versions, platforms, created: created.length, skipped: skipped.length },
    });
    res.status(202).json({ created, skipped });
  }),
);

adminVscodeRouter.get(
  '/remote/versions',
  asyncHandler(async (req, res) => {
    const search = (optionalString(req.query.q, 80) ?? '').toLowerCase();
    const { page, pageSize } = parsePagination(req.query as Record<string, unknown>, {
      pageSize: 20,
      maxPageSize: 100,
    });
    const catalog = await loadVersionCatalog();
    const vscodeCache = cachedVSCode();
    const remoteCache = cachedRemote();
    let items = catalog.versions
      .filter((version) => !search || version.toLowerCase().includes(search))
      .map((version) => {
        const local = vscodeCache.get(version);
        const remote = remoteCache.get(version);
        return {
          version,
          cachedPlatforms: remote?.platforms ? remote.platforms.split(',') : [],
          cachedCount: remote?.count ?? 0,
          commitHash: remote?.commit_hash ?? local?.commit_hash ?? null,
        };
      });
    const total = items.length;
    items = items.slice((page - 1) * pageSize, page * pageSize);
    const configuredBase = getSetting<string>('gallery.public_base_url').replace(/\/+$/, '');
    const requestOrigin = `${req.protocol}://${req.get('host') ?? 'localhost'}`;
    res.json({
      items,
      total,
      page,
      pageSize,
      sourceAvailable: catalog.sourceAvailable,
      warning: catalog.warning,
      platforms: REMOTE_SERVER_PLATFORMS,
      defaultPlatforms: DEFAULT_REMOTE_PLATFORMS,
      remoteDownloadBase: getSetting<string>('sources.remote.download_base'),
      remoteUploadMaxBytes: getSetting<number>('upload.remote_max_bytes'),
      vscodeUpdateBase: `${configuredBase || requestOrigin}/api/vscode-update`,
    });
  }),
);

adminVscodeRouter.post(
  '/remote/cache',
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        versions: z.array(z.string().min(3).max(40)).min(1).max(20),
        platforms: z.array(z.string().min(2).max(40)).min(1).max(20),
        channel: z.literal('stable').default('stable'),
        force: z.boolean().optional(),
      }),
      req.body,
    );
    const versions: string[] = [...new Set(body.versions.map((item) => item.trim()))];
    const platforms: string[] = [...new Set(body.platforms)];
    const channel: string = body.channel ?? 'stable';
    for (const version of versions) {
      if (!isValidVSCodeVersion(version)) throw badRequest(`版本号格式不正确：${version}`);
    }
    for (const platform of platforms) {
      if (!findRemotePlatform(platform)) throw badRequest(`未知 server 平台：${platform}`);
    }
    if (versions.length * platforms.length > 60) {
      throw badRequest('单次最多创建 60 个缓存任务，请分批操作');
    }

    const created: Array<{ version: string; platform: string; taskId: number }> = [];
    const skipped: Array<{ version: string; platform: string; reason: string; taskId?: number }> = [];
    for (const version of versions) {
      for (const platform of platforms) {
        if (!body.force && hasRemoteArtifact(version, platform)) {
          skipped.push({ version, platform, reason: 'cached' });
          continue;
        }
        const result = enqueueRemoteServer(version, platform, channel, req.admin?.id ?? null);
        if (result.created) created.push({ version, platform, taskId: result.taskId });
        else skipped.push({ version, platform, reason: result.status, taskId: result.taskId });
      }
    }
    audit(req, {
      action: 'remote.cache',
      targetType: 'version',
      targetId: versions.join(','),
      detail: { versions, platforms, created: created.length, skipped: skipped.length },
    });
    res.status(202).json({ created, skipped });
  }),
);

// 预留：手动解析某个版本的 commit，便于排查
adminVscodeRouter.post(
  '/vscode/commit-lookup',
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({ commit: z.string().trim().min(7).max(40) }),
      req.body,
    );
    const result = await lookupCommitByPrefix(body.commit);
    audit(req, {
      action: 'vscode.lookup_commit',
      targetType: 'commit',
      targetId: result.commit,
      detail: { found: result.found, version: result.matches[0]?.version ?? null },
    });
    res.json(result);
  }),
);

adminVscodeRouter.get(
  '/vscode/:version/commit',
  asyncHandler(async (req, res) => {
    const version = String(req.params.version);
    if (!isValidVSCodeVersion(version)) throw badRequest('版本号格式不正确');
    const artifact = await resolveVSCodePackage(version, 'linux-x64');
    res.json({ version, commitHash: artifact.commitHash, buildTime: artifact.buildTime });
  }),
);

adminVscodeRouter.get(
  '/remote/:version/resolve',
  asyncHandler(async (req, res) => {
    const version = String(req.params.version);
    if (!isValidVSCodeVersion(version)) throw badRequest('版本号格式不正确');
    const artifact = await resolveRemoteServerPackage(version, 'linux-x64');
    res.json({
      version,
      commitHash: artifact.commitHash,
      filename: artifact.filename,
      sizeBytes: artifact.sizeBytes,
    });
  }),
);
