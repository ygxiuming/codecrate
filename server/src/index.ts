import { startMaintenanceJob } from './analytics/retention';
import { createApp } from './app';
import { cleanupExpiredSessions } from './auth/sessions';
import { bootstrapAdmin } from './bootstrap';
import { config, ensureRuntimeDirs } from './config';
import { closeDb, getDb } from './db';
import { logger } from './logger';
import { startExpiryJob } from './services/expiry';
import { startQueue, stopQueue } from './services/queue';
import { startSoftwareScanJob } from './services/softwareScan';
import { ensureCookieSecret } from './services/settings';

async function main(): Promise<void> {
  ensureRuntimeDirs();
  getDb();
  ensureCookieSecret();
  await bootstrapAdmin();
  cleanupExpiredSessions();
  startQueue();
  const stopMaintenance = startMaintenanceJob();
  const stopExpiry = startExpiryJob();
  const stopSoftwareScan = startSoftwareScanJob();

  const app = createApp();
  const server = app.listen(config.port, config.host, () => {
    logger.info(
      {
        url: `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`,
        storageDir: config.storageDir,
        dbPath: config.dbPath,
        webDist: config.webDist,
      },
      'CodeCrate 内网资源分发平台已启动',
    );
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, '正在优雅关闭');
    stopQueue();
    stopMaintenance();
    stopExpiry();
    stopSoftwareScan();
    server.close(() => {
      closeDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  logger.fatal({ err: error }, '服务启动失败');
  process.exit(1);
});
