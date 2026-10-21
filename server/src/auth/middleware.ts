import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { logger } from '../logger';
import { ApiError, forbidden, unauthorized } from '../http/errors';
import { baseCookieOptions, ACCESS_COOKIE, ADMIN_COOKIE } from '../http/cookies';
import { ensureCookieSecret, getSetting } from '../services/settings';
import { resolveSession } from './sessions';
import { ADMIN_COOKIE as ADMIN_SESSION_COOKIE } from '../http/cookies';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: { id: number; username: string };
      visitorId?: string;
    }
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.[ADMIN_COOKIE];
  if (typeof token !== 'string' || !token) {
    next(unauthorized());
    return;
  }
  const admin = resolveSession(token);
  if (!admin) {
    res.clearCookie(ADMIN_COOKIE, baseCookieOptions(req));
    next(unauthorized('会话已过期，请重新登录'));
    return;
  }
  req.admin = admin;
  next();
}

function allowedHostnames(req: Request): Set<string> {
  const hosts = new Set<string>();
  const add = (value: string | null | undefined): void => {
    if (!value) return;
    const first = value.split(',')[0]?.trim();
    if (!first) return;
    try {
      const parsed = new URL(first.includes('://') ? first : `http://${first}`);
      const hostname = parsed.hostname.toLowerCase();
      if (hostname) hosts.add(hostname);
    } catch {
      // 忽略非法 Host
    }
  };

  add(req.get('host'));
  add(req.get('x-forwarded-host'));
  add(config.publicOrigin);
  for (const origin of config.allowedOrigins) add(origin);
  if (!config.isProduction) {
    add('localhost');
    add('127.0.0.1');
    add('::1');
    add('localhost:5173');
    add('127.0.0.1:5173');
  }
  // localhost / 127.0.0.1 / ::1 视为同一本机来源，兼容端口映射与开发代理
  if ([...hosts].some((host) => host === 'localhost' || host === '127.0.0.1' || host === '::1')) {
    hosts.add('localhost');
    hosts.add('127.0.0.1');
    hosts.add('::1');
  }
  return hosts;
}

function originAllowed(req: Request, urlLike: string): boolean {
  try {
    const parsed = new URL(urlLike);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return allowedHostnames(req).has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * 写操作的同源校验（防 CSRF）。SPA 会同时带 Origin 与 X-Requested-With；
 * 无 Origin 的命令行客户端必须显式带 X-Requested-With 头。
 */
export function originGuard(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  // 现代浏览器会发送 Sec-Fetch-Site；同源 XHR/fetch 为 same-origin。
  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite === 'same-origin' || fetchSite === 'none') {
    next();
    return;
  }

  const origin = req.get('origin');
  if (origin) {
    if (originAllowed(req, origin)) {
      next();
      return;
    }
    logger.warn(
      {
        origin,
        host: req.get('host'),
        forwardedHost: req.get('x-forwarded-host'),
        publicOrigin: config.publicOrigin || null,
      },
      '拒绝跨站写请求',
    );
    next(forbidden('跨站请求被拒绝'));
    return;
  }
  const referer = req.get('referer');
  if (referer) {
    if (originAllowed(req, referer)) {
      next();
      return;
    }
    logger.warn({ referer, host: req.get('host') }, '拒绝跨站写请求');
    next(forbidden('跨站请求被拒绝'));
    return;
  }
  if (req.get('x-requested-with') === 'XMLHttpRequest') {
    next();
    return;
  }
  next(forbidden('缺少同源校验信息'));
}

function accessSignature(expiresAt: number): string {
  const secret = ensureCookieSecret();
  return crypto.createHmac('sha256', secret).update(`access:${expiresAt}`).digest('base64url');
}

export function issueAccessCookie(req: Request, res: Response): void {
  const expiresAt = Date.now() + config.sessionHours * 60 * 60 * 1000;
  res.cookie(ACCESS_COOKIE, `${expiresAt}.${accessSignature(expiresAt)}`, baseCookieOptions(req));
}

export function clearAccessCookie(req: Request, res: Response): void {
  res.clearCookie(ACCESS_COOKIE, baseCookieOptions(req));
}

export function verifyAccessCookie(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const separator = value.lastIndexOf('.');
  if (separator <= 0) return false;
  const expiresAt = Number(value.slice(0, separator));
  const signature = value.slice(separator + 1);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  const expected = accessSignature(expiresAt);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** 当后台开启「下载需访问码」时保护前台读取与下载接口。 */
export function requireUserAccess(req: Request, res: Response, next: NextFunction): void {
  if (!getSetting<boolean>('access.require_login')) {
    next();
    return;
  }
  if (verifyAccessCookie(req.cookies?.[ACCESS_COOKIE])) {
    next();
    return;
  }
  const adminToken = req.cookies?.[ADMIN_SESSION_COOKIE];
  if (typeof adminToken === 'string' && resolveSession(adminToken)) {
    next();
    return;
  }
  next(new ApiError(401, 'ACCESS_REQUIRED', '请输入访问码后继续'));
}
