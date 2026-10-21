import crypto from 'node:crypto';
import { config } from '../config';
import { getDb, nowIso } from '../db';

export interface AdminPrincipal {
  id: number;
  username: string;
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createSession(
  adminId: number,
  ip: string | null,
  userAgent: string | null,
): { token: string; expiresAt: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.sessionHours * 60 * 60 * 1000).toISOString();
  getDb()
    .prepare(
      'INSERT INTO sessions (token_hash, admin_id, role, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(hashToken(token), adminId, 'admin', nowIso(), expiresAt, ip, userAgent);
  return { token, expiresAt };
}

export function resolveSession(token: string): AdminPrincipal | null {
  if (!token || token.length > 200) return null;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT a.id AS id, a.username AS username, s.expires_at AS expires_at
       FROM sessions s JOIN admin_users a ON a.id = s.admin_id
       WHERE s.token_hash = ?`,
    )
    .get(hashToken(token)) as { id: number; username: string; expires_at: string } | undefined;
  if (!row) return null;
  if (Date.parse(row.expires_at) <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    return null;
  }
  return { id: row.id, username: row.username };
}

export function revokeSession(token: string): void {
  getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

export function revokeOtherSessions(adminId: number, keepToken: string): void {
  getDb()
    .prepare('DELETE FROM sessions WHERE admin_id = ? AND token_hash <> ?')
    .run(adminId, hashToken(keepToken));
}

export function cleanupExpiredSessions(): number {
  return getDb().prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso()).changes;
}
