/** 软件包平台下拉固定选项（内网常见目标平台）。 */
export const SOFTWARE_PLATFORM_OPTIONS = [
  'Windows x64',
  'Windows x86',
  'Windows arm64',
  'macOS Intel',
  'macOS Apple Silicon',
  'Linux x64',
  'Linux arm64',
  'Android',
  '通用（跨平台）',
];

/** 平台词剥离清单：用于从文件名中清除系统/架构/安装器噪声。 */
const PLATFORM_TOKEN_PATTERN =
  /(win32-x64|windows-x64|win-x64|win32|windows|win|macos|osx|darwin|mac|linux|ubuntu|debian|centos|x86_64|amd64|x64|x86|ia32|arm64|aarch64|universal|setup|installer|install|offline|stable|release|bin|full)/gi;

const ARCH_64 = /x64|x86_64|amd64/i;
const ARCH_ARM64 = /arm64|aarch64/i;

const VERSION_LOOKBEHIND = /(?:^|[^0-9])v?(\d{1,4}(?:\.\d{1,4}){1,3})(?=$|[^0-9.])/i;

function detectPlatform(stem: string, filename: string): string {
  const haystack = `${stem} ${filename}`.toLowerCase();
  const lowerFilename = filename.toLowerCase();
  if (/(^|[^a-z])universal([^a-z]|$)/.test(haystack)) return '通用（跨平台）';
  if (/\.apk$/.test(lowerFilename)) return 'Android';

  let os: 'windows' | 'macos' | 'linux' | null = null;
  if (/\.msi$|\.exe$/.test(lowerFilename) || /(^|[^a-z])(win|windows)([^a-z]|$)/.test(haystack)) {
    os = 'windows';
  } else if (/\.dmg$|\.pkg$/.test(lowerFilename) || /(^|[^a-z])(mac|macos|osx|darwin)([^a-z]|$)/.test(haystack)) {
    os = 'macos';
  } else if (/\.deb$|\.rpm$|\.appimage$|\.tgz$|\.tar\.gz$/.test(lowerFilename) || /(^|[^a-z])(linux|ubuntu|debian)([^a-z]|$)/.test(haystack)) {
    os = 'linux';
  }

  if (!os) return '';

  if (ARCH_ARM64.test(haystack)) {
    if (os === 'windows') return 'Windows arm64';
    if (os === 'macos') return 'macOS Apple Silicon';
    return 'Linux arm64';
  }
  if (ARCH_64.test(haystack)) {
    if (os === 'windows') return 'Windows x64';
    if (os === 'macos') return 'macOS Intel';
    return 'Linux x64';
  }
  if (/x86|ia32/.test(haystack)) {
    if (os === 'windows') return 'Windows x86';
    return '';
  }
  // 仅能识别系统时按最常见的位宽兜底
  if (os === 'windows') return 'Windows x64';
  if (os === 'macos') return 'macOS Intel';
  return 'Linux x64';
}

/** 去掉扩展名（含 tar.gz 这类双扩展名）。 */
function fileStem(filename: string): string {
  const lower = filename.toLowerCase();
  for (const extension of ['.tar.gz', '.tar.bz2', '.tar.xz']) {
    if (lower.endsWith(extension)) return filename.slice(0, -extension.length);
  }
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) : filename;
}

function blankMatch(source: string, pattern: RegExp): string {
  return source.replace(pattern, (found) => ' '.repeat(found.length));
}

export interface DetectedSoftwareMeta {
  name: string;
  version: string;
  platform: string;
}

/**
 * 从安装包文件名自动识别软件名称、版本与平台：
 * - 平台：按系统关键词 + 扩展名 + 架构关键词映射到固定下拉项；
 * - 版本：剥离平台词后，取首个 1~4 段的点分版本号（容忍 v 前缀）；
 * - 名称：去掉版本与平台/安装器噪声后的剩余片段。
 */
export function detectSoftwareMeta(filename: string): DetectedSoftwareMeta {
  const stem = fileStem(filename);
  const platform = detectPlatform(stem, filename);

  // 先剥离平台与安装器噪声，避免 x64 等词黏在版本号后影响识别
  const cleaned = blankMatch(stem, PLATFORM_TOKEN_PATTERN)
    .replace(/^[.\-_ v]+|[.\-_ v]+$/g, '');

  const versionMatch = cleaned.match(VERSION_LOOKBEHIND);
  const version = versionMatch?.[1] ?? '';

  const nameSource = versionMatch
    ? blankMatch(cleaned, VERSION_LOOKBEHIND)
    : cleaned;

  const name = nameSource
    .split(/[.\-_+ ()[\]]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !/^\d+$/.test(token))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    name: name || stem,
    version,
    platform,
  };
}
