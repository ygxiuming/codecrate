import type { ZodType } from 'zod';
import { ApiError } from './errors';

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ApiError(
      400,
      'VALIDATION',
      '请求参数不合法',
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

export function intParam(
  value: unknown,
  options: { fallback: number; min: number; max: number; name?: string },
): number {
  if (value === undefined || value === null || value === '') return options.fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < options.min || parsed > options.max) {
    throw new ApiError(
      400,
      'VALIDATION',
      `${options.name ?? '参数'}必须是 ${options.min}-${options.max} 之间的整数`,
    );
  }
  return parsed;
}

export interface Pagination {
  page: number;
  pageSize: number;
  offset: number;
}

export function parsePagination(
  query: Record<string, unknown>,
  defaults: { pageSize?: number; maxPageSize?: number } = {},
): Pagination {
  const page = intParam(query.page, { fallback: 1, min: 1, max: 100000, name: 'page' });
  const pageSize = intParam(query.pageSize, {
    fallback: defaults.pageSize ?? 20,
    min: 1,
    max: defaults.maxPageSize ?? 100,
    name: 'pageSize',
  });
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function optionalString(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  let text = String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (text.length > maxLength) text = text.slice(0, maxLength);
  return text || undefined;
}

export function normalizePageParams(query: Record<string, unknown>): {
  search: string;
  page: Pagination;
} {
  const search = optionalString(query.q, 120) ?? '';
  return { search, page: parsePagination(query) };
}
