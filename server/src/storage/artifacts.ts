import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { getDb, nowIso } from '../db';
import { ApiError, notFound } from '../http/errors';
import { resolveWithin } from './paths';

export type ArtifactType = 'vscode' | 'extension' | 'remote-server' | 'software';

export const ARTIFACT_TYPES: ArtifactType[] = ['vscode', 'extension', 'remote-server', 'software'];

export function isArtifactType(value: string): value is ArtifactType {
  return (ARTIFACT_TYPES as string[]).includes(value);
}

export interface ArtifactRecord {
  id: number;
  filename: string;
  stored_path: string;
  size_bytes: number;
  sha256: string;
  download_count: number;
  icon_path?: string | null;
  version?: string;
  platform?: string;
  channel?: string;
  extension_id?: string;
  display_name?: string | null;
  target_platform?: string;
  commit_hash?: string | null;
  created_at?: string;
  verified_at?: string | null;
}

export function findArtifact(type: ArtifactType, id: number): ArtifactRecord | null {
  const db = getDb();
  switch (type) {
    case 'vscode':
      return (
        (db
          .prepare(
            'SELECT id, filename, stored_path, size_bytes, sha256, download_count, version, platform, channel, commit_hash, created_at, verified_at FROM vscode_packages WHERE id = ?',
          )
          .get(id) as ArtifactRecord | undefined) ?? null
      );
    case 'extension':
      return (
        (db
          .prepare(
            'SELECT id, filename, stored_path, size_bytes, sha256, download_count, version, extension_id, display_name, icon_path, target_platform, created_at, verified_at FROM extensions WHERE id = ?',
          )
          .get(id) as ArtifactRecord | undefined) ?? null
      );
    case 'remote-server':
      return (
        (db
          .prepare(
            'SELECT id, filename, stored_path, size_bytes, sha256, download_count, version, platform, commit_hash, created_at, verified_at FROM remote_servers WHERE id = ?',
          )
          .get(id) as ArtifactRecord | undefined) ?? null
      );
    case 'software':
      return (
        (db
          .prepare(
            'SELECT id, filename, stored_path, size_bytes, sha256, download_count, name, version, platform, category, created_at, verified_at FROM software_packages WHERE id = ?',
          )
          .get(id) as ArtifactRecord | undefined) ?? null
      );
    default:
      return null;
  }
}

export function findArtifactByFile(
  type: ArtifactType,
  absolutePath: string,
): ArtifactRecord | null {
  const db = getDb();
  const relative = path.relative(config.storageDir, absolutePath).split(path.sep).join('/');
  switch (type) {
    case 'vscode':
      return (
        (db.prepare('SELECT * FROM vscode_packages WHERE stored_path = ?').get(relative) as
          | ArtifactRecord
          | undefined) ?? null
      );
    case 'extension':
      return (
        (db.prepare('SELECT * FROM extensions WHERE stored_path = ?').get(relative) as
          | ArtifactRecord
          | undefined) ?? null
      );
    case 'remote-server':
      return (
        (db.prepare('SELECT * FROM remote_servers WHERE stored_path = ?').get(relative) as
          | ArtifactRecord
          | undefined) ?? null
      );
    case 'software':
      return (
        (db.prepare('SELECT * FROM software_packages WHERE stored_path = ?').get(relative) as
          | ArtifactRecord
          | undefined) ?? null
      );
    default:
      return null;
  }
}

export function incrementDownloadCount(type: ArtifactType, id: number): void {
  const db = getDb();
  switch (type) {
    case 'vscode':
      db.prepare('UPDATE vscode_packages SET download_count = download_count + 1 WHERE id = ?').run(id);
      return;
    case 'extension':
      db.prepare('UPDATE extensions SET download_count = download_count + 1 WHERE id = ?').run(id);
      return;
    case 'remote-server':
      db.prepare('UPDATE remote_servers SET download_count = download_count + 1 WHERE id = ?').run(id);
      return;
    case 'software':
      db.prepare('UPDATE software_packages SET download_count = download_count + 1 WHERE id = ?').run(id);
      return;
  }
}

export interface ArtifactListQuery {
  search: string;
  page: number;
  pageSize: number;
  offset: number;
}

export interface ArtifactListResult {
  items: Array<ArtifactRecord & { type: ArtifactType }>;
  total: number;
}

export function listArtifacts(type: ArtifactType, query: ArtifactListQuery): ArtifactListResult {
  const db = getDb();
  const like = `%${query.search.toLowerCase()}%`;
  switch (type) {
    case 'vscode': {
      const where = query.search
        ? 'WHERE lower(version) LIKE ? OR lower(platform) LIKE ? OR lower(filename) LIKE ?'
        : '';
      const params = query.search ? [like, like, like] : [];
      const total = (
        db.prepare(`SELECT COUNT(*) AS count FROM vscode_packages ${where}`).get(...params) as {
          count: number;
        }
      ).count;
      const items = db
        .prepare(
          `SELECT id, filename, stored_path, size_bytes, sha256, download_count, version, platform, channel, commit_hash, created_at, verified_at
           FROM vscode_packages ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, query.pageSize, query.offset) as ArtifactRecord[];
      return { items: items.map((item) => ({ ...item, type })), total };
    }
    case 'extension': {
      const where = query.search
        ? 'WHERE lower(extension_id) LIKE ? OR lower(display_name) LIKE ? OR lower(filename) LIKE ?'
        : '';
      const params = query.search ? [like, like, like] : [];
      const total = (
        db.prepare(`SELECT COUNT(*) AS count FROM extensions ${where}`).get(...params) as {
          count: number;
        }
      ).count;
      const items = db
        .prepare(
          `SELECT id, filename, stored_path, size_bytes, sha256, download_count, version, extension_id, display_name, icon_path, target_platform, created_at, verified_at
           FROM extensions ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, query.pageSize, query.offset) as ArtifactRecord[];
      return { items: items.map((item) => ({ ...item, type })), total };
    }
    case 'remote-server': {
      const where = query.search
        ? 'WHERE lower(version) LIKE ? OR lower(platform) LIKE ? OR lower(filename) LIKE ?'
        : '';
      const params = query.search ? [like, like, like] : [];
      const total = (
        db.prepare(`SELECT COUNT(*) AS count FROM remote_servers ${where}`).get(...params) as {
          count: number;
        }
      ).count;
      const items = db
        .prepare(
          `SELECT id, filename, stored_path, size_bytes, sha256, download_count, version, platform, commit_hash, created_at, verified_at
           FROM remote_servers ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, query.pageSize, query.offset) as ArtifactRecord[];
      return { items: items.map((item) => ({ ...item, type })), total };
    }
    case 'software': {
      const where = query.search
        ? 'WHERE lower(name) LIKE ? OR lower(version) LIKE ? OR lower(platform) LIKE ? OR lower(category) LIKE ? OR lower(filename) LIKE ?'
        : '';
      const params = query.search ? [like, like, like, like, like] : [];
      const total = (
        db.prepare(`SELECT COUNT(*) AS count FROM software_packages ${where}`).get(...params) as {
          count: number;
        }
      ).count;
      const items = db
        .prepare(
          `SELECT id, filename, stored_path, size_bytes, sha256, download_count, name, version, platform, category, source, created_at, updated_at, verified_at
           FROM software_packages ${where} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, query.pageSize, query.offset) as ArtifactRecord[];
      return { items: items.map((item) => ({ ...item, type })), total };
    }
    default:
      return { items: [], total: 0 };
  }
}

export async function deleteArtifact(type: ArtifactType, id: number): Promise<ArtifactRecord> {
  const record = findArtifact(type, id);
  if (!record) throw notFound('资源不存在');
  const absolute = resolveWithin(record.stored_path);
  try {
    await fs.promises.unlink(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (type === 'extension' && record.icon_path) {
    // 图标按内容哈希共享，仍有其他插件引用时不能删除。
    const shared = getDb()
      .prepare('SELECT 1 AS hit FROM extensions WHERE icon_path = ? AND id != ? LIMIT 1')
      .get(record.icon_path, id);
    if (!shared) {
      try {
        await fs.promises.unlink(resolveWithin(record.icon_path));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }

  const db = getDb();
  switch (type) {
    case 'vscode':
      db.prepare('DELETE FROM vscode_packages WHERE id = ?').run(id);
      break;
    case 'extension':
      db.prepare('DELETE FROM extensions WHERE id = ?').run(id);
      break;
    case 'remote-server':
      db.prepare('DELETE FROM remote_servers WHERE id = ?').run(id);
      break;
    case 'software':
      db.prepare('DELETE FROM software_packages WHERE id = ?').run(id);
      break;
  }
  return record;
}

export function markVerified(type: ArtifactType, id: number): void {
  const db = getDb();
  const timestamp = nowIso();
  switch (type) {
    case 'vscode':
      db.prepare('UPDATE vscode_packages SET verified_at = ? WHERE id = ?').run(timestamp, id);
      return;
    case 'extension':
      db.prepare('UPDATE extensions SET verified_at = ? WHERE id = ?').run(timestamp, id);
      return;
    case 'remote-server':
      db.prepare('UPDATE remote_servers SET verified_at = ? WHERE id = ?').run(timestamp, id);
      return;
    case 'software':
      db.prepare('UPDATE software_packages SET verified_at = ? WHERE id = ?').run(timestamp, id);
      return;
  }
}

export function assertArtifactType(value: string): ArtifactType {
  if (!isArtifactType(value)) {
    throw new ApiError(400, 'INVALID_TYPE', '资源类型必须是 vscode、extension、remote-server 或 software');
  }
  return value;
}
