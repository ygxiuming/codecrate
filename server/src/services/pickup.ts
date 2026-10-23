import crypto from 'node:crypto';
import { ensureCookieSecret } from './settings';

/** 无歧义字符集：不含 0/O/1/I/L，方便口头转述。 */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export const PICKUP_CODE_LENGTH = 8;
export const SHARE_TOKEN_TTL_MS = 15 * 60 * 1000;

export function generatePickupCode(length = PICKUP_CODE_LENGTH): string {
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let index = 0; index < length; index += 1) {
    code += CODE_ALPHABET[bytes[index] % CODE_ALPHABET.length];
  }
  return code;
}

/** 自定义取件码只允许字母数字，便于输入与展示。 */
export function normalizePickupCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidCustomCode(code: string): boolean {
  return /^[A-Z0-9]{4,16}$/.test(code);
}

export function signShareToken(shareId: number, expiresAt: number): string {
  const secret = ensureCookieSecret();
  return crypto
    .createHmac('sha256', secret)
    .update(`share:${shareId}:${expiresAt}`)
    .digest('base64url');
}

/**
 * 取件码确定性 HMAC：仅用于唯一性索引与查找（密钥在服务端，不可离线穷举）；
 * 校验仍走 scrypt 的 code_hash，避免 HMAC 泄露后码可被离线爆破。
 */
export function hmacPickupCode(code: string): string {
  return crypto
    .createHmac('sha256', ensureCookieSecret())
    .update(`share-code:${normalizePickupCode(code)}`)
    .digest('hex');
}

export function issueShareToken(shareId: number): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + SHARE_TOKEN_TTL_MS;
  return { token: `${expiresAt}.${signShareToken(shareId, expiresAt)}`, expiresAt };
}

export function verifyShareToken(shareId: number, value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const separator = value.lastIndexOf('.');
  if (separator <= 0) return false;
  const expiresAt = Number(value.slice(0, separator));
  const signature = value.slice(separator + 1);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  const expected = signShareToken(shareId, expiresAt);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
