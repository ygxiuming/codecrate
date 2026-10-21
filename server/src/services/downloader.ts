import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough, Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';
import { config } from '../config';
import { FetchError, safeFetchDetailed, SOURCE_HEADERS } from '../net/safeFetch';
import { removeIfExists } from '../storage/paths';

export type DownloadErrorCode =
  | 'HTTP_STATUS'
  | 'RANGE_MISMATCH'
  | 'SIZE_MISMATCH'
  | 'HASH_MISMATCH'
  | 'SIZE_LIMIT'
  | 'DISK_FULL'
  | 'TIMEOUT'
  | 'CANCELED'
  | 'IO';

export class DownloadError extends Error {
  constructor(
    readonly code: DownloadErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'DownloadError';
  }
}

export interface DownloadOptions {
  url: string;
  destPath: string;
  expectedSha256?: string;
  expectedSize?: number;
  maxBytes?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  onProgress?: (downloadedBytes: number, totalBytes: number) => void;
}

export interface DownloadResult {
  sha256: string;
  size: number;
  resumed: boolean;
}

const IDLE_TIMEOUT_MS = 90_000;
const MAX_DEFAULT_BYTES = 8 * 1024 * 1024 * 1024;

async function hashExisting(filePath: string, hash: crypto.Hash): Promise<number> {
  let size = 0;
  for await (const chunk of fs.createReadStream(filePath)) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    hash.update(buffer);
  }
  return size;
}

function parseRangeStart(header: string | null): number | null {
  if (!header) return null;
  const match = header.match(/^bytes\s+(\d+)-/i);
  return match ? Number(match[1]) : null;
}

function parseTotalFromRange(header: string | null): number {
  if (!header) return 0;
  const match = header.match(/\/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

async function ensureDiskSpace(directory: string, neededBytes: number): Promise<void> {
  if (neededBytes <= 0) return;
  try {
    const stats = await fs.promises.statfs(directory);
    const free = Number(stats.bavail) * Number(stats.bsize);
    if (free < neededBytes + 32 * 1024 * 1024) {
      throw new DownloadError(
        'DISK_FULL',
        `磁盘空间不足：需要约 ${Math.ceil(neededBytes / 1024 / 1024)} MB，剩余 ${Math.floor(free / 1024 / 1024)} MB`,
        false,
      );
    }
  } catch (error) {
    if (error instanceof DownloadError) throw error;
  }
}

/**
 * 流式下载：.part 分片 + Range 续传 + 增量 SHA256 + 空闲超时。
 * 自动识别 gzip 编码的 marketplace vsix 并解压后再落盘。
 */
export async function downloadFile(
  options: DownloadOptions,
  internal: { noResume?: boolean } = {},
): Promise<DownloadResult> {
  const { destPath } = options;
  const partPath = `${destPath}.part`;
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });

  const existingSize = internal.noResume
    ? 0
    : await fs.promises
        .stat(partPath)
        .then((stat) => stat.size)
        .catch(() => 0);
  const start = existingSize;

  const hash = crypto.createHash('sha256');
  if (start > 0) await hashExisting(partPath, hash);

  const controller = new AbortController();
  let timedOut = false;
  let idleTimer: NodeJS.Timeout | null = null;
  const resetIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, IDLE_TIMEOUT_MS);
  };
  const onCallerAbort = (): void => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', onCallerAbort, { once: true });
  }
  resetIdle();

  const cleanup = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    options.signal?.removeEventListener('abort', onCallerAbort);
  };

  let writeStream: fs.WriteStream | null = null;
  try {
    const headers: Record<string, string> = {
      ...SOURCE_HEADERS,
      'accept-encoding': 'identity',
      ...options.headers,
    };
    if (start > 0) headers.range = `bytes=${start}-`;

    const { response } = await safeFetchDetailed(
      options.url,
      { method: 'GET', headers, signal: controller.signal },
      { timeoutMs: 0 },
    );

    if (response.status === 416) {
      await response.body?.cancel().catch(() => undefined);
      const total = parseTotalFromRange(response.headers.get('content-range'));
      if (start > 0 && total > 0 && start === total) {
        const sha256 = hash.copy().digest('hex');
        await removeIfExists(destPath);
        await fs.promises.rename(partPath, destPath);
        return { sha256, size: start, resumed: true };
      }
      await removeIfExists(partPath);
      throw new DownloadError('RANGE_MISMATCH', '续传位置失效，已重置下载', true);
    }

    if (response.status !== 200 && response.status !== 206) {
      await response.body?.cancel().catch(() => undefined);
      const retryable = response.status >= 500;
      throw new DownloadError(
        'HTTP_STATUS',
        `下载失败：上游返回 HTTP ${response.status}`,
        retryable,
      );
    }

    let effectiveStart = start;
    if (response.status === 200 && start > 0) {
      // 服务端忽略了 Range，从头开始
      effectiveStart = 0;
      await fs.promises.truncate(partPath, 0).catch(() => undefined);
      hash.destroy();
    }
    let activeHash = hash;
    if (effectiveStart === 0 && start > 0) {
      activeHash = crypto.createHash('sha256');
    }
    if (response.status === 206) {
      const rangeStart = parseRangeStart(response.headers.get('content-range'));
      if (rangeStart !== null && rangeStart !== effectiveStart) {
        await response.body?.cancel().catch(() => undefined);
        await removeIfExists(partPath);
        throw new DownloadError('RANGE_MISMATCH', '服务端返回的续传区间不匹配，已重置', true);
      }
    }

    if (!response.body) {
      throw new DownloadError('IO', '上游响应没有可读内容', true);
    }

    const reader = (response.body as unknown as ReadableStream<Uint8Array>).getReader();
    const firstRead = await reader.read();
    const firstChunk =
      !firstRead.done && firstRead.value ? Buffer.from(firstRead.value) : null;
    // undici 可能已按 Content-Encoding 自动解压，因此只依据魔数决定是否再解压。
    const magicGzip = Boolean(firstChunk && firstChunk[0] === 0x1f && firstChunk[1] === 0x8b);
    const isGzip = magicGzip;
    const encoded = /gzip|deflate|br/i.test(response.headers.get('content-encoding') ?? '');
    const sizeIsKnown = !encoded && !isGzip;

    if ((encoded || isGzip) && effectiveStart > 0) {
      await reader.cancel().catch(() => undefined);
      await removeIfExists(partPath);
      cleanup();
      return downloadFile(options, { noResume: true });
    }

    const totalFromRange = parseTotalFromRange(response.headers.get('content-range'));
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    const totalBytes =
      response.status === 206 && totalFromRange > 0 ? totalFromRange : contentLength;
    if (encoded || isGzip) await ensureDiskSpace(path.dirname(destPath), 0);
    else await ensureDiskSpace(path.dirname(destPath), Math.max(totalBytes, 0));

    const source = Readable.from(
      (async function* generate(): AsyncGenerator<Buffer> {
        if (firstChunk) yield firstChunk;
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          if (chunk.value) yield Buffer.from(chunk.value);
        }
      })(),
    );

    let written = 0;
    let lastReport = 0;
    const maxBytes = options.maxBytes ?? MAX_DEFAULT_BYTES;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        try {
          resetIdle();
          written += chunk.length;
          if (written > maxBytes) {
            callback(new DownloadError('SIZE_LIMIT', '下载内容超过允许的最大体积', false));
            return;
          }
          activeHash.update(chunk);
          const now = Date.now();
          if (now - lastReport > 400) {
            lastReport = now;
            options.onProgress?.(effectiveStart + written, totalBytes);
          }
          callback(null, chunk);
        } catch (error) {
          callback(error as Error);
        }
      },
    });

    const decompressor = isGzip ? zlib.createGunzip() : new PassThrough();
    if (isGzip) {
      source.on('error', (error) => decompressor.destroy(error));
    }

    writeStream = fs.createWriteStream(partPath, {
      flags: effectiveStart > 0 ? 'a' : 'w',
    });
    await pipeline(source, decompressor, meter, writeStream);
    writeStream = null;

    options.onProgress?.(effectiveStart + written, totalBytes || effectiveStart + written);

    const downloaded = effectiveStart + written;
    if (sizeIsKnown && totalBytes > 0 && downloaded !== totalBytes) {
      throw new DownloadError(
        'SIZE_MISMATCH',
        `下载不完整：期望 ${totalBytes} 字节，实际 ${downloaded} 字节`,
        true,
      );
    }
    if (options.expectedSize && sizeIsKnown && downloaded !== options.expectedSize) {
      throw new DownloadError(
        'SIZE_MISMATCH',
        `文件大小与预期不符：期望 ${options.expectedSize} 字节，实际 ${downloaded} 字节`,
        true,
      );
    }

    const sha256 = activeHash.digest('hex');
    if (options.expectedSha256 && sha256 !== options.expectedSha256.toLowerCase()) {
      await removeIfExists(partPath);
      throw new DownloadError('HASH_MISMATCH', 'SHA256 校验失败，文件可能损坏或不完整', true);
    }

    const handle = await fs.promises.open(partPath, 'r+');
    await handle.sync();
    await handle.close();
    await removeIfExists(destPath);
    await fs.promises.rename(partPath, destPath);
    return { sha256, size: downloaded, resumed: effectiveStart > 0 };
  } catch (error) {
    if (error instanceof DownloadError) throw error;
    if (timedOut) {
      throw new DownloadError('TIMEOUT', '下载空闲超时，可重试续传', true);
    }
    if (controller.signal.aborted) {
      throw new DownloadError('CANCELED', '下载已取消', false);
    }
    if (error instanceof FetchError) {
      const retryable = error.code === 'NETWORK' || error.code === 'TIMEOUT';
      throw new DownloadError('HTTP_STATUS', error.message, retryable);
    }
    const err = error as NodeJS.ErrnoException;
    throw new DownloadError('IO', `写入失败：${err.message ?? '未知错误'}`, true);
  } finally {
    cleanup();
    if (writeStream) writeStream.destroy();
  }
}

export function downloadTaskConcurrencyHint(): number {
  return config.cacheConcurrency;
}
