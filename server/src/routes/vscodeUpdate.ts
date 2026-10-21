import { Router } from 'express';
import { findRemotePlatform } from '../adapters/platforms';
import { recordDownloadEvent } from '../analytics/events';
import { asyncHandler, notFound } from '../http/errors';
import { logger } from '../logger';
import { findServerForUpdate } from '../services/vscodeUpdate';
import { incrementDownloadCount } from '../storage/artifacts';
import { contentDisposition } from '../storage/paths';

export const vscodeUpdateRouter = Router();

/**
 * 兼容 VS Code Remote-SSH 的 server 下载地址：
 *   <base>/commit:<commit>/server-<platform>/<quality>
 * 由 remote.SSH.useOSS + remote.SSH.ossDownloadUrl 触发。
 *
 * 不要求访问码：远端主机上的 wget/curl 无法完成浏览器登录。
 * 仅按完整 commit + 平台精确匹配已缓存文件，不提供列表能力。
 */
vscodeUpdateRouter.get(
  '/commit\\::commit/server-:platform/:quality',
  asyncHandler(async (req, res, next) => {
    const commit = String(req.params.commit).toLowerCase();
    const platform = String(req.params.platform);
    const quality = String(req.params.quality);

    if (!/^[0-9a-f]{40}$/.test(commit) || !findRemotePlatform(platform) || quality !== 'stable') {
      throw notFound('未找到该 commit 对应的 Remote-SSH server 包');
    }

    const record = await findServerForUpdate(commit, platform);
    if (!record) {
      throw notFound('该 commit 的 server 包尚未缓存，请管理员在后台缓存后重试');
    }

    const startedAt = Date.now();
    const rangeHeader = typeof req.headers.range === 'string' ? req.headers.range : '';
    const rangeMatch = rangeHeader.match(/^bytes=(\d+)-/);
    const rangeStart = rangeMatch ? Number(rangeMatch[1]) : 0;

    res.once('finish', () => {
      if (req.method !== 'GET') return;
      recordDownloadEvent(req, {
        resourceType: 'remote-server',
        resourceId: record.id,
        filename: record.filename,
        statusCode: res.statusCode,
        bytesSent: Number(res.getHeader('content-length') ?? 0),
        rangeStart,
        durationMs: Date.now() - startedAt,
      });
      if (rangeStart === 0 && (res.statusCode === 200 || res.statusCode === 206)) {
        try {
          incrementDownloadCount('remote-server', record.id);
        } catch (error) {
          logger.warn({ err: error, id: record.id }, '更新下载计数失败');
        }
      }
    });

    res.sendFile(
      record.absolutePath,
      {
        dotfiles: 'deny',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': contentDisposition(record.filename),
          'X-Content-Type-Options': 'nosniff',
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      },
      (error) => {
        if (!error) return;
        if (res.headersSent) {
          res.destroy();
          return;
        }
        next(error);
      },
    );
  }),
);
