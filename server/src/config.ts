import fs from 'node:fs';
import path from 'node:path';

function envStr(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function envInt(name: string, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`环境变量 ${name} 必须是 ${min}-${max} 之间的整数，当前值：${raw}`);
  }
  return parsed;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function envList(name: string): string[] {
  return envStr(name, '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

const serverRoot = path.resolve(__dirname, '..');
const dataDir = path.resolve(envStr('DATA_DIR', path.join(serverRoot, '..', 'data')));

export type CookieSecureMode = 'auto' | 'always' | 'never';

function parseCookieSecure(raw: string): CookieSecureMode {
  const value = raw.toLowerCase();
  if (value === 'true' || value === 'always') return 'always';
  if (value === 'false' || value === 'never') return 'never';
  return 'auto';
}

function parseTrustProxy(raw: string): boolean | number {
  if (!raw || raw.toLowerCase() === 'false' || raw === '0') return false;
  if (raw.toLowerCase() === 'true') return 1;
  const hops = Number.parseInt(raw, 10);
  return Number.isFinite(hops) && hops > 0 ? hops : false;
}

export const config = {
  env: envStr('NODE_ENV', 'development'),
  isProduction: envStr('NODE_ENV', 'development') === 'production',
  port: envInt('PORT', 3000, 1, 65535),
  host: envStr('HOST', '0.0.0.0'),
  serverRoot,
  dataDir,
  storageDir: path.resolve(envStr('STORAGE_DIR', path.join(dataDir, 'files'))),
  dbPath: path.resolve(envStr('DB_PATH', path.join(dataDir, 'registry.db'))),
  webDist: path.resolve(envStr('WEB_DIST', path.join(serverRoot, '..', 'web', 'dist'))),
  logLevel: envStr('LOG_LEVEL', 'info'),
  siteName: envStr('SITE_NAME', 'CodeCrate 离线部署源'),
  publicOrigin: envStr('PUBLIC_ORIGIN', ''),
  trustProxy: parseTrustProxy(envStr('TRUST_PROXY', 'false')),
  cookieSecure: parseCookieSecure(envStr('COOKIE_SECURE', 'auto')),
  sessionHours: envInt('SESSION_HOURS', 12, 1, 24 * 30),
  adminUsername: envStr('ADMIN_USERNAME', 'admin'),
  adminPassword: process.env.ADMIN_PASSWORD || '',
  uploadMaxBytes: envInt('UPLOAD_MAX_BYTES', 200 * 1024 * 1024, 1024, 4 * 1024 * 1024 * 1024),
  cacheConcurrency: envInt('CACHE_CONCURRENCY', 3, 1, 16),
  downloadConcurrencyPerIp: envInt('DOWNLOAD_CONCURRENCY_PER_IP', 4, 1, 64),
  accessLogEnabled: envBool('ACCESS_LOG_ENABLED', true),
  accessLogRetentionDays: envInt('ACCESS_LOG_RETENTION_DAYS', 90, 1, 3650),
  clamscanPath: envStr('CLAMSCAN_PATH', ''),
  networkAllowedPrivateHosts: envList('NETWORK_ALLOWED_PRIVATE_HOSTS'),
  allowedOrigins: envList('ALLOWED_ORIGINS'),
  userAgent: envStr(
    'SOURCE_USER_AGENT',
    'CodeCrate/1.0 (self-hosted air-gapped registry)',
  ),
  requestTimeoutMs: envInt('SOURCE_TIMEOUT_MS', 30000, 1000, 300000),
  maxRedirects: envInt('SOURCE_MAX_REDIRECTS', 5, 0, 10),
  queuePollMs: envInt('QUEUE_POLL_MS', 800, 100, 10000),
  defaultReleaseChannel: 'stable' as const,
};

export function ensureRuntimeDirs(): void {
  for (const dir of [
    config.dataDir,
    config.storageDir,
    path.join(config.storageDir, 'tmp', 'uploads'),
    path.join(config.storageDir, 'software'),
    path.join(config.storageDir, 'public'),
    path.join(config.storageDir, 'shares'),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
