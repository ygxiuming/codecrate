import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import yauzl from 'yauzl';
import { ApiError } from '../http/errors';

export interface ServerArchiveInfo {
  version?: string;
  commit?: string;
  quality?: string;
  buildTime?: string;
}

const MAX_PRODUCT_BYTES = 1024 * 1024;
const MAX_SCAN_BYTES = 4 * 1024 * 1024 * 1024;

function parseProductJson(raw: Buffer): ServerArchiveInfo {
  const parsed = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
  const info: ServerArchiveInfo = {};
  if (typeof parsed.version === 'string' && parsed.version.trim()) {
    info.version = parsed.version.trim();
  }
  if (typeof parsed.commit === 'string' && /^[0-9a-f]{7,40}$/i.test(parsed.commit.trim())) {
    info.commit = parsed.commit.trim().toLowerCase();
  }
  if (typeof parsed.quality === 'string' && parsed.quality.trim()) {
    info.quality = parsed.quality.trim();
  }
  if (typeof parsed.date === 'string' && !Number.isNaN(Date.parse(parsed.date))) {
    info.buildTime = new Date(parsed.date).toISOString();
  }
  return info;
}

class ByteReader {
  private chunks: Buffer[] = [];
  private length = 0;
  private readonly iterator: AsyncIterator<Buffer>;

  constructor(stream: AsyncIterable<Buffer>) {
    this.iterator = stream[Symbol.asyncIterator]();
  }

  private async pull(): Promise<boolean> {
    const { value, done } = await this.iterator.next();
    if (done || !value) return false;
    this.chunks.push(value);
    this.length += value.length;
    return true;
  }

  async read(size: number): Promise<Buffer | null> {
    while (this.length < size) {
      if (!(await this.pull())) return null;
    }
    const parts: Buffer[] = [];
    let remaining = size;
    while (remaining > 0) {
      const first = this.chunks[0];
      if (!first) return null;
      if (first.length <= remaining) {
        parts.push(first);
        this.chunks.shift();
        this.length -= first.length;
        remaining -= first.length;
      } else {
        parts.push(first.subarray(0, remaining));
        this.chunks[0] = first.subarray(remaining);
        this.length -= remaining;
        remaining = 0;
      }
    }
    return Buffer.concat(parts);
  }

  async skip(size: number): Promise<boolean> {
    let remaining = size;
    while (remaining > 0) {
      if (this.length === 0 && !(await this.pull())) return false;
      const first = this.chunks[0];
      if (!first) return false;
      if (first.length <= remaining) {
        this.chunks.shift();
        this.length -= first.length;
        remaining -= first.length;
      } else {
        this.chunks[0] = first.subarray(remaining);
        this.length -= remaining;
        remaining = 0;
      }
    }
    return true;
  }
}

function readString(header: Buffer, offset: number, length: number): string {
  const slice = header.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString('utf8').trim();
}

function readOctal(header: Buffer, offset: number, length: number): number {
  const raw = readString(header, offset, length).replace(/[^0-7]/g, '');
  return raw ? Number.parseInt(raw, 8) : 0;
}

async function inspectTarGz(filePath: string): Promise<ServerArchiveInfo | null> {
  const source = fs.createReadStream(filePath);
  const gunzip = zlib.createGunzip();
  source.on('error', (error) => gunzip.destroy(error));
  source.pipe(gunzip);

  const reader = new ByteReader(gunzip as AsyncIterable<Buffer>);
  let scanned = 0;
  try {
    while (scanned < MAX_SCAN_BYTES) {
      const header = await reader.read(512);
      if (!header) break;
      if (header.every((byte) => byte === 0)) break;

      const name = readString(header, 0, 100);
      const prefix = readString(header, 345, 155);
      const fullName = prefix ? `${prefix}/${name}` : name;
      const size = readOctal(header, 124, 12);
      const type = String.fromCharCode(header[156] || 0);
      const padded = Math.ceil(size / 512) * 512;
      scanned += 512 + padded;

      if ((type === '0' || type === '\0') && path.posix.basename(fullName) === 'product.json') {
        if (size > MAX_PRODUCT_BYTES) return null;
        const data = await reader.read(size);
        if (!data) return null;
        try {
          const info = parseProductJson(data);
          // 先遇到嵌套的 product.json（缺少版本或 commit）时继续向后找顶层文件。
          if (info.version || info.commit) return info;
        } catch {
          // 跳过损坏的条目，继续扫描
        }
        const padding = padded - size;
        if (padding > 0 && !(await reader.skip(padding))) break;
        continue;
      }

      if (padded > 0 && !(await reader.skip(padded))) break;
    }
    return null;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'INVALID_ARCHIVE', '无法解析 server 压缩包，请确认文件完整且格式正确');
  } finally {
    source.destroy();
    gunzip.destroy();
  }
}

function inspectZip(filePath: string): Promise<ServerArchiveInfo | null> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: true }, (openError, zipfile) => {
      if (openError || !zipfile) {
        reject(
          new ApiError(400, 'INVALID_ARCHIVE', '无法解析 server 压缩包，请确认文件完整且格式正确'),
        );
        return;
      }
      let settled = false;
      const finish = (value: ServerArchiveInfo | null): void => {
        if (settled) return;
        settled = true;
        try {
          zipfile.close();
        } catch {
          // ignore close errors
        }
        resolve(value);
      };
      zipfile.on('error', () => finish(null));
      zipfile.on('end', () => finish(null));
      zipfile.on('entry', (entry) => {
        if (entry.fileName.endsWith('/') || path.posix.basename(entry.fileName) !== 'product.json') {
          zipfile.readEntry();
          return;
        }
        if (entry.uncompressedSize > MAX_PRODUCT_BYTES) {
          zipfile.readEntry();
          return;
        }
        zipfile.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            zipfile.readEntry();
            return;
          }
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('error', () => finish(null));
          stream.on('end', () => {
            let info: ServerArchiveInfo | null = null;
            try {
              info = parseProductJson(Buffer.concat(chunks));
            } catch {
              info = null;
            }
            // 嵌套条目可能缺少版本或 commit，继续查找下一个 product.json。
            if (info && (info.version || info.commit)) finish(info);
            else zipfile.readEntry();
          });
        });
      });
      zipfile.readEntry();
    });
  });
}

function detectKind(filePath: string): 'gzip' | 'zip' | null {
  const fd = fs.openSync(filePath, 'r');
  try {
    const head = Buffer.alloc(4);
    fs.readSync(fd, head, 0, 4, 0);
    if (head[0] === 0x1f && head[1] === 0x8b) return 'gzip';
    if (head[0] === 0x50 && head[1] === 0x4b) return 'zip';
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * 只读取 server 包内的 product.json，不落盘解压，避免占用与 zip 炸弹风险。
 * 返回 null 表示压缩包有效但没有可识别的 product.json。
 */
export async function inspectServerArchive(
  filePath: string,
): Promise<ServerArchiveInfo | null> {
  const kind = detectKind(filePath);
  if (kind === 'gzip') return inspectTarGz(filePath);
  if (kind === 'zip') return inspectZip(filePath);
  throw new ApiError(400, 'INVALID_ARCHIVE', '只支持 .tar.gz、.tgz 或 .zip 格式的 server 包');
}

export function inferPlatformFromFilename(filename: string): string | undefined {
  const base = path.basename(filename.replace(/\\/g, '/'));
  const match = base.match(/^vscode-server-(.+)\.(?:tar\.gz|tgz|zip)$/i);
  return match ? match[1] : undefined;
}
