import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../db';
import { ApiError, badRequest } from '../http/errors';
import {
  removeIfExists,
  resolveWithin,
  safeFilename,
  storageRelative,
  hashFile,
} from '../storage/paths';
import { isValidVSCodeVersion } from '../utils/semver';
import { findRemotePlatform } from '../adapters/platforms';
import { inferPlatformFromFilename, inspectServerArchive } from './serverArchive';
import { upsertRemoteServer } from './queue';

export interface ImportRemoteServerInput {
  tempPath: string;
  originalName: string;
  version?: string;
  platform?: string;
  commit?: string;
}

export interface ImportRemoteServerResult {
  artifactId: number;
  version: string;
  platform: string;
  commitHash: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
  buildTime: string | null;
}

async function moveFile(from: string, to: string): Promise<void> {
  try {
    await fs.promises.rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await fs.promises.copyFile(from, to);
    await fs.promises.unlink(from);
  }
}

/**
 * 手动导入 server 包：优先从包内 product.json 与标准文件名识别元数据。
 * 文件落盘前完成元数据校验，避免把错误 commit 关联到版本上。
 */
export async function importRemoteServerPackage(
  input: ImportRemoteServerInput,
): Promise<ImportRemoteServerResult> {
  const info = await inspectServerArchive(input.tempPath);

  const version = (input.version || info?.version || '').trim();
  if (!isValidVSCodeVersion(version)) {
    throw badRequest(
      '无法识别版本号：请填写 VS Code 版本号，或上传包含 product.json 的 server 包',
    );
  }
  const platform = (input.platform || inferPlatformFromFilename(input.originalName) || '').trim();
  if (!findRemotePlatform(platform)) {
    throw badRequest('无法识别 server 平台：请选择远端主机平台，或使用标准文件名');
  }
  const commit = (input.commit || info?.commit || '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw badRequest('无法识别 commit：请填写 40 位 commit，或上传包含 product.json 的 server 包');
  }
  if (info?.version && info.version !== version) {
    throw new ApiError(
      422,
      'METADATA_MISMATCH',
      `包内版本 ${info.version} 与填写的版本 ${version} 不一致`,
    );
  }
  if (info?.commit && info.commit !== commit) {
    throw new ApiError(
      422,
      'METADATA_MISMATCH',
      `包内 commit ${info.commit} 与填写的 commit ${commit} 不一致`,
    );
  }

  const fallbackExt = /\.zip$/i.test(input.originalName) ? 'zip' : 'tar.gz';
  const filename = safeFilename(input.originalName, `vscode-server-${platform}.${fallbackExt}`);
  const relativePath = storageRelative('remote-server', version, commit, platform, filename);
  const absolutePath = resolveWithin(relativePath);
  await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });

  const sha256 = await hashFile(input.tempPath);
  const size = (await fs.promises.stat(input.tempPath)).size;
  const previous = getDb()
    .prepare('SELECT stored_path FROM remote_servers WHERE version = ? AND platform = ?')
    .get(version, platform) as { stored_path: string } | undefined;
  await removeIfExists(absolutePath);
  await moveFile(input.tempPath, absolutePath);
  if (previous && previous.stored_path !== relativePath) {
    await removeIfExists(resolveWithin(previous.stored_path)).catch(() => undefined);
  }

  const artifactId = upsertRemoteServer({
    version,
    platform,
    commitHash: commit,
    filename,
    storedPath: relativePath,
    size,
    sha256,
  });
  return {
    artifactId,
    version,
    platform,
    commitHash: commit,
    filename,
    sizeBytes: size,
    sha256,
    buildTime: info?.buildTime ?? null,
  };
}
