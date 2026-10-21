import fs from 'node:fs';
import { getDb } from '../db';
import { resolveWithin } from '../storage/paths';

export interface UpdateServerRecord {
  id: number;
  filename: string;
  absolutePath: string;
}

export async function findServerForUpdate(
  commit: string,
  platform: string,
): Promise<UpdateServerRecord | null> {
  const row = getDb()
    .prepare(
      `SELECT id, filename, stored_path FROM remote_servers
       WHERE lower(commit_hash) = ? AND platform = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(commit, platform) as
    | { id: number; filename: string; stored_path: string }
    | undefined;
  if (!row) return null;
  const absolutePath = resolveWithin(row.stored_path);
  const stat = await fs.promises.stat(absolutePath).catch(() => null);
  if (!stat || !stat.isFile()) return null;
  return { id: row.id, filename: row.filename, absolutePath };
}
