import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';
import { getSetting } from '../services/settings';

function limitHandler(_req: Request, res: Response): void {
  res.status(429).json({
    error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' },
  });
}

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: limitHandler,
});

export const accessCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: limitHandler,
});

export const eventLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: limitHandler,
});

// 业务限流器在测试环境跳过：集成测试会从同一 IP 连续上传/发言，避免与功能断言互相干扰。
const skipInTest = (): boolean => process.env.NODE_ENV === 'test';

/** 阈值存 settings，管理员可改；配置为 0 表示关闭该限流。 */
function dynamicSkip(key: string) {
  return (_req: Request, _res: Response): boolean =>
    skipInTest() || (Number(getSetting<number>(key)) || 0) <= 0;
}

function dynamicLimit(key: string, fallback: number) {
  return (_req: Request, _res: Response): number => {
    const configured = Number(getSetting<number>(key));
    return Number.isFinite(configured) && configured > 0 ? configured : fallback;
  };
}

export const commentLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: dynamicLimit('limits.comment_per_min', 10),
  skip: dynamicSkip('limits.comment_per_min'),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: limitHandler,
});

export const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: dynamicLimit('limits.upload_per_10min', 10),
  skip: dynamicSkip('limits.upload_per_10min'),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: limitHandler,
});

export const shareRedeemLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: dynamicLimit('limits.redeem_per_15min', 20),
  skip: dynamicSkip('limits.redeem_per_15min'),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: limitHandler,
});
