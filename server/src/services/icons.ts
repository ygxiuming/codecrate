import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { ApiError } from '../http/errors';

const ICON_DIR = () => path.join(config.storageDir, 'icons');

/** 图标以内容哈希命名，存放在独立静态目录，避免动态文件读取接口。 */
export async function saveIcon(data: Buffer, extension: string): Promise<string> {
  const safeExtension = extension.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
  const hash = crypto.createHash('sha256').update(data).digest('hex').slice(0, 32);
  const filename = `${hash}.${safeExtension}`;
  const directory = ICON_DIR();
  await fs.promises.mkdir(directory, { recursive: true });
  const absolute = path.join(directory, filename);
  try {
    await fs.promises.writeFile(absolute, data, { flag: 'wx', mode: 0o644 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  return `icons/${filename}`;
}

export function iconDirectory(): string {
  return ICON_DIR();
}

export function iconPublicUrl(relativePath: string | null | undefined): string | null {
  if (!relativePath) return null;
  return `/icons/${path.basename(relativePath)}`;
}

export function assertIconPath(relativePath: string): string {
  const basename = path.basename(relativePath);
  if (!/^[a-f0-9]{32}\.(png|jpg|jpeg|gif|webp)$/i.test(basename)) {
    throw new ApiError(400, 'INVALID_ICON', '图标文件名不合法');
  }
  return path.join(ICON_DIR(), basename);
}
