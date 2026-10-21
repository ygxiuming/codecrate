import { ApiError } from '../http/errors';
import {
  readResponseText,
  safeFetch,
  safeFetchJson,
  SOURCE_HEADERS,
} from '../net/safeFetch';
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

interface OvsFileSet {
  download?: string;
  sha256?: string;
  icon?: string;
}

interface OvsData {
  namespace?: string;
  name?: string;
  version?: string;
  displayName?: string;
  description?: string;
  downloadCount?: number;
  timestamp?: string;
  categories?: string[];
  keywords?: string[];
  license?: string;
  repository?: string;
  homepage?: string;
  engines?: { vscode?: string };
  files?: OvsFileSet;
  allVersions?: Record<string, string>;
  dependencies?: unknown[];
  bundledExtensions?: Array<{ namespace?: string; extension?: string }>;
  targetPlatform?: string;
  verified?: boolean;
}

interface OvsSearchItem {
  namespace?: string;
  name?: string;
  version?: string;
  displayName?: string;
  description?: string;
  downloadCount?: number;
  timestamp?: string;
  categories?: string[];
  files?: OvsFileSet;
  verified?: boolean;
}

interface OvsSearchResponse {
  extensions?: OvsSearchItem[];
  totalSize?: number;
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9][A-Za-z0-9._-]*$/;

const SORT_BY: Record<MarketplaceSearchParams['sort'], string> = {
  relevance: 'relevance',
  downloads: 'downloadCount',
  updated: 'timestamp',
};

function endpoint(): string {
  return getSetting<string>('marketplace.openvsx.endpoint').replace(/\/+$/, '');
}

function splitId(rawId: string): { namespace: string; name: string } {
  const id = rawId.trim();
  if (!ID_PATTERN.test(id)) {
    throw new ApiError(400, 'INVALID_EXTENSION_ID', '插件 ID 必须是 namespace.name 格式');
  }
  const index = id.indexOf('.');
  return { namespace: id.slice(0, index), name: id.slice(index + 1) };
}

function apiPath(namespace: string, name: string, suffix = ''): string {
  return `${endpoint()}/api/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}${suffix}`;
}

function buildDownloadUrl(namespace: string, name: string, version: string): string {
  return `${apiPath(namespace, name, `/${encodeURIComponent(version)}`)}/file/${encodeURIComponent(namespace)}.${encodeURIComponent(name)}-${encodeURIComponent(version)}.vsix`;
}

function normalizeDependencies(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const result: string[] = [];
  for (const item of input) {
    if (typeof item === 'string' && ID_PATTERN.test(item)) {
      result.push(item);
    } else if (item && typeof item === 'object') {
      const record = item as { namespace?: unknown; extension?: unknown; name?: unknown };
      const namespace = typeof record.namespace === 'string' ? record.namespace : '';
      const extension =
        typeof record.extension === 'string'
          ? record.extension
          : typeof record.name === 'string'
            ? record.name
            : '';
      const id = `${namespace}.${extension}`;
      if (ID_PATTERN.test(id)) result.push(id);
    }
  }
  return [...new Set(result)].slice(0, 100);
}

function mapSummary(data: OvsData): MarketplaceSummary {
  const namespace = data.namespace ?? '';
  const name = data.name ?? '';
  return {
    id: `${namespace}.${name}`,
    publisher: namespace,
    name,
    displayName: data.displayName || name,
    description: data.description ?? '',
    version: data.version ?? '',
    engineRange: data.engines?.vscode,
    downloadCount: data.downloadCount ?? 0,
    updatedAt: data.timestamp,
    categories: Array.isArray(data.categories) ? data.categories.slice(0, 20) : [],
    targetPlatforms: [data.targetPlatform ?? ''],
    source: 'openvsx',
    verified: data.verified,
  };
}

function buildVersions(data: OvsData): MarketplaceVersion[] {
  const namespace = data.namespace ?? '';
  const name = data.name ?? '';
  const versionKeys = Object.keys(data.allVersions ?? {}).filter((key) => key !== 'latest');
  if (data.version && !versionKeys.includes(data.version)) versionKeys.push(data.version);
  const versions = sortVersionsDesc(versionKeys).slice(0, 50);
  return versions.map((version) => ({
    version,
    targetPlatform: version === data.version ? data.targetPlatform ?? '' : '',
    engineRange: data.engines?.vscode,
    updatedAt: version === data.version ? data.timestamp : undefined,
    dependencies: version === data.version ? normalizeDependencies(data.dependencies) : [],
    extensionPack:
      version === data.version
        ? (data.bundledExtensions ?? [])
            .map((item) => `${item.namespace ?? ''}.${item.extension ?? ''}`)
            .filter((id) => ID_PATTERN.test(id))
        : [],
    downloadUrl:
      version === data.version && data.files?.download
        ? data.files.download
        : buildDownloadUrl(namespace, name, version),
  }));
}

async function fetchSha256(url: string | undefined): Promise<string | undefined> {
  if (!url) return undefined;
  try {
    const response = await safeFetch(url, { headers: SOURCE_HEADERS }, { timeoutMs: 15000 });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return undefined;
    }
    const text = (await readResponseText(response, 4096)).trim();
    return /^[0-9a-f]{64}$/i.test(text) ? text.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

async function fetchDetail(
  namespace: string,
  name: string,
  version?: string,
): Promise<OvsData> {
  const suffix = version ? `/${encodeURIComponent(version)}` : '';
  const { data } = await safeFetchJson<OvsData>(
    apiPath(namespace, name, suffix),
    { headers: SOURCE_HEADERS },
    { timeoutMs: 30000, maxBytes: 4 * 1024 * 1024 },
  );
  if (!data?.name || !data?.version) {
    throw new ApiError(404, 'NOT_FOUND', 'Open VSX 中不存在该插件');
  }
  return data;
}

export const openVsxAdapter: MarketplaceAdapter = {
  id: 'openvsx',
  label: 'Open VSX',

  async search(params: MarketplaceSearchParams): Promise<MarketplacePage> {
    const url = new URL(`${endpoint()}/api/-/search`);
    url.searchParams.set('query', params.q);
    url.searchParams.set('size', String(params.pageSize));
    url.searchParams.set('offset', String((params.page - 1) * params.pageSize));
    url.searchParams.set('sortBy', SORT_BY[params.sort]);
    url.searchParams.set('sortOrder', 'desc');
    if (params.category) url.searchParams.set('category', params.category);
    const { data } = await safeFetchJson<OvsSearchResponse>(
      url.href,
      { headers: SOURCE_HEADERS },
      { timeoutMs: 30000, maxBytes: 8 * 1024 * 1024 },
    );
    const items = (data.extensions ?? []).map((item) => ({
      id: `${item.namespace ?? ''}.${item.name ?? ''}`,
      publisher: item.namespace ?? '',
      name: item.name ?? '',
      displayName: item.displayName || item.name || '',
      description: item.description ?? '',
      version: item.version ?? '',
      downloadCount: item.downloadCount ?? 0,
      updatedAt: item.timestamp,
      categories: Array.isArray(item.categories) ? item.categories.slice(0, 20) : [],
      targetPlatforms: [''],
      source: 'openvsx' as const,
      verified: item.verified,
    }));
    return {
      items,
      total: data.totalSize ?? items.length,
      page: params.page,
      pageSize: params.pageSize,
      provider: 'openvsx',
    };
  },

  async detail(rawId: string): Promise<MarketplaceDetail> {
    const { namespace, name } = splitId(rawId);
    const data = await fetchDetail(namespace, name);
    const summary = mapSummary(data);
    return {
      ...summary,
      versions: buildVersions(data),
      dependencies: normalizeDependencies(data.dependencies),
      extensionPack: (data.bundledExtensions ?? [])
        .map((item) => `${item.namespace ?? ''}.${item.extension ?? ''}`)
        .filter((id) => ID_PATTERN.test(id)),
      license: data.license,
      repositoryUrl: data.repository,
      homepage: data.homepage,
    };
  },

  async resolvePackage(
    rawId: string,
    version?: string,
    targetPlatform?: string,
  ): Promise<ResolvedMarketplacePackage> {
    const { namespace, name } = splitId(rawId);
    const wanted = version?.trim();
    if (wanted && !isExtensionVersion(wanted)) {
      throw new ApiError(400, 'INVALID_VERSION', '插件版本号格式不正确');
    }
    const data = await fetchDetail(namespace, name, wanted || 'latest');
    if (targetPlatform && data.targetPlatform && targetPlatform !== data.targetPlatform) {
      throw new ApiError(
        400,
        'PLATFORM_NOT_FOUND',
        `该版本仅提供 ${data.targetPlatform} 包`,
      );
    }
    const downloadUrl =
      data.files?.download ?? buildDownloadUrl(namespace, name, data.version ?? '');
    const sha256 = await fetchSha256(data.files?.sha256);
    return {
      provider: 'openvsx',
      id: `${namespace}.${name}`,
      publisher: namespace,
      name,
      displayName: data.displayName || name,
      description: data.description,
      version: data.version ?? '',
      targetPlatform: data.targetPlatform ?? '',
      engineRange: data.engines?.vscode,
      categories: Array.isArray(data.categories) ? data.categories.slice(0, 20) : [],
      dependencies: normalizeDependencies(data.dependencies),
      extensionPack: (data.bundledExtensions ?? [])
        .map((item) => `${item.namespace ?? ''}.${item.extension ?? ''}`)
        .filter((id) => ID_PATTERN.test(id)),
      downloadUrl,
      sha256,
      publishedAt: data.timestamp,
    };
  },
};

export function compareMarketplaceVersions(a: string, b: string): number {
  return compareVersions(a, b);
}
