import { ApiError } from '../http/errors';
import { FetchError, safeFetchJson, SOURCE_HEADERS } from '../net/safeFetch';
import { getSetting } from '../services/settings';
import { displayFilename } from '../storage/paths';
import { isValidVSCodeVersion, sortVersionsDesc } from '../utils/semver';
import { filenameFromUrl, probeBinaryUrl } from './downloadProbe';
import { findVSCodePlatform } from './platforms';
import type { ResolvedArtifact } from './types';

interface VersionCacheEntry {
  versions: string[];
  fetchedAt: number;
}

const versionCache = new Map<string, VersionCacheEntry>();
const commitCache = new Map<string, { commitHash: string; buildTime?: string; fetchedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export function invalidateVSCodeCaches(): void {
  versionCache.clear();
  commitCache.clear();
}

export async function listVSCodeVersions(): Promise<string[]> {
  const cached = versionCache.get('stable');
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.versions;
  const url = getSetting<string>('sources.vscode.releases_url');
  const { data } = await safeFetchJson<unknown>(
    url,
    { headers: SOURCE_HEADERS },
    { timeoutMs: 20000, maxBytes: 8 * 1024 * 1024 },
  );
  if (!Array.isArray(data)) {
    throw new FetchError('INVALID_JSON', 'VS Code 版本列表格式异常');
  }
  const versions = sortVersionsDesc(
    data.filter((item): item is string => typeof item === 'string' && isValidVSCodeVersion(item)),
  );
  versionCache.set('stable', { versions, fetchedAt: Date.now() });
  return versions;
}

function extractBuildTime(filename: string): string | undefined {
  const match = filename.match(/-(\d{10})(?=[._-]|$)/);
  if (!match) return undefined;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds < 1_000_000_000) return undefined;
  return new Date(seconds * 1000).toISOString();
}

function extractCommit(finalUrl: URL): string | undefined {
  const match = finalUrl.pathname.match(/\/([0-9a-f]{40})(?:\/|$)/i);
  return match ? match[1].toLowerCase() : undefined;
}

export async function resolveVSCodePackage(
  version: string,
  platform: string,
  channel = 'stable',
): Promise<ResolvedArtifact> {
  if (!isValidVSCodeVersion(version)) {
    throw new ApiError(400, 'INVALID_VERSION', 'VS Code 版本号格式不正确');
  }
  if (channel !== 'stable') {
    throw new ApiError(400, 'UNSUPPORTED_CHANNEL', '当前仅支持 stable 渠道');
  }
  if (!findVSCodePlatform(platform)) {
    throw new ApiError(400, 'INVALID_PLATFORM', `未知平台：${platform}`);
  }
  const base = getSetting<string>('sources.vscode.download_base').replace(/\/+$/, '');
  const url = `${base}/${encodeURIComponent(version)}/${encodeURIComponent(platform)}/${channel}`;
  const probed = await probeBinaryUrl(url);
  const filename = displayFilename(
    filenameFromUrl(probed.finalUrl),
    `VSCode-${version}-${platform}`,
  );
  return {
    url: probed.finalUrl.href,
    filename,
    sizeBytes: probed.sizeBytes,
    contentType: probed.contentType,
    commitHash: extractCommit(probed.finalUrl),
    buildTime: extractBuildTime(filename),
  };
}

export async function resolveVSCodeCommit(
  version: string,
): Promise<{ commitHash: string; buildTime?: string }> {
  const cached = commitCache.get(version);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;
  const artifact = await resolveVSCodePackage(version, 'linux-x64');
  if (!artifact.commitHash) {
    throw new FetchError('INVALID_JSON', `无法从下载地址解析 ${version} 的 commit`);
  }
  const entry = {
    commitHash: artifact.commitHash,
    buildTime: artifact.buildTime,
    fetchedAt: Date.now(),
  };
  commitCache.set(version, entry);
  return entry;
}
