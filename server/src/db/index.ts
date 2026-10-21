import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config';
import { logger } from '../logger';
import { runMigrations } from './migrations';

let instance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (instance) return instance;
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  const db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  runMigrations(db);
  instance = db;
  logger.info({ dbPath: config.dbPath }, 'SQLite 数据库已就绪');
  return db;
}

export function closeDb(): void {
  if (!instance) return;
  instance.close();
  instance = null;
}

export function transaction<T>(fn: () => T): T {
  const db = getDb();
  return db.transaction(fn)();
}

export function nowIso(): string {
  return new Date().toISOString();
}
