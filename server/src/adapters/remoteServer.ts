import { ApiError } from '../http/errors';
import { FetchError } from '../net/safeFetch';
import { getSetting } from '../services/settings';
import { displayFilename } from '../storage/paths';
import { isValidVSCodeVersion } from '../utils/semver';
import { filenameFromUrl, probeBinaryUrl } from './downloadProbe';
import { findRemotePlatform } from './platforms';
import type { ResolvedArtifact } from './types';
import { resolveVSCodeCommit } from './vscode';

export async function resolveRemoteServerPackage(
  version: string,
  platform: string,
  channel = 'stable',
): Promise<ResolvedArtifact> {
  if (!isValidVSCodeVersion(version)) {
    throw new ApiError(400, 'INVALID_VERSION', 'VS Code 版本号格式不正确');
  }
  if (!findRemotePlatform(platform)) {
    throw new ApiError(400, 'INVALID_PLATFORM', `未知 Remote-SSH server 平台：${platform}`);
  }
  const { commitHash, buildTime } = await resolveVSCodeCommit(version);
  const base = getSetting<string>('sources.remote.download_base').replace(/\/+$/, '');
  const url = `${base}/commit:${commitHash}/server-${encodeURIComponent(platform)}/${channel}`;
  const probed = await probeBinaryUrl(url);
  const filename = displayFilename(
    filenameFromUrl(probed.finalUrl),
    `vscode-server-${platform}-${commitHash}`,
  );
  if (!probed.finalUrl.href.includes(commitHash)) {
    throw new FetchError('INVALID_JSON', 'Remote-SSH server 下载地址与 commit 不匹配');
  }
  return {
    url: probed.finalUrl.href,
    filename,
    sizeBytes: probed.sizeBytes,
    contentType: probed.contentType,
    commitHash,
    buildTime,
  };
}
