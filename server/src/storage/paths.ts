import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { ApiError } from '../http/errors';

/** 存储键只允许普通路径段：拒绝空段、`.`/`..`、反斜杠与控制字符。 */
function assertStoredKey(relativePath: string): string {
  if (!relativePath || relativePath.length > 1024) {
    throw new ApiError(400, 'INVALID_PATH', '非法的存储路径');
  }
  if (relativePath.includes('\0') || relativePath.includes('\\') || path.isAbsolute(relativePath)) {
    throw new ApiError(400, 'INVALID_PATH', '非法的存储路径');
  }
  const segments = relativePath.split('/');
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') {
      throw new ApiError(400, 'INVALID_PATH', '非法的存储路径');
    }
  }
  return segments.join('/');
}

export function resolveWithin(relativePath: string): string {
  const root = path.resolve(config.storageDir);
  const key = assertStoredKey(relativePath);
  return `${root}${path.sep}${key.split('/').join(path.sep)}`;
}

export function toRelative(absolutePath: string): string {
  const root = path.resolve(config.storageDir);
  const absolute = path.resolve(absolutePath);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new ApiError(400, 'INVALID_PATH', '路径不在存储目录内');
  }
  return path.relative(root, absolute).split(path.sep).join('/');
}

/** 落盘文件名只保留 ASCII 安全字符，展示名单独存库。 */
export function safeFilename(name: string, fallback: string): string {
  const base = path.basename(name.replace(/\\/g, '/')).normalize('NFKC');
  const cleaned = base
    .replace(/[^A-Za-z0-9._+@-]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 160);
  return cleaned || fallback;
}

export function displayFilename(name: string, fallback: string): string {
  const base = path.basename(name.replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '');
  return base.slice(0, 180) || fallback;
}

export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function hashFile(absolutePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(absolutePath);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

export async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.promises.access(absolutePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function removeIfExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.promises.unlink(absolutePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export function storageRelative(...segments: string[]): string {
  return segments.filter(Boolean).join('/');
}
