import type { CookieOptions, Request } from 'express';
import { config } from '../config';

export const ADMIN_COOKIE = 'vr_admin';
export const ACCESS_COOKIE = 'vr_access';
export const VISITOR_COOKIE = 'vr_vid';

export function usesSecureCookie(req: Request): boolean {
  if (config.cookieSecure === 'always') return true;
  if (config.cookieSecure === 'never') return false;
  return req.secure || req.get('x-forwarded-proto') === 'https';
}

export function baseCookieOptions(req: Request, maxAgeMs?: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: usesSecureCookie(req),
    path: '/',
    ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
  };
}

export function adminCookieOptions(req: Request): CookieOptions {
  return baseCookieOptions(req, config.sessionHours * 60 * 60 * 1000);
}

export function visitorCookieOptions(req: Request): CookieOptions {
  return baseCookieOptions(req, 365 * 24 * 60 * 60 * 1000);
}
