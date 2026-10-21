import dns from 'node:dns';
import net from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import { config } from '../config';
import { isHostAllowlisted, isPrivateHostname, isPublicAddress, normalizeHost } from './ipGuard';

type FetchInit = NonNullable<Parameters<typeof undiciFetch>[1]>;
type FetchResponse = Awaited<ReturnType<typeof undiciFetch>>;
type FetchRequestBody = FetchInit['body'];

export type FetchErrorCode =
  | 'SCHEME'
  | 'CREDENTIALS'
  | 'HOST'
  | 'PORT'
  | 'BLOCKED_ADDRESS'
  | 'DNS'
  | 'REDIRECT'
  | 'REDIRECT_LIMIT'
  | 'HTTP_STATUS'
  | 'TOO_LARGE'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'INVALID_JSON';

export class FetchError extends Error {
  constructor(
    readonly code: FetchErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

function blockedAddressError(address: string): FetchError {
  return new FetchError(
    'BLOCKED_ADDRESS',
    `目标地址 ${address} 属于环回/私有/保留地址，已被 SSRF 防护拒绝`,
  );
}

/**
 * 在 DNS 解析阶段校验全部 A/AAAA，并把校验后的地址交给 socket 使用。
 * 这可以防止「先校验、后解析」之间的 DNS rebinding。
 */
const guardedLookup = ((
  hostname: string,
  options: { family?: number; all?: boolean },
  callback: (error: NodeJS.ErrnoException | null, address: unknown, family?: number) => void,
): void => {
  dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) {
      callback(error, '', 0);
      return;
    }
    if (!addresses.length) {
      callback(Object.assign(new Error(`DNS 未返回地址：${hostname}`), { code: 'ENOTFOUND' }), '', 0);
      return;
    }
    const allowPrivate = isHostAllowlisted(hostname, config.networkAllowedPrivateHosts);
    const family = options?.family;
    const filtered =
      family === 4 || family === 6
        ? addresses.filter((item) => item.family === family)
        : addresses;
    const usable = filtered.length > 0 ? filtered : addresses;
    if (!allowPrivate) {
      const blocked = usable.find((item) => !isPublicAddress(item.address));
      if (blocked) {
        callback(blockedAddressError(blocked.address) as unknown as NodeJS.ErrnoException, '', 0);
        return;
      }
    }
    if (options?.all) {
      callback(null, usable);
    } else {
      callback(null, usable[0].address, usable[0].family);
    }
  });
}) as never;

const guardedAgent = new Agent({
  connect: { timeout: 15_000, lookup: guardedLookup },
  keepAliveTimeout: 10_000,
  keepAliveMaxTimeout: 30_000,
  connections: 16,
});

export async function assertUrlAllowed(
  input: string | URL,
  allowlist: string[] = config.networkAllowedPrivateHosts,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input.toString());
  } catch {
    throw new FetchError('HOST', '无效的 URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FetchError('SCHEME', `仅允许 http/https，当前为 ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new FetchError('CREDENTIALS', 'URL 中不允许携带用户名或密码');
  }
  const host = normalizeHost(url.hostname);
  if (!host) throw new FetchError('HOST', '缺少目标主机');

  const allowPrivate = isHostAllowlisted(host, allowlist);
  if (!allowPrivate && isPrivateHostname(host)) {
    throw new FetchError('BLOCKED_ADDRESS', `拒绝访问本机/本地域名：${host}`);
  }

  const defaultPort = url.protocol === 'https:' ? 443 : 80;
  const port = url.port ? Number(url.port) : defaultPort;
  if (!allowPrivate && port !== 80 && port !== 443) {
    throw new FetchError('PORT', `公网目标仅允许 80/443 端口，当前为 ${port}`);
  }

  if (net.isIP(host)) {
    if (!allowPrivate && !isPublicAddress(host)) throw blockedAddressError(host);
    return url;
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await dns.promises.lookup(host, { all: true, verbatim: true });
  } catch (error) {
    throw new FetchError('DNS', `无法解析主机 ${host}：${(error as Error).message}`);
  }
  if (!addresses.length) throw new FetchError('DNS', `主机 ${host} 没有可用地址`);
  if (!allowPrivate) {
    const blocked = addresses.find((item) => !isPublicAddress(item.address));
    if (blocked) throw blockedAddressError(blocked.address);
  }
  return url;
}

function normalizeFetchError(error: unknown): FetchError {
  if (error instanceof FetchError) return error;
  const err = error as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
    return new FetchError('TIMEOUT', '上游请求超时');
  }
  const detail = err?.cause?.code || err?.cause?.message || err?.message || '未知网络错误';
  return new FetchError('NETWORK', `上游请求失败：${detail}`);
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxRedirects?: number;
  allowlist?: string[];
}

export interface SafeFetchResult {
  response: FetchResponse;
  finalUrl: URL;
}

/**
 * 带 SSRF 防护的 fetch：
 * - 仅 http/https，拒绝 URL 凭据
 * - 逐跳校验重定向目标
 * - 校验 DNS 解析结果，并在连接时绑定校验过的地址
 */
export async function safeFetchDetailed(
  input: string | URL,
  init: FetchInit = {},
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? config.requestTimeoutMs;
  const maxRedirects = options.maxRedirects ?? config.maxRedirects;
  const allowlist = options.allowlist ?? config.networkAllowedPrivateHosts;

  let current = new URL(input.toString());
  let method = String(init.method ?? 'GET').toUpperCase();
  let body: FetchRequestBody = init.body;
  const headers: Record<string, string> = {};
  if (init.headers && typeof init.headers === 'object' && !Array.isArray(init.headers)) {
    for (const [key, value] of Object.entries(init.headers as Record<string, string>)) {
      if (value !== undefined && value !== null) headers[key.toLowerCase()] = String(value);
    }
  }

  let signal = init.signal ?? undefined;
  if (timeoutMs > 0) {
    const timeout = AbortSignal.timeout(timeoutMs);
    signal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  }

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    await assertUrlAllowed(current, allowlist);
    let response: FetchResponse;
    try {
      response = await undiciFetch(current, {
        method,
        body,
        headers,
        redirect: 'manual',
        dispatcher: guardedAgent,
        signal,
      });
    } catch (error) {
      throw normalizeFetchError(error);
    }

    if (REDIRECT_STATUS.has(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => undefined);
      if (!location) {
        throw new FetchError('REDIRECT', `上游返回 ${response.status} 但没有 Location`);
      }
      if (
        (response.status === 301 || response.status === 302 || response.status === 303) &&
        method !== 'GET' &&
        method !== 'HEAD'
      ) {
        method = 'GET';
        body = undefined;
        delete headers['content-type'];
        delete headers['content-length'];
      }
      current = new URL(location, current);
      continue;
    }

    return { response, finalUrl: current };
  }

  throw new FetchError('REDIRECT_LIMIT', `重定向次数超过 ${maxRedirects} 次`);
}

export async function safeFetch(
  input: string | URL,
  init: FetchInit = {},
  options: SafeFetchOptions = {},
): Promise<FetchResponse> {
  return (await safeFetchDetailed(input, init, options)).response;
}

export async function readResponseText(
  response: FetchResponse,
  maxBytes = 5 * 1024 * 1024,
): Promise<string> {
  if (!response.body) return '';
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    const buffer = Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxBytes) {
      throw new FetchError('TOO_LARGE', `上游响应超过 ${maxBytes} 字节上限`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function safeFetchJson<T>(
  input: string | URL,
  init: FetchInit = {},
  options: SafeFetchOptions & { maxBytes?: number } = {},
): Promise<{ data: T; finalUrl: URL; status: number }> {
  const { response, finalUrl } = await safeFetchDetailed(input, init, options);
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new FetchError('HTTP_STATUS', `上游返回 HTTP ${response.status}`, response.status);
  }
  const text = await readResponseText(response, options.maxBytes ?? 5 * 1024 * 1024);
  try {
    return { data: JSON.parse(text) as T, finalUrl, status: response.status };
  } catch {
    throw new FetchError('INVALID_JSON', '上游响应不是合法 JSON');
  }
}

export const SOURCE_HEADERS = {
  'user-agent': config.userAgent,
  accept: 'application/json, text/plain, */*',
} as const;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
