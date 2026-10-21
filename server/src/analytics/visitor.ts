import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { VISITOR_COOKIE, visitorCookieOptions } from '../http/cookies';
import { ensureCookieSecret } from '../services/settings';

const VISITOR_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

function signVisitor(id: string): string {
  return crypto
    .createHmac('sha256', ensureCookieSecret())
    .update(`visitor:${id}`)
    .digest('base64url');
}

function verifyVisitor(value: string): string | null {
  const separator = value.lastIndexOf('.');
  if (separator <= 0) return null;
  const id = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  if (!VISITOR_ID_PATTERN.test(id)) return null;
  const expected = signVisitor(id);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return id;
}

/** 下发匿名访客标识（HttpOnly、SameSite=Lax、1 年），仅用于 UV 与去重。 */
export function ensureVisitor(req: Request, res: Response, next: NextFunction): void {
  const raw = req.cookies?.[VISITOR_COOKIE];
  let visitorId: string | null = typeof raw === 'string' ? verifyVisitor(raw) : null;
  if (!visitorId) {
    visitorId = crypto.randomBytes(16).toString('base64url');
    res.cookie(VISITOR_COOKIE, `${visitorId}.${signVisitor(visitorId)}`, visitorCookieOptions(req));
  }
  req.visitorId = visitorId;
  next();
}

export function normalizeIp(value: string | undefined | null): string {
  let ip = (value ?? '').trim();
  if (ip.startsWith('::ffff:') && ip.includes('.')) ip = ip.slice(7);
  return ip.replace(/^\[|\]$/g, '').slice(0, 64);
}
