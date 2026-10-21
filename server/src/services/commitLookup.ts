import { listVSCodeVersions, resolveVSCodePackage } from '../adapters/vscode';
import { getDb } from '../db';
import { badRequest } from '../http/errors';

export interface CommitMatch {
  version: string;
  commitHash: string;
  buildTime?: string;
  source: 'cache' | 'probe';
}

export interface CommitLookupResult {
  found: boolean;
  commit: string;
  matches: CommitMatch[];
  warning?: string;
  elapsedMs: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const RECENT_VERSIONS = 150;
const PROBE_CONCURRENCY = 8;

const lookupCache = new Map<string, { result: CommitLookupResult; at: number }>();

function dedupe(matches: CommitMatch[]): CommitMatch[] {
  const seen = new Set<string>();
  const result: CommitMatch[] = [];
  for (const match of matches) {
    const key = `${match.version}|${match.commitHash}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(match);
  }
  return result;
}

/**
 * 反查 commit 对应的 VS Code 版本：
 * 1. 先查本地已缓存资源（精确/前缀）；
 * 2. 再在最近 150 个稳定版中探测（官方 update API 无法按旧 commit 反查）。
 */
export async function lookupCommitByPrefix(rawCommit: string): Promise<CommitLookupResult> {
  const commit = rawCommit.trim().toLowerCase();
  if (!/^[0-9a-f]{7,40}$/.test(commit)) {
    throw badRequest('commit 必须是 7-40 位十六进制字符');
  }
  const cached = lookupCache.get(commit);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result;

  const startedAt = Date.now();
  const db = getDb();
  const pattern = `${commit}%`;
  const vscodeRows = db
    .prepare(
      `SELECT version, commit_hash, build_time FROM vscode_packages
       WHERE lower(commit_hash) LIKE ? ORDER BY id DESC LIMIT 10`,
    )
    .all(pattern) as Array<{
    version: string;
    commit_hash: string | null;
    build_time: string | null;
  }>;
  const remoteRows = db
    .prepare(
      `SELECT version, commit_hash FROM remote_servers
       WHERE lower(commit_hash) LIKE ? ORDER BY id DESC LIMIT 10`,
    )
    .all(pattern) as Array<{ version: string; commit_hash: string | null }>;

  const cachedMatches = dedupe([
    ...vscodeRows.map((row) => ({
      version: row.version,
      commitHash: row.commit_hash ?? '',
      buildTime: row.build_time ?? undefined,
      source: 'cache' as const,
    })),
    ...remoteRows.map((row) => ({
      version: row.version,
      commitHash: row.commit_hash ?? '',
      source: 'cache' as const,
    })),
  ]).filter((match) => match.commitHash);

  if (cachedMatches.length > 0) {
    const result: CommitLookupResult = {
      found: true,
      commit,
      matches: cachedMatches.slice(0, 5),
      elapsedMs: Date.now() - startedAt,
    };
    lookupCache.set(commit, { result, at: Date.now() });
    return result;
  }

  const versions = (await listVSCodeVersions()).slice(0, RECENT_VERSIONS);
  const matches: CommitMatch[] = [];
  for (let index = 0; index < versions.length; index += PROBE_CONCURRENCY) {
    const batch = versions.slice(index, index + PROBE_CONCURRENCY);
    const probed = await Promise.all(
      batch.map(async (version) => {
        try {
          const artifact = await resolveVSCodePackage(version, 'linux-x64');
          return artifact.commitHash?.toLowerCase().startsWith(commit)
            ? {
                version,
                commitHash: artifact.commitHash,
                buildTime: artifact.buildTime,
                source: 'probe' as const,
              }
            : null;
        } catch {
          return null;
        }
      }),
    );
    for (const item of probed) {
      if (item) matches.push(item);
    }
    if (matches.length > 0) break;
  }

  const result: CommitLookupResult = {
    found: matches.length > 0,
    commit,
    matches: dedupe(matches).slice(0, 5),
    warning:
      matches.length > 0
        ? undefined
        : `未在最近 ${RECENT_VERSIONS} 个稳定版中找到该 commit。若版本更早，请直接按版本号搜索或缓存后再按 commit 查询。`,
    elapsedMs: Date.now() - startedAt,
  };
  lookupCache.set(commit, { result, at: Date.now() });
  return result;
}

export function invalidateCommitLookupCache(): void {
  lookupCache.clear();
}
