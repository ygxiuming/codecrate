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

/* ---------------- 多级分类与标签 ---------------- */

/** 拆分「a/b/c」形式的分类路径，忽略空段。 */
export function splitCategoryPath(category: string): string[] {
  return category
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function categoryLastName(category: string): string {
  const parts = splitCategoryPath(category);
  return parts[parts.length - 1] ?? category;
}

export function categoryParentPath(category: string): string {
  const parts = splitCategoryPath(category);
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
}

export interface CategoryNode {
  /** 完整路径，作为筛选值使用。 */
  path: string;
  name: string;
  /** 自身（叶子层）软件包数。 */
  count: number;
  /** 含全部子分类的软件包总数。 */
  total: number;
  children: CategoryNode[];
}

/** 由扁平分类统计构建两级/三级分类树，节点按名称排序。 */
export function buildCategoryTree(items: Array<{ category: string; count: number }>): CategoryNode[] {
  const roots: CategoryNode[] = [];
  const byPath = new Map<string, CategoryNode>();
  for (const item of items) {
    const parts = splitCategoryPath(item.category);
    if (!parts.length) continue;
    let parentList = roots;
    let prefix = '';
    let leaf: CategoryNode | null = null;
    for (const part of parts) {
      const path = prefix ? `${prefix}/${part}` : part;
      let node = byPath.get(path);
      if (!node) {
        node = { path, name: part, count: 0, total: 0, children: [] };
        byPath.set(path, node);
        parentList.push(node);
      }
      node.total += item.count;
      leaf = node;
      parentList = node.children;
      prefix = path;
    }
    if (leaf) leaf.count += item.count;
  }
  const sortNodes = (nodes: CategoryNode[]): CategoryNode[] => {
    nodes.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    for (const node of nodes) sortNodes(node.children);
    return nodes;
  };
  return sortNodes(roots);
}

/** 分类色板：按名称哈希取色，保证同一分类颜色稳定。 */
const CATEGORY_PALETTE = [
  'geekblue',
  'cyan',
  'gold',
  'purple',
  'green',
  'magenta',
  'orange',
  'blue',
] as const;

export function categoryColor(category: string): string {
  const name = categoryLastName(category);
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return CATEGORY_PALETTE[hash % CATEGORY_PALETTE.length];
}

/** 卡片图标块的渐变背景色（按分类名哈希）。 */
const ICON_GRADIENTS = [
  ['#5b8def', '#8fb5ff'],
  ['#13b8a6', '#7ce0d2'],
  ['#f0913a', '#ffc078'],
  ['#8f6ef2', '#c3aefc'],
  ['#e8618c', '#ffa8c5'],
  ['#2f9e6e', '#8fd9b6'],
  ['#5b6ee1', '#a3b2ff'],
  ['#d97706', '#fcd34d'],
];

export function categoryIconGradient(category: string): string {
  const name = categoryLastName(category);
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  const [from, to] = ICON_GRADIENTS[hash % ICON_GRADIENTS.length];
  return `linear-gradient(135deg, ${from}, ${to})`;
}

/** 名称首字（优先取首个中文字/字母）。 */
export function nameInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const first = Array.from(trimmed)[0] ?? '?';
  return first.toUpperCase();
}

/* ---------------- 平台识别 ---------------- */

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
