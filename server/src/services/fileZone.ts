import fs from 'node:fs';
import path from 'node:path';
import { getDb, nowIso } from '../db';
import { ApiError, badRequest, forbidden } from '../http/errors';
import { getSetting } from './settings';
import {
  displayFilename,
  hashFile,
  moveFile,
  removeIfExists,
  resolveWithin,
  safeFilename,
} from '../storage/paths';

export type FileZone = 'public' | 'shares';

/** 「永久有效」哨兵值：远期时间，字符串比较与日期解析都安全。 */
export const PERMANENT_EXPIRY = '9999-12-31T23:59:59.999Z';

export function isPermanentExpiry(value: string): boolean {
  return value.startsWith('9999-');
}

export const EXPIRY_UNIT_MS: Record<'minutes' | 'hours' | 'days', number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

export interface UploadLimits {
  maxFileBytes: number;
  blockedExtensions: string[];
  quotaBytes: number;
}

export function getBlockedExtensions(): string[] {
  const raw = getSetting<unknown>('public.blocked_extensions');
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => String(item).trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean)
    .slice(0, 100);
}

export function getUploadLimits(): UploadLimits {
  return {
    maxFileBytes: Number(getSetting<number>('public.max_file_bytes')) || 2 * 1024 * 1024 * 1024,
    blockedExtensions: getBlockedExtensions(),
    quotaBytes: Number(getSetting<number>('public.quota_bytes')) || 0,
  };
}

export function getZoneUsage(): { publicBytes: number; shareBytes: number; totalBytes: number } {
  const publicBytes = (
    getDb().prepare('SELECT COALESCE(SUM(size_bytes), 0) AS bytes FROM public_files').get() as {
      bytes: number;
    }
  ).bytes;
  const shareBytes = (
    getDb().prepare('SELECT COALESCE(SUM(size_bytes), 0) AS bytes FROM file_shares').get() as {
      bytes: number;
    }
  ).bytes;
  return { publicBytes, shareBytes, totalBytes: publicBytes + shareBytes };
}

/** 扩展名黑名单 + 双区共享总配额检查（0 = 不限制）。 */
export function assertUploadAllowed(originalName: string, size: number): void {
  const limits = getUploadLimits();
  const extension = path.extname(originalName).toLowerCase().replace(/^\./, '');
  if (extension && limits.blockedExtensions.includes(extension)) {
    throw forbidden(`不允许上传 .${extension} 类型的文件`);
  }
  if (limits.quotaBytes > 0) {
    const { totalBytes } = getZoneUsage();
    if (totalBytes + size > limits.quotaBytes) {
      throw new ApiError(413, 'QUOTA_EXCEEDED', '文件区剩余空间不足，请联系管理员调整配额');
    }
  }
}

export interface ZoneFileImportResult {
  displayName: string;
  storedPath: string;
  sizeBytes: number;
  sha256: string;
}

/** 落盘公共区/私人共享文件：唯一前缀防覆盖，展示名与存储名分离。 */
export async function importZoneFile(
  zone: FileZone,
  tempPath: string,
  originalName: string,
): Promise<ZoneFileImportResult> {
  const displayName = displayFilename(originalName, 'file');
  if (!displayName) throw badRequest('文件名不合法');
  const storedName = `${Date.now().toString(36)}-${safeFilename(originalName, 'file')}`;
  const relativePath = `${zone}/${storedName}`;
  const absolutePath = resolveWithin(relativePath);
  await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
  const sha256 = await hashFile(tempPath);
  const size = (await fs.promises.stat(tempPath)).size;
  await moveFile(tempPath, absolutePath);
  return { displayName, storedPath: relativePath, sizeBytes: size, sha256 };
}

export function zoneExpiryFromNow(retentionDays: number): string {
  return new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000).toISOString();
}

export function zoneExpiryFromHours(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

export interface UploadDuplicate {
  source: 'public' | 'software';
  name: string;
  info: string;
}

/**
 * 按 SHA256 查找内容重复的资源：公共区只对比未过期文件，
 * 软件包全量对比。私人传递不参与查重（也不被查重）。
 */
export function findUploadDuplicates(sha256: string): UploadDuplicate[] {
  if (!sha256) return [];
  const db = getDb();
  const now = nowIso();
  const duplicates: UploadDuplicate[] = [];

  const publicRows = db
    .prepare(
      `SELECT filename, note, created_at FROM public_files
       WHERE sha256 = ? AND expires_at > ? LIMIT 5`,
    )
    .all(sha256, now) as Array<{ filename: string; note: string; created_at: string }>;
  for (const row of publicRows) {
    duplicates.push({
      source: 'public',
      name: row.filename,
      info: `公共区文件 · 上传于 ${row.created_at.slice(0, 10)}${row.note ? ` · 备注：${row.note}` : ''}`,
    });
  }

  const softwareRows = db
    .prepare(
      `SELECT name, version, category, filename FROM software_packages
       WHERE sha256 = ? LIMIT 5`,
    )
    .all(sha256) as Array<{ name: string; version: string; category: string; filename: string }>;
  for (const row of softwareRows) {
    duplicates.push({
      source: 'software',
      name: row.name,
      info: `软件包 · ${row.version || '未标注版本'} · 分类「${row.category}」 · ${row.filename}`,
    });
  }
  return duplicates;
}

export interface ShareRow {
  id: number;
  filename: string;
  stored_path: string;
  size_bytes: number;
  sha256: string;
  note: string;
  code_hash: string;
  code_hmac: string;
  max_downloads: number | null;
  download_count: number;
  revoked: number;
  expires_at: string;
  created_at: string;
}

export interface PublicFileRow {
  id: number;
  filename: string;
  stored_path: string;
  size_bytes: number;
  sha256: string;
  note: string;
  uploader_ip: string;
  visitor_id: string;
  download_count: number;
  expires_at: string;
  created_at: string;
}

export function getPublicFileById(id: number): PublicFileRow | undefined {
  return getDb().prepare('SELECT * FROM public_files WHERE id = ?').get(id) as
    | PublicFileRow
    | undefined;
}

export function getShareById(id: number): ShareRow | undefined {
  return getDb().prepare('SELECT * FROM file_shares WHERE id = ?').get(id) as
    | ShareRow
    | undefined;
}

export class ShareUnavailableError extends ApiError {}

/** 取件是否仍可用：未撤销、未过期、未超次数。 */
export function assertShareUsable(row: ShareRow): void {
  const now = nowIso();
  if (row.revoked) throw new ShareUnavailableError(410, 'SHARE_REVOKED', '该取件已被管理员撤销');
  if (row.expires_at <= now) throw new ShareUnavailableError(410, 'SHARE_EXPIRED', '该取件已过期');
  if (row.max_downloads !== null && row.download_count >= row.max_downloads) {
    throw new ShareUnavailableError(410, 'SHARE_EXHAUSTED', '该取件的下载次数已用完');
  }
}

export function getActiveShare(id: number): ShareRow {
  const row = getShareById(id);
  if (!row) throw new ApiError(404, 'NOT_FOUND', '取件不存在或已失效');
  assertShareUsable(row);
  return row;
}

function assertStoredKeySafe(storedPath: string): string {
  if (!storedPath || storedPath.startsWith('/') || storedPath.split('/').includes('..')) {
    throw new ApiError(400, 'INVALID_PATH', '非法的存储路径');
  }
  return storedPath;
}

/** 删除公共区文件（磁盘 + 记录），返回文件名；记录不存在时返回 null。 */
export async function deletePublicFileRecord(id: number): Promise<string | null> {
  const row = getPublicFileById(id);
  if (!row) return null;
  await removeIfExists(resolveWithin(assertStoredKeySafe(row.stored_path)));
  getDb().prepare('DELETE FROM public_files WHERE id = ?').run(id);
  return row.filename;
}

/** 删除私人取件（磁盘 + 记录），返回文件名；记录不存在时返回 null。 */
export async function deleteShareRecord(id: number): Promise<string | null> {
  const row = getShareById(id);
  if (!row) return null;
  await removeIfExists(resolveWithin(assertStoredKeySafe(row.stored_path)));
  getDb().prepare('DELETE FROM file_shares WHERE id = ?').run(id);
  return row.filename;
}
