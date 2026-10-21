import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../logger';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function badRequest(message: string, details?: unknown): ApiError {
  return new ApiError(400, 'BAD_REQUEST', message, details);
}

export function notFound(message = '资源不存在'): ApiError {
  return new ApiError(404, 'NOT_FOUND', message);
}

export function conflict(message: string, details?: unknown): ApiError {
  return new ApiError(409, 'CONFLICT', message, details);
}

export function forbidden(message = '禁止访问'): ApiError {
  return new ApiError(403, 'FORBIDDEN', message);
}

export function unauthorized(message = '请先登录'): ApiError {
  return new ApiError(401, 'UNAUTHORIZED', message);
}

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown,
): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
}

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }

  if (error instanceof ApiError) {
    const body: ErrorBody = { error: { code: error.code, message: error.message } };
    if (error.details !== undefined) body.error.details = error.details;
    res.status(error.status).json(body);
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION',
        message: '请求参数不合法',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    } satisfies ErrorBody);
    return;
  }

  const anyError = error as { code?: string; type?: string; status?: number; message?: string };
  if (anyError?.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: { code: 'FILE_TOO_LARGE', message: '上传文件超过大小限制' } });
    return;
  }
  if (anyError?.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: '请求体过大' } });
    return;
  }

  logger.error(
    { err: error, method: req.method, url: req.originalUrl, requestId: req.id },
    '未处理的请求异常',
  );
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } });
}
