import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  MARKETPLACE_CATEGORIES,
  REMOTE_SERVER_PLATFORMS,
  VSCODE_PLATFORMS,
  findRemotePlatform,
  findVSCodePlatform,
} from '../adapters/platforms';
import { originGuard, requireUserAccess } from '../auth/middleware';
import { softwareSubmitLimiter } from '../auth/rateLimit';
import { config } from '../config';
import { getDb } from '../db';
import { ApiError, asyncHandler, badRequest, forbidden, notFound } from '../http/errors';
import { intParam, optionalString, parseBody, parsePagination } from '../http/validate';
import { normalizeIp } from '../analytics/visitor';
import { getPublicConfig, getSetting } from '../services/settings';
import { getSoftwareById } from '../services/softwareUpload';
import { coerceTagInput, parseTagsColumn } from '../services/softwareMeta';
import { createSubmission } from '../services/softwareSubmissions';
import { iconPublicUrl } from '../services/icons';
import { getStorageUsage } from '../storage/usage';
import { removeIfExists } from '../storage/paths';
import { compareVersions, sortVersionsDesc } from '../utils/semver';

export const publicRouter = Router();

// 版本号跟随 package.json（工作目录向上查找，兼容本地 dev 与容器 /app），避免与发版脱节
const APP_VERSION = (() => {
  let dir = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
        version?: string;
      };
      if (pkg.version) return pkg.version;
    } catch {
      // 继续向上查找
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '0.0.0';
})();

interface VSCodeRow {
  id: number;
  channel: string;
  version: string;
  platform: string;
  filename: string;
  size_bytes: number;
  sha256: string;
  commit_hash: string | null;
  build_time: string | null;
  download_count: number;
}

interface ExtensionRow {
  id: number;
  extension_id: string;
  publisher: string;
  name: string;
  display_name: string | null;
  version: string;
  target_platform: string;
  description: string | null;
  engine_range: string | null;
  categories: string;
  dependencies: string;
  extension_pack: string;
  download_count: number;
  icon_path: string | null;
  size_bytes: number;
  published_at: string | null;
  created_at: string;
}

interface RemoteRow {
  id: number;
  version: string;
  commit_hash: string;
  platform: string;
  filename: string;
  size_bytes: number;
  sha256: string;
  download_count: number;
}

function parseArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

publicRouter.get('/config', (_req, res) => {
  res.json({ ...getPublicConfig(), version: APP_VERSION });
});

publicRouter.get('/platforms', (_req, res) => {
  const categories = getDb()
    .prepare('SELECT DISTINCT category FROM extension_categories ORDER BY category')
    .all() as Array<{ category: string }>;
  res.json({
    vscode: VSCODE_PLATFORMS,
    remote: REMOTE_SERVER_PLATFORMS,
    marketplaceCategories: MARKETPLACE_CATEGORIES,
    extensionCategories: categories.map((row) => row.category),
  });
});

publicRouter.get(
  '/announcements',
  asyncHandler(async (_req, res) => {
    const now = new Date().toISOString();
    const rows = getDb()
      .prepare(
        `SELECT id, title, content, level, pinned, starts_at, ends_at, created_at, updated_at
         FROM announcements
         WHERE published = 1
           AND (starts_at IS NULL OR starts_at <= ?)
           AND (ends_at IS NULL OR ends_at >= ?)
         ORDER BY pinned DESC, created_at DESC
         LIMIT 10`,
      )
      .all(now, now) as Array<{
      id: number;
      title: string;
      content: string;
      level: string;
      pinned: number;
      starts_at: string | null;
      ends_at: string | null;
      created_at: string;
      updated_at: string;
    }>;
    res.json({
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        content: row.content,
        level: row.level,
        pinned: Boolean(row.pinned),
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  }),
);

publicRouter.use(requireUserAccess);

publicRouter.get(
  '/vscode',
  asyncHandler(async (req, res) => {
    const channel = optionalString(req.query.channel, 20) ?? 'stable';
    const search = (optionalString(req.query.q, 80) ?? '').toLowerCase();
    const platformFilter = optionalString(req.query.platform, 40);
    const { page, pageSize } = parsePagination(req.query as Record<string, unknown>, {
      pageSize: 12,
      maxPageSize: 60,
    });
    const rows = getDb()
      .prepare(
        `SELECT id, channel, version, platform, filename, size_bytes, sha256, commit_hash, build_time, download_count
         FROM vscode_packages WHERE channel = ? ORDER BY id DESC`,
      )
      .all(channel) as VSCodeRow[];

    const groups = new Map<string, VSCodeRow[]>();
    for (const row of rows) {
      const list = groups.get(row.version) ?? [];
      list.push(row);
      groups.set(row.version, list);
    }

    let items = [...groups.entries()]
      .filter(([version, list]) => {
        if (search && !version.toLowerCase().includes(search)) return false;
        if (platformFilter && !list.some((row) => row.platform === platformFilter)) return false;
        return true;
      })
      .map(([version, list]) => ({
        version,
        channel: list[0].channel,
        buildTime: list.find((row) => row.build_time)?.build_time ?? null,
        commitHash: list.find((row) => row.commit_hash)?.commit_hash ?? null,
        totalSize: list.reduce((sum, row) => sum + row.size_bytes, 0),
        downloadCount: list.reduce((sum, row) => sum + row.download_count, 0),
        platforms: list
          .sort((a, b) => a.platform.localeCompare(b.platform))
          .map((row) => ({
            id: row.platform,
            label: findVSCodePlatform(row.platform)?.label ?? row.platform,
            artifactId: row.id,
            filename: row.filename,
            sizeBytes: row.size_bytes,
            sha256: row.sha256,
            downloadCount: row.download_count,
          })),
      }))
      .sort((a, b) => compareVersions(b.version, a.version));

    const total = items.length;
    items = items.slice((page - 1) * pageSize, page * pageSize);

    res.json({ items, total, page, pageSize, channel });
  }),
);

publicRouter.get(
  '/vscode/:version',
  asyncHandler(async (req, res) => {
    const version = String(req.params.version);
    const rows = getDb()
      .prepare(
        `SELECT id, channel, version, platform, filename, size_bytes, sha256, commit_hash, build_time, download_count
         FROM vscode_packages WHERE version = ? ORDER BY platform ASC`,
      )
      .all(version) as VSCodeRow[];
    if (rows.length === 0) throw notFound('该版本尚未缓存');
    res.json({
      version,
      channel: rows[0].channel,
      buildTime: rows.find((row) => row.build_time)?.build_time ?? null,
      commitHash: rows.find((row) => row.commit_hash)?.commit_hash ?? null,
      totalSize: rows.reduce((sum, row) => sum + row.size_bytes, 0),
      downloadCount: rows.reduce((sum, row) => sum + row.download_count, 0),
      platforms: rows.map((row) => ({
        id: row.platform,
        label: findVSCodePlatform(row.platform)?.label ?? row.platform,
        artifactId: row.id,
        filename: row.filename,
        sizeBytes: row.size_bytes,
        sha256: row.sha256,
        downloadCount: row.download_count,
      })),
    });
  }),
);

publicRouter.get(
  '/extensions',
  asyncHandler(async (req, res) => {
    const search = optionalString(req.query.q, 120) ?? '';
    const category = optionalString(req.query.category, 80);
    const sort = optionalString(req.query.sort, 20) ?? 'downloads';
    const { page, pageSize } = parsePagination(req.query as Record<string, unknown>, {
      pageSize: 12,
      maxPageSize: 60,
    });
    const like = `%${search.toLowerCase()}%`;

    let rows: ExtensionRow[];
    if (search && category) {
      rows = getDb()
        .prepare(
          `SELECT id, extension_id, publisher, name, display_name, version, target_platform,
                  description, engine_range, categories, dependencies, extension_pack, download_count, icon_path, size_bytes,
                  published_at, created_at
           FROM extensions
           WHERE (lower(extension_id) LIKE ? OR lower(display_name) LIKE ? OR lower(description) LIKE ?)
             AND EXISTS (SELECT 1 FROM extension_categories ec
                         WHERE ec.extension_pk = extensions.id AND ec.category = ?)
           ORDER BY id DESC`,
        )
        .all(like, like, like, category) as ExtensionRow[];
    } else if (search) {
      rows = getDb()
        .prepare(
          `SELECT id, extension_id, publisher, name, display_name, version, target_platform,
                  description, engine_range, categories, dependencies, extension_pack, download_count, icon_path, size_bytes,
                  published_at, created_at
           FROM extensions
           WHERE (lower(extension_id) LIKE ? OR lower(display_name) LIKE ? OR lower(description) LIKE ?)
           ORDER BY id DESC`,
        )
        .all(like, like, like) as ExtensionRow[];
    } else if (category) {
      rows = getDb()
        .prepare(
          `SELECT id, extension_id, publisher, name, display_name, version, target_platform,
                  description, engine_range, categories, dependencies, extension_pack, download_count, icon_path, size_bytes,
                  published_at, created_at
           FROM extensions
           WHERE EXISTS (SELECT 1 FROM extension_categories ec
                         WHERE ec.extension_pk = extensions.id AND ec.category = ?)
           ORDER BY id DESC`,
        )
        .all(category) as ExtensionRow[];
    } else {
      rows = getDb()
        .prepare(
          `SELECT id, extension_id, publisher, name, display_name, version, target_platform,
                  description, engine_range, categories, dependencies, extension_pack, download_count, icon_path, size_bytes,
                  published_at, created_at
           FROM extensions ORDER BY id DESC`,
        )
        .all() as ExtensionRow[];
    }

    const groups = new Map<string, ExtensionRow[]>();
    for (const row of rows) {
      const list = groups.get(row.extension_id) ?? [];
      list.push(row);
      groups.set(row.extension_id, list);
    }

    let items = [...groups.values()].map((list) => {
      const versions = sortVersionsDesc(list.map((row) => row.version));
      const latestVersion = versions[0];
      const latestRows = list.filter((row) => row.version === latestVersion);
      const primary =
        latestRows.find((row) => !row.target_platform) ??
        latestRows.find((row) => row.target_platform === 'linux-x64') ??
        latestRows[0];
      const withIcon =
        latestRows.find((row) => row.icon_path) ?? list.find((row) => row.icon_path);
      const categories = parseArray(primary.categories);
      return {
        id: primary.extension_id,
        publisher: primary.publisher,
        name: primary.name,
        displayName: primary.display_name || primary.name,
        description: primary.description ?? '',
        version: latestVersion,
        engineRange: primary.engine_range,
        categories: categories.length ? categories : ['Other'],
        dependencies: parseArray(primary.dependencies),
        extensionPack: parseArray(primary.extension_pack),
        downloadCount: list.reduce((sum, row) => sum + row.download_count, 0),
        updatedAt: list.map((row) => row.published_at || row.created_at).sort().pop(),
        versionsCount: versions.length,
        platforms: [...new Set(latestRows.map((row) => row.target_platform || 'universal'))],
        artifactId: primary.id,
        sizeBytes: primary.size_bytes,
        iconUrl: withIcon?.icon_path ? `/icons/${path.basename(withIcon.icon_path)}` : null,
        targetPlatform: primary.target_platform || 'universal',
      };
    });

    if (sort === 'name') {
      items.sort((a, b) => a.displayName.localeCompare(b.displayName));
    } else if (sort === 'updated') {
      items.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
    } else {
      items.sort((a, b) => b.downloadCount - a.downloadCount);
    }

    const total = items.length;
    items = items.slice((page - 1) * pageSize, page * pageSize);
    const categories = getDb()
      .prepare('SELECT DISTINCT category FROM extension_categories ORDER BY category')
      .all() as Array<{ category: string }>;

    res.json({
      items,
      total,
      page,
      pageSize,
      categories: categories.map((row) => row.category),
    });
  }),
);

publicRouter.get(
  '/extensions/:extensionId/versions',
  asyncHandler(async (req, res) => {
    const extensionId = String(req.params.extensionId).toLowerCase();
    const rows = getDb()
      .prepare(
        `SELECT id, version, target_platform, engine_range, size_bytes, sha256, filename,
                download_count, published_at, created_at
         FROM extensions WHERE extension_id = ?`,
      )
      .all(extensionId) as Array<{
      id: number;
      version: string;
      target_platform: string;
      engine_range: string | null;
      size_bytes: number;
      sha256: string;
      filename: string;
      download_count: number;
      published_at: string | null;
      created_at: string;
    }>;
    if (rows.length === 0) throw notFound('插件尚未缓存');
    rows.sort(
      (a, b) =>
        compareVersions(b.version, a.version) ||
        a.target_platform.localeCompare(b.target_platform),
    );
    res.json({
      extensionId,
      versions: rows.map((row) => ({
        artifactId: row.id,
        version: row.version,
        targetPlatform: row.target_platform || 'universal',
        engineRange: row.engine_range,
        sizeBytes: row.size_bytes,
        sha256: row.sha256,
        filename: row.filename,
        downloadCount: row.download_count,
        publishedAt: row.published_at ?? row.created_at,
      })),
    });
  }),
);

publicRouter.get(
  '/remote-servers',
  asyncHandler(async (req, res) => {
    const search = (optionalString(req.query.q, 80) ?? '').toLowerCase();
    const platformFilter = optionalString(req.query.platform, 40);
    const { page, pageSize } = parsePagination(req.query as Record<string, unknown>, {
      pageSize: 12,
      maxPageSize: 60,
    });
    const rows = getDb()
      .prepare(
        `SELECT id, version, commit_hash, platform, filename, size_bytes, sha256, download_count
         FROM remote_servers ORDER BY id DESC`,
      )
      .all() as RemoteRow[];
    const groups = new Map<string, RemoteRow[]>();
    for (const row of rows) {
      const list = groups.get(row.version) ?? [];
      list.push(row);
      groups.set(row.version, list);
    }
    let items = [...groups.entries()]
      .filter(([version, list]) => {
        if (search && !version.toLowerCase().includes(search)) return false;
        if (platformFilter && !list.some((row) => row.platform === platformFilter)) return false;
        return true;
      })
      .map(([version, list]) => ({
        version,
        commitHash: list[0].commit_hash,
        totalSize: list.reduce((sum, row) => sum + row.size_bytes, 0),
        downloadCount: list.reduce((sum, row) => sum + row.download_count, 0),
        platforms: list
          .sort((a, b) => a.platform.localeCompare(b.platform))
          .map((row) => ({
            id: row.platform,
            label: findRemotePlatform(row.platform)?.label ?? row.platform,
            artifactId: row.id,
            filename: row.filename,
            sizeBytes: row.size_bytes,
            sha256: row.sha256,
            downloadCount: row.download_count,
            commitHash: row.commit_hash,
          })),
      }))
      .sort((a, b) => compareVersions(b.version, a.version));
    const total = items.length;
    items = items.slice((page - 1) * pageSize, page * pageSize);
    res.json({ items, total, page, pageSize });
  }),
);

publicRouter.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const vscodeVersions = (
      db.prepare('SELECT COUNT(DISTINCT version) AS count FROM vscode_packages').get() as {
        count: number;
      }
    ).count;
    const vscodePackages = (
      db.prepare('SELECT COUNT(*) AS count FROM vscode_packages').get() as { count: number }
    ).count;
    const extensionCount = (
      db.prepare('SELECT COUNT(DISTINCT extension_id) AS count FROM extensions').get() as {
        count: number;
      }
    ).count;
    const extensionVersions = (
      db.prepare('SELECT COUNT(*) AS count FROM extensions').get() as { count: number }
    ).count;
    const remoteVersions = (
      db.prepare('SELECT COUNT(DISTINCT version) AS count FROM remote_servers').get() as {
        count: number;
      }
    ).count;
    const remotePackages = (
      db.prepare('SELECT COUNT(*) AS count FROM remote_servers').get() as { count: number }
    ).count;
    const totals = db
      .prepare(
        `SELECT
          (SELECT COALESCE(SUM(size_bytes),0) FROM vscode_packages) +
          (SELECT COALESCE(SUM(size_bytes),0) FROM extensions) +
          (SELECT COALESCE(SUM(size_bytes),0) FROM remote_servers) AS bytes,
          (SELECT COALESCE(SUM(download_count),0) FROM vscode_packages) +
          (SELECT COALESCE(SUM(download_count),0) FROM extensions) +
          (SELECT COALESCE(SUM(download_count),0) FROM remote_servers) AS downloads`,
      )
      .get() as { bytes: number; downloads: number };
    const usage = await getStorageUsage();
    const latest = db
      .prepare(
        `SELECT extension_id AS id, display_name AS name, version, created_at FROM extensions
         ORDER BY created_at DESC LIMIT 5`,
      )
      .all() as Array<{ id: string; name: string | null; version: string; created_at: string }>;
    const now = new Date().toISOString();
    const softwareCount = (
      getDb().prepare('SELECT COUNT(*) AS count FROM software_packages').get() as { count: number }
    ).count;
    const publicFileCount = (
      getDb()
        .prepare('SELECT COUNT(*) AS count FROM public_files WHERE expires_at > ?')
        .get(now) as { count: number }
    ).count;
    res.json({
      vscodeVersions,
      vscodePackages,
      extensionCount,
      extensionVersions,
      remoteVersions,
      remotePackages,
      softwareCount,
      publicFileCount,
      totalBytes: totals.bytes,
      downloads: totals.downloads,
      disk: usage.disk,
      latestExtensions: latest,
      generatedAt: new Date().toISOString(),
    });
  }),
);

interface SoftwarePublicRow {
  id: number;
  name: string;
  version: string;
  platform: string;
  category: string;
  tags: string;
  filename: string;
  icon_path: string | null;
  size_bytes: number;
  sha256: string;
  download_count: number;
  source: string;
  updated_at: string;
}

/** LIKE 通配符转义（配合 ESCAPE '\' 使用）。 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

const SOFTWARE_SORTS = {
  updated: 'updated_at DESC, id DESC',
  downloads: 'download_count DESC, id DESC',
  size: 'size_bytes DESC, id DESC',
  name: 'name COLLATE NOCASE ASC, id ASC',
} as const;

publicRouter.get(
  '/software/categories',
  asyncHandler(async (_req, res) => {
    const rows = getDb()
      .prepare(
        `SELECT category, COUNT(*) AS count FROM software_packages
         GROUP BY category ORDER BY category`,
      )
      .all() as Array<{ category: string; count: number }>;
    res.json({ items: rows });
  }),
);

publicRouter.get(
  '/software/tags',
  asyncHandler(async (_req, res) => {
    const rows = getDb()
      .prepare(
        `SELECT jt.value AS tag, COUNT(*) AS count
         FROM software_packages, json_each(software_packages.tags) AS jt
         GROUP BY jt.value ORDER BY count DESC, tag ASC LIMIT 30`,
      )
      .all() as Array<{ tag: string; count: number }>;
    res.json({ items: rows });
  }),
);

publicRouter.get(
  '/software',
  asyncHandler(async (req, res) => {
    const search = (optionalString(req.query.q, 120) ?? '').toLowerCase();
    const category = optionalString(req.query.category, 80);
    const tag = optionalString(req.query.tag, 24);
    const sortKey = optionalString(req.query.sort, 20);
    const sort = sortKey && sortKey in SOFTWARE_SORTS ? sortKey : 'updated';
    const { page, pageSize, offset } = parsePagination(req.query as Record<string, unknown>, {
      pageSize: 20,
      maxPageSize: 60,
    });
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (search) {
      conditions.push(
        '(lower(name) LIKE ? OR lower(version) LIKE ? OR lower(platform) LIKE ? OR lower(category) LIKE ? OR lower(tags) LIKE ? OR lower(description_md) LIKE ?)',
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
        `SELECT id, name, version, platform, category, tags, filename, icon_path, size_bytes, sha256,
                download_count, source, updated_at
         FROM software_packages ${where}
         ORDER BY ${SOFTWARE_SORTS[sort as keyof typeof SOFTWARE_SORTS]}
         LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, offset) as SoftwarePublicRow[];
    res.json({
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        version: row.version,
        platform: row.platform,
        category: row.category,
        tags: parseTagsColumn(row.tags),
        filename: row.filename,
        iconUrl: iconPublicUrl(row.icon_path),
        sizeBytes: row.size_bytes,
        sha256: row.sha256,
        downloadCount: row.download_count,
        source: row.source,
        updatedAt: row.updated_at,
      })),
      total,
      page,
      pageSize,
    });
  }),
);

publicRouter.get(
  '/software/:id',
  asyncHandler(async (req, res) => {
    const id = intParam(req.params.id, {
      fallback: 0,
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
      name: 'id',
    });
    const row = getSoftwareById(id);
    if (!row) throw notFound('软件包不存在');
    res.json({
      id: row.id,
      name: row.name,
      version: row.version,
      platform: row.platform,
      category: row.category,
      tags: parseTagsColumn(row.tags),
      descriptionMd: row.description_md,
      filename: row.filename,
      iconUrl: iconPublicUrl(row.icon_path),
      sizeBytes: row.size_bytes,
      sha256: row.sha256,
      downloadCount: row.download_count,
      source: row.source,
      verifiedAt: row.verified_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }),
);

function submissionUploadMiddleware(
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
): void {
  const configured =
    Number(getSetting<number>('upload.software_max_bytes')) || 2 * 1024 * 1024 * 1024;
  const maxBytes = Math.min(Math.max(configured, 1024 * 1024), 4 * 1024 * 1024 * 1024);
  const handler = multer({
    dest: path.join(config.storageDir, 'tmp', 'uploads'),
    limits: { fileSize: maxBytes, files: 1, fields: 8 },
  }).single('file');
  handler(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof multer.MulterError) {
      const message =
        error.code === 'LIMIT_FILE_SIZE' ? '文件超过大小限制' : `上传失败：${error.message}`;
      next(new ApiError(400, 'UPLOAD_ERROR', message));
      return;
    }
    next(error);
  });
}

/** 用户投稿软件包：文件暂存待审，管理员同意后自动并入正式软件包。 */
publicRouter.post(
  '/software/submit',
  submissionUploadMiddleware,
  softwareSubmitLimiter,
  originGuard,
  asyncHandler(async (req, res) => {
    if (!getSetting<boolean>('software.submissions_enabled')) {
      throw forbidden('软件投稿已关闭');
    }
    const file = req.file;
    if (!file) throw badRequest('请选择要投稿的安装包文件');
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
          note: z.string().trim().max(500).optional(),
        }),
        req.body,
      );
      const ip = normalizeIp(req.ip);
      const result = await createSubmission({
        tempPath,
        originalName: file.originalname,
        name: fields.name,
        version: fields.version,
        platform: fields.platform,
        category: fields.category,
        tags: coerceTagInput(fields.tags),
        descriptionMd: fields.description_md,
        note: fields.note,
        uploaderIp: ip,
        visitorId: req.visitorId ?? '',
      });
      res.status(201).json(result);
    } finally {
      await removeIfExists(tempPath);
    }
  }),
);
