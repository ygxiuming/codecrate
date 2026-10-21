import { config } from '../config';
import { ApiError } from '../http/errors';
import { safeFetchJson, SOURCE_HEADERS } from '../net/safeFetch';
import { getSetting } from '../services/settings';
import { compareVersions, isExtensionVersion, sortVersionsDesc } from '../utils/semver';
import type {
  MarketplaceAdapter,
  MarketplaceDetail,
  MarketplacePage,
  MarketplaceSearchParams,
  MarketplaceSummary,
  MarketplaceVersion,
  ResolvedMarketplacePackage,
} from './types';

interface GalleryProperty {
  key: string;
  value: string;
}

interface GalleryFile {
  assetType?: string;
  source?: string;
}

interface GalleryVersion {
  version: string;
  targetPlatform?: string;
  lastUpdated?: string;
  properties?: GalleryProperty[];
  files?: GalleryFile[];
}

interface GalleryStatistic {
  statisticName: string;
  value: number;
}

interface GalleryExtension {
  publisher?: { publisherName?: string; displayName?: string };
  extensionName?: string;
  displayName?: string;
  shortDescription?: string;
  lastUpdated?: string;
  versions?: GalleryVersion[];
  statistics?: GalleryStatistic[];
}

interface GalleryResult {
  extensions?: GalleryExtension[];
  resultMetadata?: Array<{
    metadataType?: string;
    metadataItems?: Array<{ name?: string; count?: number }>;
  }>;
}

interface GalleryResponse {
  results?: GalleryResult[];
}

interface ManifestInfo {
  categories?: string[];
  keywords?: string[];
  license?: string;
  repository?: { url?: string } | string;
  homepage?: string;
}

const SORT_BY: Record<MarketplaceSearchParams['sort'], number> = {
  relevance: 0,
  updated: 1,
  downloads: 4,
};

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DETAIL_CACHE_TTL_MS = 5 * 60 * 1000;
const detailCache = new Map<string, { detail: MarketplaceDetail; fetchedAt: number }>();

function endpoint(): string {
  return getSetting<string>('marketplace.official.endpoint').replace(/\/+$/, '');
}

function propertiesMap(version?: GalleryVersion): Record<string, string> {
  const map: Record<string, string> = {};
  for (const property of version?.properties ?? []) {
    if (property?.key) map[property.key] = String(property.value ?? '');
  }
  return map;
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => ID_PATTERN.test(item) || /^[A-Za-z0-9._-]+$/.test(item))
    .slice(0, 100);
}

function statistic(ext: GalleryExtension, name: string): number {
  const found = ext.statistics?.find((item) => item.statisticName === name);
  return found && Number.isFinite(found.value) ? Math.round(found.value) : 0;
}

function buildDownloadUrl(
  publisher: string,
  name: string,
  version: string,
  targetPlatform?: string,
): string {
  const base = `${endpoint()}/_apis/public/gallery/publishers/${encodeURIComponent(publisher)}/vsextensions/${encodeURIComponent(name)}/${encodeURIComponent(version)}/vspackage`;
  return targetPlatform ? `${base}?targetPlatform=${encodeURIComponent(targetPlatform)}` : base;
}

async function galleryQuery(body: unknown): Promise<GalleryResponse> {
  const url = `${endpoint()}/_apis/public/gallery/extensionquery`;
  const { data } = await safeFetchJson<GalleryResponse>(
    url,
    {
      method: 'POST',
      headers: {
        ...SOURCE_HEADERS,
        accept: 'application/json;api-version=7.2-preview.1',
        'content-type': 'application/json',
        'x-marketplace-client': 'VSCode',
        'user-agent': config.userAgent,
      },
      body: JSON.stringify(body),
    },
    { timeoutMs: 30000, maxBytes: 32 * 1024 * 1024 },
  );
  return data;
}

function parseSummary(ext: GalleryExtension): MarketplaceSummary {
  const publisher = ext.publisher?.publisherName ?? '';
  const name = ext.extensionName ?? '';
  const versions = ext.versions ?? [];
  const latestVersion = sortVersionsDesc(versions.map((item) => item.version))[0] ?? '';
  const candidates = versions.filter((item) => item.version === latestVersion);
  const primary = candidates.find((item) => !item.targetPlatform) ?? candidates[0];
  const props = propertiesMap(primary);
  return {
    id: `${publisher}.${name}`,
    publisher,
    name,
    displayName: ext.displayName || name,
    description: ext.shortDescription ?? '',
    version: latestVersion,
    engineRange: props['Microsoft.VisualStudio.Code.Engine'],
    downloadCount: statistic(ext, 'install') || statistic(ext, 'downloadCount'),
    updatedAt: primary?.lastUpdated ?? ext.lastUpdated,
    categories: [],
    targetPlatforms: [...new Set(candidates.map((item) => item.targetPlatform ?? ''))],
    source: 'official',
  };
}

function parseVersions(ext: GalleryExtension): MarketplaceVersion[] {
  const publisher = ext.publisher?.publisherName ?? '';
  const name = ext.extensionName ?? '';
  const mapped = (ext.versions ?? []).map((version) => {
    const props = propertiesMap(version);
    return {
      version: version.version,
      targetPlatform: version.targetPlatform ?? '',
      engineRange: props['Microsoft.VisualStudio.Code.Engine'],
      updatedAt: version.lastUpdated,
      dependencies: splitList(props['Microsoft.VisualStudio.Code.ExtensionDependencies']),
      extensionPack: splitList(props['Microsoft.VisualStudio.Code.ExtensionPack']),
      sha256: props['Microsoft.VisualStudio.Services.VsixSha256'] || undefined,
      downloadUrl: buildDownloadUrl(
        publisher,
        name,
        version.version,
        version.targetPlatform || undefined,
      ),
    };
  });
  return mapped
    .sort(
      (a, b) =>
        compareVersions(b.version, a.version) ||
        Number(Boolean(a.targetPlatform)) - Number(Boolean(b.targetPlatform)),
    )
    .slice(0, 120);
}

async function fetchManifest(primary?: GalleryVersion): Promise<ManifestInfo> {
  const manifestUrl = primary?.files?.find(
    (file) => file.assetType === 'Microsoft.VisualStudio.Code.Manifest',
  )?.source;
  if (!manifestUrl) return {};
  try {
    const { data } = await safeFetchJson<ManifestInfo>(
      manifestUrl,
      { headers: SOURCE_HEADERS },
      { timeoutMs: 15000, maxBytes: 2 * 1024 * 1024 },
    );
    return data ?? {};
  } catch {
    return {};
  }
}

function repositoryUrl(value: ManifestInfo['repository']): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  return value.url;
}

export const officialMarketplaceAdapter: MarketplaceAdapter = {
  id: 'official',
  label: '官方 Marketplace',

  async search(params: MarketplaceSearchParams): Promise<MarketplacePage> {
    const criteria: Array<{ filterType: number; value: string }> = [
      { filterType: 8, value: 'Microsoft.VisualStudio.Code' },
    ];
    if (params.q) criteria.push({ filterType: 10, value: params.q });
    if (params.category) criteria.push({ filterType: 5, value: params.category });
    const data = await galleryQuery({
      filters: [
        {
          criteria,
          pageNumber: params.page,
          pageSize: params.pageSize,
          sortBy: SORT_BY[params.sort],
          sortOrder: 0,
        },
      ],
      assetTypes: [],
      flags: 914,
    });
    const result = data.results?.[0];
    const total =
      result?.resultMetadata
        ?.find((meta) => meta.metadataType === 'ResultCount')
        ?.metadataItems?.find((item) => item.name === 'TotalCount')?.count ?? 0;
    return {
      items: (result?.extensions ?? []).map(parseSummary),
      total,
      page: params.page,
      pageSize: params.pageSize,
      provider: 'official',
    };
  },

  async detail(rawId: string): Promise<MarketplaceDetail> {
    const id = rawId.trim().toLowerCase();
    if (!ID_PATTERN.test(id)) {
      throw new ApiError(400, 'INVALID_EXTENSION_ID', '插件 ID 必须是 publisher.name 格式');
    }
    const cached = detailCache.get(id);
    if (cached && Date.now() - cached.fetchedAt < DETAIL_CACHE_TTL_MS) {
      return cached.detail;
    }
    // flags 407 = IncludeVersions | IncludeFiles | IncludeCategoryAndTags |
    // IncludeVersionProperties | IncludeAssetUri | IncludeStatistics。
    // 不能带 IncludeLatestVersionOnly（512），否则只会返回最新版本。
    const data = await galleryQuery({
      filters: [
        {
          criteria: [{ filterType: 7, value: id }],
          pageNumber: 1,
          pageSize: 1,
          sortBy: 0,
          sortOrder: 0,
        },
      ],
      assetTypes: [],
      flags: 407,
    });
    const ext = data.results?.[0]?.extensions?.[0];
    if (!ext) throw new ApiError(404, 'NOT_FOUND', '插件市场中不存在该插件');

    const summary = parseSummary(ext);
    const versions = parseVersions(ext);
    const latestVersions = versions.filter((item) => item.version === summary.version);
    const primaryVersion =
      latestVersions.find((item) => !item.targetPlatform) ?? latestVersions[0];
    const rawPrimary = (ext.versions ?? []).find(
      (item) =>
        item.version === primaryVersion?.version &&
        (item.targetPlatform ?? '') === (primaryVersion?.targetPlatform ?? ''),
    );
    const manifest = await fetchManifest(rawPrimary);
    const props = propertiesMap(rawPrimary);
    const categories =
      manifest.categories?.filter((item) => typeof item === 'string' && item.length <= 60) ?? [];

    const detail: MarketplaceDetail = {
      ...summary,
      categories,
      versions,
      dependencies: splitList(props['Microsoft.VisualStudio.Code.ExtensionDependencies']),
      extensionPack: splitList(props['Microsoft.VisualStudio.Code.ExtensionPack']),
      license: manifest.license,
      repositoryUrl: repositoryUrl(manifest.repository),
      homepage: manifest.homepage,
    };
    detailCache.set(id, { detail, fetchedAt: Date.now() });
    return detail;
  },

  async resolvePackage(
    rawId: string,
    version?: string,
    targetPlatform?: string,
  ): Promise<ResolvedMarketplacePackage> {
    const detail = await this.detail(rawId);
    const wanted = version?.trim();
    if (wanted && !isExtensionVersion(wanted)) {
      throw new ApiError(400, 'INVALID_VERSION', '插件版本号格式不正确');
    }
    const targetVersion = wanted || detail.version;
    const candidates = detail.versions.filter((item) => item.version === targetVersion);
    if (candidates.length === 0) {
      throw new ApiError(404, 'VERSION_NOT_FOUND', `插件 ${detail.id} 不存在版本 ${targetVersion}`);
    }
    let chosen: MarketplaceVersion | undefined;
    if (targetPlatform) {
      chosen = candidates.find((item) => item.targetPlatform === targetPlatform);
      if (!chosen) {
        throw new ApiError(
          400,
          'PLATFORM_NOT_FOUND',
          `该版本没有 ${targetPlatform} 目标平台包，可选：${candidates
            .map((item) => item.targetPlatform || 'universal')
            .join(', ')}`,
        );
      }
    } else {
      chosen =
        candidates.find((item) => !item.targetPlatform) ??
        candidates.find((item) => item.targetPlatform === 'linux-x64') ??
        candidates[0];
    }

    const primaryDependencies =
      detail.versions.find((item) => !item.targetPlatform) ?? detail.versions[0];
    return {
      provider: 'official',
      id: detail.id,
      publisher: detail.publisher,
      name: detail.name,
      displayName: detail.displayName,
      description: detail.description,
      version: chosen.version,
      targetPlatform: chosen.targetPlatform,
      engineRange: chosen.engineRange,
      categories: detail.categories,
      dependencies: chosen.dependencies.length
        ? chosen.dependencies
        : primaryDependencies?.dependencies ?? [],
      extensionPack: chosen.extensionPack.length
        ? chosen.extensionPack
        : primaryDependencies?.extensionPack ?? [],
      downloadUrl: chosen.downloadUrl,
      sha256: chosen.sha256,
      publishedAt: chosen.updatedAt ?? detail.updatedAt,
    };
  },
};

export function isMarketplaceId(value: string): boolean {
  return ID_PATTERN.test(value);
}
