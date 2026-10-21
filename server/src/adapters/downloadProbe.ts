import { FetchError, safeFetchDetailed, SOURCE_HEADERS } from '../net/safeFetch';

export interface ProbedBinary {
  finalUrl: URL;
  sizeBytes: number;
  contentType?: string;
  contentDisposition?: string;
}

function parseTotalSize(headers: Headers): number {
  const range = headers.get('content-range');
  if (range) {
    const match = range.match(/\/(\d+)$/);
    if (match) return Number(match[1]);
  }
  const length = headers.get('content-length');
  if (length) {
    const parsed = Number(length);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return 0;
}

/**
 * 解析下载地址：优先 HEAD，部分 CDN 不支持 HEAD 时回退到 Range: bytes=0-0。
 * 返回最终地址、大小与 CDN 响应头。
 */
export async function probeBinaryUrl(url: string): Promise<ProbedBinary> {
  let result = await safeFetchDetailed(
    url,
    { method: 'HEAD', headers: SOURCE_HEADERS },
    { timeoutMs: 30000 },
  );

  if (
    result.response.status === 405 ||
    result.response.status === 400 ||
    result.response.status === 403
  ) {
    await result.response.body?.cancel().catch(() => undefined);
    result = await safeFetchDetailed(
      url,
      { method: 'GET', headers: { ...SOURCE_HEADERS, range: 'bytes=0-0' } },
      { timeoutMs: 30000 },
    );
  }

  if (!result.response.ok) {
    const status = result.response.status;
    await result.response.body?.cancel().catch(() => undefined);
    if (status === 404) {
      throw new FetchError('HTTP_STATUS', '上游不存在该文件（HTTP 404）', status);
    }
    throw new FetchError('HTTP_STATUS', `上游返回 HTTP ${status}`, status);
  }

  const headers = result.response.headers;
  const sizeBytes = parseTotalSize(headers);
  const contentType = headers.get('content-type') ?? undefined;
  const contentDisposition = headers.get('content-disposition') ?? undefined;
  await result.response.body?.cancel().catch(() => undefined);
  return { finalUrl: result.finalUrl, sizeBytes, contentType, contentDisposition };
}

export function filenameFromUrl(url: URL): string {
  const raw = url.pathname.split('/').filter(Boolean).pop() ?? '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
