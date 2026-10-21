import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { ensureVisitor } from './analytics/visitor';
import { originGuard, requireAdmin } from './auth/middleware';
import { config } from './config';
import { errorHandler } from './http/errors';
import { logger } from './logger';
import { adminRouter } from './routes/admin';
import { accessRouter } from './routes/access';
import { authRouter } from './routes/auth';
import { downloadRouter } from './routes/downloads';
import { eventsRouter } from './routes/events';
import { galleryRouter } from './routes/gallery';
import { healthRouter } from './routes/health';
import { publicRouter } from './routes/public';
import { vscodeUpdateRouter } from './routes/vscodeUpdate';
import { iconDirectory } from './services/icons';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => {
        const header = req.headers['x-request-id'];
        return typeof header === 'string' && header.length <= 100 ? header : crypto.randomUUID();
      },
      autoLogging: {
        ignore: (req) => req.url === '/api/health',
      },
      customLogLevel: (_req, res, error) => {
        if (error || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      customSuccessMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
      serializers: {
        req: (req) => ({
          id: req.id,
          method: req.method,
          url: req.url,
          remoteAddress: req.remoteAddress,
          userAgent: req.headers['user-agent'],
        }),
      },
      redact: ['req.headers.cookie', 'req.headers.authorization'],
    }),
  );

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: null,
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'same-origin' },
      strictTransportSecurity:
        config.cookieSecure === 'always'
          ? { maxAge: 15552000, includeSubDomains: false }
          : false,
    }),
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(ensureVisitor);

  app.use('/api', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/access', accessRouter);
  app.use('/api/public', publicRouter);
  app.use('/api/events', eventsRouter);
  app.use('/api/gallery', galleryRouter);
  app.use('/api/vscode-update', vscodeUpdateRouter);
  app.use('/api/download', downloadRouter);
  app.use('/api/admin', requireAdmin, originGuard, adminRouter);

  app.use(
    '/icons',
    express.static(iconDirectory(), {
      index: false,
      dotfiles: 'deny',
      maxAge: '30d',
      immutable: true,
    }),
  );

  const webDist = config.webDist;
  const indexPath = path.join(webDist, 'index.html');
  if (fs.existsSync(indexPath)) {
    app.use(
      express.static(webDist, {
        index: false,
        maxAge: '1h',
        setHeaders: (res, filePath) => {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      }),
    );
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        next();
        return;
      }
      if (req.path.startsWith('/api/') || req.path.startsWith('/icons/')) {
        next();
        return;
      }
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexPath);
    });
  } else {
    app.get('/', (_req, res) => {
      res.status(503).json({
        error: {
          code: 'WEB_NOT_BUILT',
          message: '前端尚未构建，请运行 npm run build 后重启服务',
        },
      });
    });
  }

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '接口不存在' } });
  });

  app.use(errorHandler);
  return app;
}
