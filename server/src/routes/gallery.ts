import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Request } from 'express';
import { Router } from 'express';
import { config } from '../config';
import { getDb } from '../db';
import { ApiError, asyncHandler, notFound } from '../http/errors';
import { getSetting } from '../services/settings';
import { contentDisposition, resolveWithin } from '../storage/paths';
import { compareVersions } from '../utils/semver';

export const galleryRouter = Router();

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
  keywords: string;
  dependencies: string;
  extension_pack: string;
  icon_path: string | null;
  license: string | null;
  repository_url: string | null;
  homepage: string | null;
  download_count: number;
  sha256: string;
  filename: string;
  stored_path: string;
  published_at: string | null;
  created_at: string;
}

interface GalleryCriterion {
  filterType?: number;
  value?: string;
}

interface GalleryFilter {
  criteria?: GalleryCriterion[];
  pageNumber?: number;
  pageSize?: number;
  sortBy?: number;
}

interface GalleryBody {
  filters?: GalleryFilter[];
}

const EXTENSION_COLUMNS = `id, extension_id, publisher, name, display_name, version,
  target_platform, description, engine_range, categories, keywords, dependencies,
  extension_pack, icon_path, license, repository_url, homepage, download_count,
  sha256, filename, stored_path, published_at, created_at`;

function parseArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function baseUrl(req: Request): string {
  const configured = (getSetting<string>('gallery.public_base_url') || '').trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      return configured.replace(/\/+$/, '');
    }
  }
  const forwarded = (req.get('x-forwarded-proto') ?? '').split(',')[0].trim();
  const protocol = forwarded || req.protocol;
  return `${protocol}://${req.get('host')}`;
}

function uuidFrom(seed: string): string {
  const hex = crypto.createHash('sha256').update(seed).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function latestTimestamp(rows: ExtensionRow[]): string {
  return rows
    .map((row) => row.published_at || row.created_at)
    .sort()
    .pop() as string;
}

function totalDownloads(rows: ExtensionRow[]): number {
  return rows.reduce((sum, row) => sum + row.download_count, 0);
}

function versionEntry(base: string, row: ExtensionRow): Record<string, unknown> {
  const publisher = encodeURIComponent(row.publisher);
  const name = encodeURIComponent(row.name);
  const version = encodeURIComponent(row.version);
  const assetBase = `${base}/api/gallery/asset/${publisher}/${name}/${version}`;
  const categories = parseArray(row.categories);
  const keywords = parseArray(row.keywords);
  const dependencies = parseArray(row.dependencies);
  const extensionPack = parseArray(row.extension_pack);
  const files: Array<{ assetType: string; source: string }> = [
    {
      assetType: 'Microsoft.VisualStudio.Code.Manifest',
      source: `${assetBase}/package.json`,
    },
  ];
  if (row.icon_path) {
    files.push({
      assetType: 'Microsoft.VisualStudio.Services.Icons.Default',
      source: `${base}/icons/${path.basename(row.icon_path)}`,
    });
  }
  const vsixSource = `${base}/api/gallery/publishers/${publisher}/vsextensions/${name}/${version}/vspackage${
    row.target_platform ? `?targetPlatform=${encodeURIComponent(row.target_platform)}` : ''
  }`;
  files.push({
    assetType: 'Microsoft.VisualStudio.Services.VSIXPackage',
    source: vsixSource,
  });

  return {
    version: row.version,
    lastUpdated: row.published_at || row.created_at,
    targetPlatform: row.target_platform || undefined,
    assetUri: assetBase,
    fallbackAssetUri: assetBase,
    properties: [
      {
        key: 'Microsoft.VisualStudio.Code.Engine',
        value: row.engine_range || '*',
      },
      {
        key: 'Microsoft.VisualStudio.Code.ExtensionDependencies',
        value: dependencies.join(','),
      },
      {
        key: 'Microsoft.VisualStudio.Code.ExtensionPack',
        value: extensionPack.join(','),
      },
      {
        key: 'Microsoft.VisualStudio.Services.VsixSha256',
        value: row.sha256,
      },
    ],
    files,
    categories,
    keywords,
  };
}

function extensionEntry(base: string, rows: ExtensionRow[]): Record<string, unknown> {
  const sorted = [...rows].sort(
    (a, b) =>
      compareVersions(b.version, a.version) ||
      Number(Boolean(a.target_platform)) - Number(Boolean(b.target_platform)),
  );
  const primary = sorted[0];
  const categories = parseArray(primary.categories);
  const keywords = parseArray(primary.keywords);
  const latest = latestTimestamp(sorted);
  return {
    extensionId: uuidFrom(primary.extension_id),
    extensionName: primary.name,
    displayName: primary.display_name || primary.name,
    shortDescription: primary.description ?? '',
    publisher: {
      publisherName: primary.publisher,
      displayName: primary.publisher,
      publisherId: uuidFrom(primary.publisher),
      domain: null,
      isDomainVerified: false,
    },
    versions: sorted.slice(0, 30).map((row) => versionEntry(base, row)),
    statistics: [{ statisticName: 'install', value: totalDownloads(sorted) }],
    tags: [...new Set([...categories, ...keywords])].slice(0, 20),
    releaseDate: latest,
    publishedDate: latest,
    lastUpdated: latest,
    categories,
    flags: '',
  };
}

function matchesId(row: ExtensionRow, ids: string[]): boolean {
  if (ids.length === 0) return true;
  const extensionId = row.extension_id.toLowerCase();
  const uuid = uuidFrom(extensionId);
  return ids.some((id) => id === extensionId || id === uuid);
}

function filterRows(
  rows: ExtensionRow[],
  criteria: { ids: string[]; search: string; category?: string },
): ExtensionRow[] {
  const search = criteria.search.toLowerCase();
  return rows.filter((row) => {
    if (!matchesId(row, criteria.ids)) return false;
    if (search) {
      const haystack = `${row.extension_id} ${row.display_name ?? ''} ${row.description ?? ''}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    if (criteria.category && !parseArray(row.categories).includes(criteria.category)) {
      return false;
    }
    return true;
  });
}

galleryRouter.post(
  '/extensionquery',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as GalleryBody;
    const filter = body.filters?.[0] ?? {};
    const criteria = Array.isArray(filter.criteria) ? filter.criteria : [];
    const ids = criteria
      .filter((item) => item.filterType === 4 || item.filterType === 7)
      .map((item) => String(item.value ?? '').trim().toLowerCase())
      .filter(Boolean);
    const search = String(
      criteria.find((item) => item.filterType === 10)?.value ?? '',
    ).trim();
    const category = criteria.find((item) => item.filterType === 5)?.value;
    const page = Math.min(10000, Math.max(1, Number(filter.pageNumber) || 1));
    const pageSize = Math.min(100, Math.max(1, Number(filter.pageSize) || 50));

    const rows = getDb()
      .prepare(`SELECT ${EXTENSION_COLUMNS} FROM extensions ORDER BY id DESC`)
      .all() as ExtensionRow[];
    const filtered = filterRows(rows, {
      ids,
      search,
      category: category ? String(category) : undefined,
    });

    const groups = new Map<string, ExtensionRow[]>();
    for (const row of filtered) {
      const list = groups.get(row.extension_id) ?? [];
      list.push(row);
      groups.set(row.extension_id, list);
    }

    const groupList = [...groups.values()];
    const sortBy = Number(filter.sortBy ?? 4);
    if (sortBy === 1) {
      groupList.sort((a, b) => latestTimestamp(b).localeCompare(latestTimestamp(a)));
    } else {
      groupList.sort((a, b) => totalDownloads(b) - totalDownloads(a));
    }

    const total = groupList.length;
    const paged = groupList.slice((page - 1) * pageSize, page * pageSize);
    const base = baseUrl(req);

    const categories = [...new Set(filtered.flatMap((row) => parseArray(row.categories)))]
      .sort()
      .map((name) => ({ name, count: 1 }));
    const platforms = [...new Set(filtered.map((row) => row.target_platform).filter(Boolean))]
      .map((name) => ({ name, count: 1 }));

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      results: [
        {
          extensions: paged.map((group) => extensionEntry(base, group)),
          resultMetadata: [
            {
              metadataType: 'ResultCount',
              metadataItems: [{ name: 'TotalCount', count: total }],
            },
            { metadataType: 'Categories', metadataItems: categories },
            { metadataType: 'TargetPlatforms', metadataItems: platforms },
          ],
        },
      ],
    });
  }),
);

galleryRouter.get('/publishers/:publisher', (req, res) => {
  const publisher = String(req.params.publisher);
  res.json({
    publisherName: publisher,
    displayName: publisher,
    publisherId: uuidFrom(publisher),
    domain: null,
    isDomainVerified: false,
  });
});

function findVersionRows(publisher: string, name: string, version: string): ExtensionRow[] {
  return getDb()
    .prepare(
      `SELECT ${EXTENSION_COLUMNS} FROM extensions
       WHERE publisher = ? AND name = ? AND version = ?`,
    )
    .all(publisher.toLowerCase(), name.toLowerCase(), version) as ExtensionRow[];
}

galleryRouter.get(
  '/publishers/:publisher/vsextensions/:name/:version/vspackage',
  asyncHandler(async (req, res, next) => {
    const publisher = String(req.params.publisher);
    const name = String(req.params.name);
    const version = String(req.params.version);
    const targetPlatform =
      typeof req.query.targetPlatform === 'string' ? req.query.targetPlatform : '';
    const rows = findVersionRows(publisher, name, version);
    if (rows.length === 0) throw notFound('插件版本不存在');
    const row =
      rows.find((item) => item.target_platform === targetPlatform) ??
      rows.find((item) => !item.target_platform) ??
      rows[0];
    const storedPath = row.stored_path;
    if (!storedPath || storedPath.startsWith('/') || storedPath.split('/').includes('..')) {
      throw new ApiError(400, 'INVALID_PATH', '非法的存储路径');
    }
    const absolute = resolveWithin(storedPath);
    if (!fs.existsSync(absolute)) throw notFound('插件文件已丢失');
    res.sendFile(
      storedPath,
      {
        root: config.storageDir,
        dotfiles: 'deny',
        headers: {
          'Content-Type': 'application/vsix',
          'Content-Disposition': contentDisposition(row.filename),
          'Cache-Control': 'public, max-age=3600',
        },
      },
      (error) => {
        if (error && !res.headersSent) next(error);
      },
    );
  }),
);

galleryRouter.get('/asset/:publisher/:name/:version/package.json', (req, res) => {
  const rows = findVersionRows(
    String(req.params.publisher),
    String(req.params.name),
    String(req.params.version),
  );
  if (rows.length === 0) throw notFound('插件版本不存在');
  const row = rows[0];
  res.json({
    name: row.name,
    publisher: row.publisher,
    version: row.version,
    displayName: row.display_name || row.name,
    description: row.description ?? '',
    engines: { vscode: row.engine_range || '*' },
    categories: parseArray(row.categories),
    keywords: parseArray(row.keywords),
    extensionDependencies: parseArray(row.dependencies),
    extensionPack: parseArray(row.extension_pack),
    license: row.license ?? undefined,
    repository: row.repository_url ? { type: 'git', url: row.repository_url } : undefined,
    homepage: row.homepage ?? undefined,
    icon: 'icon',
  });
});

galleryRouter.get('/asset/:publisher/:name/:version/icon', (req, res) => {
  const rows = findVersionRows(
    String(req.params.publisher),
    String(req.params.name),
    String(req.params.version),
  );
  const row = rows.find((item) => item.icon_path);
  if (!row?.icon_path) throw notFound('没有图标');
  const base = baseUrl(req);
  res.redirect(302, `${base}/icons/${path.basename(row.icon_path)}`);
});

galleryRouter.get('/asset/:publisher/:name/:version/*assetPath', (req, res) => {
  const raw = (req.params as unknown as { assetPath?: string | string[] }).assetPath;
  const assetPath = Array.isArray(raw) ? raw.join('/') : String(raw ?? '');
  if (assetPath === 'package.json') {
    res.redirect(
      302,
      `${baseUrl(req)}/api/gallery/asset/${encodeURIComponent(String(req.params.publisher))}/${encodeURIComponent(String(req.params.name))}/${encodeURIComponent(String(req.params.version))}/package.json`,
    );
    return;
  }
  if (assetPath.startsWith('icon')) {
    res.redirect(
      302,
      `${baseUrl(req)}/api/gallery/asset/${encodeURIComponent(String(req.params.publisher))}/${encodeURIComponent(String(req.params.name))}/${encodeURIComponent(String(req.params.version))}/icon`,
    );
    return;
  }
  throw notFound('未缓存的资源文件');
});

galleryRouter.get('/item', (req, res) => {
  const itemName = typeof req.query.itemName === 'string' ? req.query.itemName : '';
  res.redirect(
    302,
    `${baseUrl(req)}/extensions${itemName ? `?q=${encodeURIComponent(itemName)}` : ''}`,
  );
});
