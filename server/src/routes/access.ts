import { Router } from 'express';
import { z } from 'zod';
import {
  clearAccessCookie,
  issueAccessCookie,
  verifyAccessCookie,
} from '../auth/middleware';
import { accessCodeLimiter } from '../auth/rateLimit';
import { ACCESS_COOKIE } from '../http/cookies';
import { ApiError, asyncHandler, unauthorized } from '../http/errors';
import { parseBody } from '../http/validate';
import { audit } from '../services/audit';
import { getSetting } from '../services/settings';
import { verifyPassword } from '../auth/password';
import { originGuard } from '../auth/middleware';

export const accessRouter = Router();

const codeSchema = z.object({
  code: z.string().min(1).max(200),
});

accessRouter.get('/status', (req, res) => {
  const required = getSetting<boolean>('access.require_login');
  res.json({
    required,
    authenticated: !required || verifyAccessCookie(req.cookies?.[ACCESS_COOKIE]),
  });
});

accessRouter.post(
  '/login',
  accessCodeLimiter,
  originGuard,
  asyncHandler(async (req, res) => {
    const required = getSetting<boolean>('access.require_login');
    if (!required) {
      res.json({ ok: true, required: false });
      return;
    }
    const hash = getSetting<string>('access.code_hash');
    if (!hash) {
      throw new ApiError(503, 'ACCESS_CODE_NOT_CONFIGURED', '管理员尚未配置访问码');
    }
    const { code } = parseBody(codeSchema, req.body);
    const ok = await verifyPassword(code, hash);
    if (!ok) {
      audit(req, { action: 'access.login_failed', actor: 'visitor', detail: { reason: 'bad_code' } });
      throw unauthorized('访问码不正确');
    }
    issueAccessCookie(req, res);
    audit(req, { action: 'access.login_success', actor: 'visitor' });
    res.json({ ok: true, required: true });
  }),
);

accessRouter.post('/logout', originGuard, (req, res) => {
  clearAccessCookie(req, res);
  res.json({ ok: true });
});
