import fs from 'node:fs';
import { Router } from 'express';
import { config } from '../config';
import { getDb } from '../db';
import { queueStats } from '../services/queue';

export const healthRouter = Router();

healthRouter.get('/health', async (_req, res) => {
  const checks = { db: false, storage: false, queue: false };
  try {
    getDb().prepare('SELECT 1 AS ok').get();
    checks.db = true;
  } catch {
    checks.db = false;
  }
  try {
    await fs.promises.access(config.storageDir, fs.constants.W_OK);
    checks.storage = true;
  } catch {
    checks.storage = false;
  }
  let queue: Record<string, number> = {};
  try {
    queue = queueStats();
    checks.queue = true;
  } catch {
    checks.queue = false;
  }
  const ok = checks.db && checks.storage;
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'error',
    checks,
    queue,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});
