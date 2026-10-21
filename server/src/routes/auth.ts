import { Router } from 'express';
import { z } from 'zod';
import { hashPassword, verifyPassword } from '../auth/password';
import { loginLimiter } from '../auth/rateLimit';
import { baseCookieOptions, ADMIN_COOKIE, adminCookieOptions } from '../http/cookies';
import { ApiError, asyncHandler, unauthorized } from '../http/errors';
import { parseBody } from '../http/validate';
import { requireAdmin, originGuard } from '../auth/middleware';
import { getDb, nowIso } from '../db';
import { audit } from '../services/audit';
import {
  createSession,
  revokeOtherSessions,
  revokeSession,
  resolveSession,
} from '../auth/sessions';

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(200),
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(10, '新密码至少 10 位').max(200),
});

let dummyHash: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (!dummyHash) dummyHash = hashPassword('this-is-not-a-real-password');
  return dummyHash;
}

authRouter.post(
  '/login',
  loginLimiter,
  originGuard,
  asyncHandler(async (req, res) => {
    const { username, password } = parseBody(loginSchema, req.body);
    const normalized = username.trim().toLowerCase();
    const admin = getDb()
      .prepare('SELECT id, username, password_hash FROM admin_users WHERE username = ?')
      .get(normalized) as
      | { id: number; username: string; password_hash: string }
      | undefined;

    const hash = admin?.password_hash ?? (await getDummyHash());
    const ok = await verifyPassword(password, hash);
    if (!admin || !ok) {
      audit(req, {
        action: 'auth.login_failed',
        actor: normalized.slice(0, 64),
        detail: { reason: 'invalid_credentials' },
      });
      throw unauthorized('用户名或密码不正确');
    }

    const { token } = createSession(admin.id, req.ip ?? null, req.get('user-agent') ?? null);
    getDb()
      .prepare('UPDATE admin_users SET last_login_at = ?, updated_at = ? WHERE id = ?')
      .run(nowIso(), nowIso(), admin.id);
    res.cookie(ADMIN_COOKIE, token, adminCookieOptions(req));
    audit(req, {
      action: 'auth.login_success',
      actor: admin.username,
      actorId: admin.id,
    });
    res.json({ admin: { id: admin.id, username: admin.username } });
  }),
);

authRouter.post(
  '/logout',
  originGuard,
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[ADMIN_COOKIE];
    if (typeof token === 'string' && token) {
      const admin = resolveSession(token);
      revokeSession(token);
      if (admin) {
        req.admin = admin;
        audit(req, { action: 'auth.logout' });
      }
    }
    res.clearCookie(ADMIN_COOKIE, baseCookieOptions(req));
    res.json({ ok: true });
  }),
);

authRouter.get('/me', requireAdmin, (req, res) => {
  res.json({ admin: { id: req.admin?.id, username: req.admin?.username } });
});

authRouter.post(
  '/password',
  requireAdmin,
  originGuard,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = parseBody(passwordSchema, req.body);
    const adminId = req.admin?.id;
    if (!adminId) throw unauthorized();
    const row = getDb()
      .prepare('SELECT password_hash FROM admin_users WHERE id = ?')
      .get(adminId) as { password_hash: string } | undefined;
    if (!row || !(await verifyPassword(currentPassword, row.password_hash))) {
      throw new ApiError(400, 'INVALID_PASSWORD', '当前密码不正确');
    }
    if (await verifyPassword(newPassword, row.password_hash)) {
      throw new ApiError(400, 'SAME_PASSWORD', '新密码不能与当前密码相同');
    }
    const hash = await hashPassword(newPassword);
    getDb()
      .prepare('UPDATE admin_users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(hash, nowIso(), adminId);
    const token = req.cookies?.[ADMIN_COOKIE];
    if (typeof token === 'string' && token) revokeOtherSessions(adminId, token);
    audit(req, { action: 'auth.password_changed', targetType: 'admin', targetId: adminId });
    res.json({ ok: true });
  }),
);
