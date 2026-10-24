/**
 * 软件包分类与标签的规范化规则：
 * - 分类以「/」分隔的多级路径存储（最多 3 级，如「开发工具/IDE」），
 *   路径会拼进存储目录，因此每段必须是非空的安全段（拒绝 `.`/`..`）；
 * - 标签是自由文本数组，去重后最多 12 个，单个最长 24 字符。
 */

export const MAX_CATEGORY_DEPTH = 3;
const MAX_CATEGORY_LENGTH = 80;
const MAX_SEGMENT_LENGTH = 30;
export const MAX_TAGS = 12;
export const MAX_TAG_LENGTH = 24;

export function splitCategoryPath(category: string): string[] {
  return category
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
}

/** 规范化多级分类路径；全部为空时回退 fallback。 */
export function normalizeCategoryPath(input: string | undefined | null, fallback = '未分类'): string {
  const segments = splitCategoryPath(String(input ?? ''))
    .slice(0, MAX_CATEGORY_DEPTH)
    .map((segment) => segment.slice(0, MAX_SEGMENT_LENGTH))
    .filter((segment) => segment !== '.' && segment !== '..');
  const joined = segments.join('/');
  if (!joined) return fallback;
  return joined.length > MAX_CATEGORY_LENGTH
    ? joined.slice(0, MAX_CATEGORY_LENGTH)
    : joined;
}

export function isValidCategoryPath(category: string): boolean {
  return splitCategoryPath(category).join('/') === category && category.length <= MAX_CATEGORY_LENGTH;
}

/** 去除重复与空白后返回合法标签列表（保持首次出现顺序）。 */
export function normalizeTagList(input: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of input) {
    const tag = String(raw).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_TAG_LENGTH);
    if (!tag || seen.has(tag) || tags.length >= MAX_TAGS) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

/**
 * 兼容 JSON 体与 multipart 表单两种来源的标签输入：
 * 字符串形如 `["a","b"]` 时按 JSON 解析，否则按逗号/顿号/分号切分。
 */
export function coerceTagInput(input: unknown): string[] {
  if (typeof input === 'string') {
    const text = input.trim();
    if (!text) return [];
    if (text.startsWith('[')) {
      try {
        return normalizeTagList(JSON.parse(text) as unknown[]);
      } catch {
        return [];
      }
    }
    return normalizeTagList(text.split(/[,，;；、]/));
  }
  if (Array.isArray(input)) return normalizeTagList(input);
  return [];
}

export function parseTagsColumn(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((tag) => String(tag)) : [];
  } catch {
    return [];
  }
}

export function serializeTags(tags: readonly string[]): string {
  return JSON.stringify(tags);
}
