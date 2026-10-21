import fs from 'node:fs';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import yauzl from 'yauzl';
import { ApiError } from '../http/errors';

const MAX_ENTRIES = 20000;
const MAX_JSON_BYTES = 5 * 1024 * 1024;
const MAX_ICON_BYTES = 2 * 1024 * 1024;

const EXTENSION_ID_PATTERN = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9._-]*$/;

export interface VsixMetadata {
  extensionId: string;
  publisher: string;
  name: string;
  version: string;
  displayName: string;
  description: string;
  engineRange?: string;
  categories: string[];
  keywords: string[];
  dependencies: string[];
  extensionPack: string[];
  license?: string;
  repositoryUrl?: string;
  homepage?: string;
}

export interface VsixIcon {
  filename: string;
  data: Buffer;
}

export interface ParsedVsix {
  metadata: VsixMetadata;
  icon?: VsixIcon;
}

interface RawManifest {
  Id?: string;
  Version?: string;
  Publisher?: string;
  DisplayName?: string;
  Description?: string;
  Dependencies?: string[];
}

function isSafeEntryName(name: string): boolean {
  if (!name || name.startsWith('/') || name.startsWith('\\')) return false;
  if (name.includes('\0')) return false;
  const normalized = path.posix.normalize(name);
  if (normalized.startsWith('..') || normalized.includes('/../')) return false;
  return true;
}

function openZip(filePath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      filePath,
      { lazyEntries: true, autoClose: false, decodeStrings: true, validateEntrySizes: true },
      (error, zip) => {
        if (error || !zip) {
          reject(new ApiError(400, 'INVALID_VSIX', `无法读取 vsix 压缩包：${error?.message ?? '未知错误'}`));
          return;
        }
        resolve(zip);
      },
    );
  });
}

function readEntry(zip: yauzl.ZipFile, entry: yauzl.Entry, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (entry.uncompressedSize > maxBytes) {
      reject(new ApiError(400, 'INVALID_VSIX', `vsix 条目 ${entry.fileName} 解压后过大`));
      return;
    }
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(new ApiError(400, 'INVALID_VSIX', '无法读取 vsix 条目'));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      let settled = false;
      stream.on('data', (chunk: Buffer) => {
        if (settled) return;
        size += chunk.length;
        if (size > maxBytes) {
          settled = true;
          stream.destroy();
          reject(new ApiError(400, 'INVALID_VSIX', `vsix 条目 ${entry.fileName} 超过大小上限`));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('end', () => {
        if (settled) return;
        settled = true;
        resolve(Buffer.concat(chunks));
      });
      stream.on('error', (streamError) => {
        if (settled) return;
        settled = true;
        reject(streamError);
      });
    });
  });
}

async function collectEntries(
  zip: yauzl.ZipFile,
  wanted: Set<string>,
  maxBytesByName: Map<string, number>,
): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    const result = new Map<string, Buffer>();
    let count = 0;
    let settled = false;
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      zip.close();
      reject(error);
    };
    zip.on('error', fail);
    zip.on('entry', (entry: yauzl.Entry) => {
      if (settled) return;
      count += 1;
      if (count > MAX_ENTRIES) {
        fail(new ApiError(400, 'INVALID_VSIX', 'vsix 条目数量异常'));
        return;
      }
      if (!isSafeEntryName(entry.fileName) || !wanted.has(entry.fileName)) {
        zip.readEntry();
        return;
      }
      const limit = maxBytesByName.get(entry.fileName) ?? MAX_JSON_BYTES;
      readEntry(zip, entry, limit)
        .then((buffer) => {
          if (settled) return;
          result.set(entry.fileName, buffer);
          zip.readEntry();
        })
        .catch(fail);
    });
    zip.on('end', () => {
      if (settled) return;
      settled = true;
      zip.close();
      resolve(result);
    });
    zip.readEntry();
  });
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function parseManifest(buffer: Buffer | undefined): RawManifest {
  if (!buffer) return {};
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      trimValues: true,
    });
    const parsed = parser.parse(buffer.toString('utf8')) as Record<string, unknown>;
    const manifest = parsed.PackageManifest as Record<string, unknown> | undefined;
    const metadata = manifest?.Metadata as Record<string, unknown> | undefined;
    const identity = (metadata?.Identity ?? {}) as Record<string, unknown>;
    const installation = manifest?.Installation as Record<string, unknown> | undefined;
    const dependenciesNode = installation?.Dependencies as Record<string, unknown> | undefined;
    const dependencies = asArray(dependenciesNode?.Dependency as unknown)
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>;
          return typeof record['@_Id'] === 'string' ? record['@_Id'] : '';
        }
        return '';
      })
      .filter(Boolean);
    return {
      Id: typeof identity['@_Id'] === 'string' ? identity['@_Id'] : undefined,
      Publisher: typeof identity['@_Publisher'] === 'string' ? identity['@_Publisher'] : undefined,
      Version: typeof identity['@_Version'] === 'string' ? identity['@_Version'] : undefined,
      DisplayName:
        typeof metadata?.DisplayName === 'string' ? metadata.DisplayName : undefined,
      Description:
        typeof metadata?.Description === 'string' ? metadata.Description : undefined,
      Dependencies: dependencies,
    };
  } catch {
    return {};
  }
}

function detectImageType(buffer: Buffer): string | null {
  if (buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.length > 6 && buffer.subarray(0, 6).toString('ascii') === 'GIF89a') return 'gif';
  if (buffer.length > 6 && buffer.subarray(0, 6).toString('ascii') === 'GIF87a') return 'gif';
  if (
    buffer.length > 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

function sanitizeText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maxLength);
}

function normalizeStringList(value: unknown, maxItems: number, maxLength = 80): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => sanitizeText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

/**
 * 只读取需要的 zip 条目，不整体解压，避免 zip 炸弹与 zip-slip。
 */
export async function parseVsix(filePath: string): Promise<ParsedVsix> {
  const stat = await fs.promises.stat(filePath);
  if (stat.size === 0 || stat.size > 4 * 1024 * 1024 * 1024) {
    throw new ApiError(400, 'INVALID_VSIX', 'vsix 文件大小异常');
  }
  const handle = await fs.promises.open(filePath, 'r');
  const header = Buffer.alloc(4);
  await handle.read(header, 0, 4, 0);
  await handle.close();
  if (header[0] !== 0x50 || header[1] !== 0x4b) {
    throw new ApiError(400, 'INVALID_VSIX', '文件不是有效的 vsix（zip）格式');
  }

  const zip = await openZip(filePath);
  const wanted = new Set(['extension.vsixmanifest', 'extension/package.json']);
  const entries = await collectEntries(zip, wanted, new Map());
  const manifestBuffer = entries.get('extension.vsixmanifest');
  const packageBuffer = entries.get('extension/package.json');
  if (!manifestBuffer && !packageBuffer) {
    throw new ApiError(400, 'INVALID_VSIX', 'vsix 缺少 extension/package.json 与 extension.vsixmanifest');
  }

  let pkg: Record<string, unknown> = {};
  if (packageBuffer) {
    try {
      pkg = JSON.parse(packageBuffer.toString('utf8')) as Record<string, unknown>;
    } catch {
      throw new ApiError(400, 'INVALID_VSIX', 'package.json 不是合法 JSON');
    }
  }
  const manifest = parseManifest(manifestBuffer);
  const manifestId = manifest.Id ?? '';
  const manifestSplit = manifestId.includes('.')
    ? [manifestId.slice(0, manifestId.indexOf('.')), manifestId.slice(manifestId.indexOf('.') + 1)]
    : ['', ''];

  const publisher = (
    sanitizeText(pkg.publisher, 100) ||
    sanitizeText(manifest.Publisher, 100) ||
    manifestSplit[0]
  ).toLowerCase();
  const name = (sanitizeText(pkg.name, 100) || manifestSplit[1]).toLowerCase();
  const version = sanitizeText(pkg.version, 64) || sanitizeText(manifest.Version, 64);
  if (!publisher || !name || !version) {
    throw new ApiError(400, 'INVALID_VSIX', 'vsix 缺少 publisher / name / version');
  }
  const extensionId = `${publisher}.${name}`;
  if (!EXTENSION_ID_PATTERN.test(extensionId)) {
    throw new ApiError(400, 'INVALID_VSIX', `插件标识不合法：${extensionId}`);
  }
  const dependencyIds = [
    ...normalizeStringList(pkg.extensionDependencies, 100),
    ...(manifest.Dependencies ?? []),
  ].filter((id) => EXTENSION_ID_PATTERN.test(id) && id.toLowerCase() !== extensionId);

  const engines = (pkg.engines ?? {}) as Record<string, unknown>;
  const repository = pkg.repository;
  const repositoryUrl =
    typeof repository === 'string'
      ? sanitizeText(repository, 300)
      : repository && typeof repository === 'object'
        ? sanitizeText((repository as Record<string, unknown>).url, 300)
        : undefined;

  const metadata: VsixMetadata = {
    extensionId,
    publisher,
    name,
    version,
    displayName:
      sanitizeText(pkg.displayName, 200) ||
      sanitizeText(manifest.DisplayName, 200) ||
      name,
    description:
      sanitizeText(pkg.description, 4000) || sanitizeText(manifest.Description, 4000),
    engineRange: sanitizeText(engines.vscode, 80) || undefined,
    categories: (() => {
      const categories = normalizeStringList(pkg.categories, 10, 60);
      return categories.length ? categories : ['Other'];
    })(),
    keywords: normalizeStringList(pkg.keywords, 30, 40),
    dependencies: [...new Set(dependencyIds)].slice(0, 100),
    extensionPack: normalizeStringList(pkg.extensionPack, 100).filter((id) =>
      EXTENSION_ID_PATTERN.test(id),
    ),
    license: sanitizeText(pkg.license, 120) || undefined,
    repositoryUrl,
    homepage: sanitizeText(pkg.homepage, 300) || undefined,
  };

  let icon: VsixIcon | undefined;
  const iconPath = sanitizeText(pkg.icon, 300);
  if (iconPath) {
    const normalized = path.posix.normalize(iconPath).replace(/^\.\//, '');
    const entryName = `extension/${normalized}`;
    if (!normalized.startsWith('..') && !normalized.startsWith('/') && isSafeEntryName(entryName)) {
      try {
        const iconZip = await openZip(filePath);
        const iconEntries = await collectEntries(
          iconZip,
          new Set([entryName]),
          new Map([[entryName, MAX_ICON_BYTES]]),
        );
        const data = iconEntries.get(entryName);
        if (data) {
          const type = detectImageType(data);
          if (type) icon = { filename: `icon.${type}`, data };
        }
      } catch {
        // 图标不是必需项，读取失败时忽略
      }
    }
  }

  return { metadata, icon };
}
