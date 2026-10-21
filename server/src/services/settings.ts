import crypto from 'node:crypto';
import { config } from '../config';
import { getDb, nowIso } from '../db';

export const SETTING_DEFAULTS: Record<string, unknown> = {
  'site.name': config.siteName,
  'site.description': '面向完全隔离内网的 VS Code 安装包、插件与 Remote-SSH Server 分发平台',
  'access.require_login': false,
  'access.code_hash': '',
  'marketplace.provider': 'official',
  'marketplace.official.endpoint': 'https://marketplace.visualstudio.com',
  'marketplace.openvsx.endpoint': 'https://open-vsx.org',
  'gallery.public_base_url': '',
  'sources.vscode.releases_url': 'https://update.code.visualstudio.com/api/releases/stable',
  'sources.vscode.download_base': 'https://update.code.visualstudio.com',
  'sources.remote.download_base': 'https://update.code.visualstudio.com',
  'cache.concurrency': config.cacheConcurrency,
  'cache.max_attempts': 3,
  'download.max_concurrent_per_ip': config.downloadConcurrencyPerIp,
  'upload.max_bytes': config.uploadMaxBytes,
  'upload.remote_max_bytes': 1024 * 1024 * 1024,
  'access_log.enabled': config.accessLogEnabled,
  'access_log.retention_days': config.accessLogRetentionDays,
  'security.cookie_secret': '',
};

export type SettingValue = string | number | boolean;

function decode(raw: string, fallback: unknown): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function getSetting<T = unknown>(key: string): T {
  const row = getDb()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as { value: string } | undefined;
  if (!row) return SETTING_DEFAULTS[key] as T;
  return decode(row.value, SETTING_DEFAULTS[key]) as T;
}

export function setSetting(key: string, value: unknown): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, JSON.stringify(value), nowIso());
}

export function setSettings(patch: Record<string, unknown>): void {
  const db = getDb();
  const statement = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  const timestamp = nowIso();
  const apply = db.transaction(() => {
    for (const [key, value] of Object.entries(patch)) {
      statement.run(key, JSON.stringify(value), timestamp);
    }
  });
  apply();
}

export function getSettingsSnapshot(): Record<string, unknown> {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as Array<{
    key: string;
    value: string;
  }>;
  const snapshot: Record<string, unknown> = { ...SETTING_DEFAULTS };
  for (const row of rows) {
    snapshot[row.key] = decode(row.value, undefined);
  }
  return snapshot;
}

export function ensureCookieSecret(): string {
  const existing = getSetting<string>('security.cookie_secret');
  if (existing) return existing;
  const secret = crypto.randomBytes(32).toString('hex');
  setSetting('security.cookie_secret', secret);
  return secret;
}

export function getPublicConfig(): {
  siteName: string;
  siteDescription: string;
  requireLogin: boolean;
  marketplaceProvider: string;
  accessLogEnabled: boolean;
  galleryBaseUrl: string;
} {
  return {
    siteName: getSetting<string>('site.name'),
    siteDescription: getSetting<string>('site.description'),
    requireLogin: getSetting<boolean>('access.require_login'),
    marketplaceProvider: getSetting<string>('marketplace.provider'),
    accessLogEnabled: getSetting<boolean>('access_log.enabled'),
    galleryBaseUrl: getSetting<string>('gallery.public_base_url') || '',
  };
}
