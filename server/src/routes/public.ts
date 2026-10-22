import path from 'node:path';
import { Router } from 'express';
import {
  MARKETPLACE_CATEGORIES,
  REMOTE_SERVER_PLATFORMS,
  VSCODE_PLATFORMS,
  findRemotePlatform,
  findVSCodePlatform,
} from '../adapters/platforms';
import { requireUserAccess } from '../auth/middleware';
import { getDb } from '../db';
import { asyncHandler, notFound } from '../http/errors';
import { optionalString, parsePagination } from '../http/validate';
import { getPublicConfig } from '../services/settings';
import { getStorageUsage } from '../storage/usage';
import { compareVersions, sortVersionsDesc } from '../utils/semver';

export const publicRouter = Router();

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
  res.json({ ...getPublicConfig(), version: '1.0.0' });
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
    res.json({
      vscodeVersions,
      vscodePackages,
      extensionCount,
      extensionVersions,
      remoteVersions,
      remotePackages,
      totalBytes: totals.bytes,
      downloads: totals.downloads,
      disk: usage.disk,
      latestExtensions: latest,
      generatedAt: new Date().toISOString(),
    });
  }),
);
