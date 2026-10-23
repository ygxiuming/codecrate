import path from 'node:path';
import type { ResolvedMarketplacePackage } from '../adapters/types';
import { resolveRemoteServerPackage } from '../adapters/remoteServer';
import { resolveVSCodePackage } from '../adapters/vscode';
import { getDb, nowIso } from '../db';
import { ApiError, conflict, notFound } from '../http/errors';
import { logger } from '../logger';
import { FetchError, sleep } from '../net/safeFetch';
import { getSetting } from '../services/settings';
import { parseVsix } from '../services/vsix';
import { resolveWithin, safeFilename, storageRelative } from '../storage/paths';
import { compareVersions } from '../utils/semver';
import { config } from '../config';
import { DownloadError, downloadFile } from './downloader';
import { saveIcon } from './icons';

export type TaskKind = 'vscode_package' | 'remote_server' | 'extension';

export interface VSCodeTaskPayload {
  kind: 'vscode_package';
  version: string;
  channel: string;
  platform: string;
}

export interface RemoteTaskPayload {
  kind: 'remote_server';
  version: string;
  channel: string;
  platform: string;
}

export interface ExtensionTaskPayload {
  kind: 'extension';
  resolved: ResolvedMarketplacePackage;
}

export type TaskPayload = VSCodeTaskPayload | RemoteTaskPayload | ExtensionTaskPayload;

export interface TaskRow {
  id: number;
  kind: TaskKind;
  target_key: string;
  payload: string;
  status: 'queued' | 'running' | 'success' | 'failed' | 'canceled';
  attempts: number;
  max_attempts: number;
  progress_bytes: number;
  total_bytes: number;
  error_code: string | null;
  error_message: string | null;
  artifact_id: number | null;
  created_by: number | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
}

interface EnqueueResult {
  taskId: number;
  created: boolean;
  status: TaskRow['status'];
}

let running = false;
let stopping = false;
let ticking = false;
let timer: NodeJS.Timeout | null = null;
const active = new Map<number, AbortController>();
const canceled = new Set<number>();

export function addTaskEvent(taskId: number, level: string, message: string): void {
  try {
    getDb()
      .prepare('INSERT INTO task_events (task_id, level, message) VALUES (?, ?, ?)')
      .run(taskId, level.slice(0, 10), message.slice(0, 1000));
  } catch (error) {
    logger.warn({ err: error, taskId }, '写入任务事件失败');
  }
}

function maxAttempts(): number {
  const value = getSetting<number>('cache.max_attempts');
  return Math.min(10, Math.max(1, Number(value) || 3));
}

function insertTask(
  kind: TaskKind,
  targetKey: string,
  payload: TaskPayload,
  createdBy: number | null,
): EnqueueResult {
  const db = getDb();
  try {
    const info = db
      .prepare(
        `INSERT INTO tasks (kind, target_key, payload, status, max_attempts, created_by)
         VALUES (?, ?, ?, 'queued', ?, ?)`,
      )
      .run(kind, targetKey, JSON.stringify(payload), maxAttempts(), createdBy);
    const taskId = Number(info.lastInsertRowid);
    addTaskEvent(taskId, 'info', '任务已创建，等待执行');
    schedule(0);
    return { taskId, created: true, status: 'queued' };
  } catch (error) {
    const code = (error as { code?: string }).code ?? '';
    if (!code.startsWith('SQLITE_CONSTRAINT')) throw error;
    const existing = db
      .prepare('SELECT id, status FROM tasks WHERE kind = ? AND target_key = ?')
      .get(kind, targetKey) as { id: number; status: TaskRow['status'] } | undefined;
    if (!existing) throw error;
    if (existing.status === 'success') {
      // 资源被删除后可重新缓存
      db.prepare(
        `UPDATE tasks SET status='queued', attempts=0, progress_bytes=0, total_bytes=0,
         error_code=NULL, error_message=NULL, artifact_id=NULL, finished_at=NULL, updated_at=?
         WHERE id=?`,
      ).run(nowIso(), existing.id);
      addTaskEvent(existing.id, 'info', '重新排队缓存任务');
      schedule(0);
      return { taskId: existing.id, created: true, status: 'queued' };
    }
    return { taskId: existing.id, created: false, status: existing.status };
  }
}

export function enqueueVSCode(
  version: string,
  platform: string,
  channel: string,
  createdBy: number | null,
): EnqueueResult {
  return insertTask(
    'vscode_package',
    `vscode:${channel}:${version}:${platform}`,
    { kind: 'vscode_package', version, channel, platform },
    createdBy,
  );
}

export function enqueueRemoteServer(
  version: string,
  platform: string,
  channel: string,
  createdBy: number | null,
): EnqueueResult {
  return insertTask(
    'remote_server',
    `remote:${channel}:${version}:${platform}`,
    { kind: 'remote_server', version, channel, platform },
    createdBy,
  );
}

export function enqueueExtension(
  resolved: ResolvedMarketplacePackage,
  createdBy: number | null,
): EnqueueResult {
  const platformKey = resolved.targetPlatform || 'universal';
  return insertTask(
    'extension',
    `extension:${resolved.provider}:${resolved.id.toLowerCase()}:${resolved.version}:${platformKey}`,
    { kind: 'extension', resolved },
    createdBy,
  );
}

export function hasVSCodeArtifact(version: string, platform: string, channel: string): boolean {
  return Boolean(
    getDb()
      .prepare(
        'SELECT 1 AS hit FROM vscode_packages WHERE channel = ? AND version = ? AND platform = ?',
      )
      .get(channel, version, platform),
  );
}

export function hasRemoteArtifact(version: string, platform: string): boolean {
  return Boolean(
    getDb()
      .prepare('SELECT 1 AS hit FROM remote_servers WHERE version = ? AND platform = ?')
      .get(version, platform),
  );
}

export function hasExtensionArtifact(
  extensionId: string,
  version: string,
  targetPlatform: string,
): boolean {
  return Boolean(
    getDb()
      .prepare(
        'SELECT 1 AS hit FROM extensions WHERE extension_id = ? AND version = ? AND target_platform = ?',
      )
      .get(extensionId.toLowerCase(), version, targetPlatform),
  );
}

function upsertVSCodePackage(input: {
  channel: string;
  version: string;
  platform: string;
  filename: string;
  storedPath: string;
  size: number;
  sha256: string;
  commitHash?: string;
  buildTime?: string;
}): number {
  const row = getDb()
    .prepare(
      `INSERT INTO vscode_packages
        (channel, version, platform, filename, stored_path, size_bytes, sha256, commit_hash, build_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(channel, version, platform) DO UPDATE SET
         filename = excluded.filename,
         stored_path = excluded.stored_path,
         size_bytes = excluded.size_bytes,
         sha256 = excluded.sha256,
         commit_hash = excluded.commit_hash,
         build_time = excluded.build_time
       RETURNING id`,
    )
    .get(
      input.channel,
      input.version,
      input.platform,
      input.filename,
      input.storedPath,
      input.size,
      input.sha256,
      input.commitHash ?? null,
      input.buildTime ?? null,
    ) as { id: number };
  return row.id;
}

export function upsertRemoteServer(input: {
  version: string;
  platform: string;
  commitHash: string;
  filename: string;
  storedPath: string;
  size: number;
  sha256: string;
}): number {
  const row = getDb()
    .prepare(
      `INSERT INTO remote_servers
        (version, commit_hash, platform, filename, stored_path, size_bytes, sha256)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(version, platform) DO UPDATE SET
         commit_hash = excluded.commit_hash,
         filename = excluded.filename,
         stored_path = excluded.stored_path,
         size_bytes = excluded.size_bytes,
         sha256 = excluded.sha256
       RETURNING id`,
    )
    .get(
      input.version,
      input.commitHash,
      input.platform,
      input.filename,
      input.storedPath,
      input.size,
      input.sha256,
    ) as { id: number };
  return row.id;
}

export function upsertExtension(input: {
  extensionId: string;
  publisher: string;
  name: string;
  displayName: string;
  version: string;
  targetPlatform: string;
  description: string;
  engineRange?: string;
  categories: string[];
  keywords: string[];
  dependencies: string[];
  extensionPack: string[];
  iconPath: string | null;
  source: string;
  license?: string;
  repositoryUrl?: string;
  homepage?: string;
  filename: string;
  storedPath: string;
  size: number;
  sha256: string;
  publishedAt?: string;
}): number {
  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO extensions
      (extension_id, publisher, name, display_name, version, target_platform, description,
       engine_range, categories, keywords, dependencies, extension_pack, icon_path, source,
       license, repository_url, homepage, filename, stored_path, size_bytes, sha256, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(extension_id, version, target_platform) DO UPDATE SET
       display_name = excluded.display_name,
       description = excluded.description,
       engine_range = excluded.engine_range,
       categories = excluded.categories,
       keywords = excluded.keywords,
       dependencies = excluded.dependencies,
       extension_pack = excluded.extension_pack,
       icon_path = excluded.icon_path,
       source = excluded.source,
       license = excluded.license,
       repository_url = excluded.repository_url,
       homepage = excluded.homepage,
       filename = excluded.filename,
       stored_path = excluded.stored_path,
       size_bytes = excluded.size_bytes,
       sha256 = excluded.sha256,
       published_at = excluded.published_at
     RETURNING id`,
  );
  const run = db.transaction(() => {
    const row = upsert.get(
      input.extensionId,
      input.publisher,
      input.name,
      input.displayName,
      input.version,
      input.targetPlatform,
      input.description,
      input.engineRange ?? null,
      JSON.stringify(input.categories),
      JSON.stringify(input.keywords),
      JSON.stringify(input.dependencies),
      JSON.stringify(input.extensionPack),
      input.iconPath,
      input.source,
      input.license ?? null,
      input.repositoryUrl ?? null,
      input.homepage ?? null,
      input.filename,
      input.storedPath,
      input.size,
      input.sha256,
      input.publishedAt ?? null,
    ) as { id: number };
    db.prepare('DELETE FROM extension_categories WHERE extension_pk = ?').run(row.id);
    const insertCategory = db.prepare(
      'INSERT OR IGNORE INTO extension_categories (extension_pk, category) VALUES (?, ?)',
    );
    for (const category of input.categories) insertCategory.run(row.id, category);
    return row.id;
  });
  return run();
}

type ProgressFn = (downloaded: number, total: number) => void;

async function executeVSCodeTask(
  task: TaskRow,
  payload: VSCodeTaskPayload,
  signal: AbortSignal,
  onProgress: ProgressFn,
): Promise<{ artifactId: number; size: number }> {
  addTaskEvent(task.id, 'info', `解析 VS Code ${payload.version} / ${payload.platform} 下载地址`);
  const artifact = await resolveVSCodePackage(payload.version, payload.platform, payload.channel);
  const filename = safeFilename(artifact.filename, `VSCode-${payload.version}-${payload.platform}`);
  const relativePath = storageRelative(
    'vscode',
    payload.channel,
    payload.version,
    payload.platform,
    filename,
  );
  const absolutePath = resolveWithin(relativePath);
  addTaskEvent(task.id, 'info', `开始下载 ${artifact.filename}`);
  const result = await downloadFile({
    url: artifact.url,
    destPath: absolutePath,
    expectedSize: artifact.sizeBytes || undefined,
    signal,
    onProgress,
  });
  addTaskEvent(task.id, 'info', '写入资源索引');
  const artifactId = upsertVSCodePackage({
    channel: payload.channel,
    version: payload.version,
    platform: payload.platform,
    filename,
    storedPath: relativePath,
    size: result.size,
    sha256: result.sha256,
    commitHash: artifact.commitHash,
    buildTime: artifact.buildTime,
  });
  return { artifactId, size: result.size };
}

async function executeRemoteTask(
  task: TaskRow,
  payload: RemoteTaskPayload,
  signal: AbortSignal,
  onProgress: ProgressFn,
): Promise<{ artifactId: number; size: number }> {
  addTaskEvent(task.id, 'info', `解析 Remote-SSH server ${payload.version} / ${payload.platform}`);
  const artifact = await resolveRemoteServerPackage(payload.version, payload.platform, payload.channel);
  if (!artifact.commitHash) {
    throw new ApiError(502, 'COMMIT_MISSING', '无法解析该版本的 commit');
  }
  const filename = safeFilename(artifact.filename, `vscode-server-${payload.platform}`);
  const relativePath = storageRelative(
    'remote-server',
    payload.version,
    artifact.commitHash,
    payload.platform,
    filename,
  );
  addTaskEvent(task.id, 'info', `开始下载 ${artifact.filename}`);
  const result = await downloadFile({
    url: artifact.url,
    destPath: resolveWithin(relativePath),
    expectedSize: artifact.sizeBytes || undefined,
    signal,
    onProgress,
  });
  addTaskEvent(task.id, 'info', '写入资源索引');
  const artifactId = upsertRemoteServer({
    version: payload.version,
    platform: payload.platform,
    commitHash: artifact.commitHash,
    filename,
    storedPath: relativePath,
    size: result.size,
    sha256: result.sha256,
  });
  return { artifactId, size: result.size };
}

async function executeExtensionTask(
  task: TaskRow,
  payload: ExtensionTaskPayload,
  signal: AbortSignal,
  onProgress: ProgressFn,
): Promise<{ artifactId: number; size: number }> {
  const pkg = payload.resolved;
  const platformLabel = pkg.targetPlatform || 'universal';
  addTaskEvent(task.id, 'info', `开始缓存插件 ${pkg.id}@${pkg.version} (${platformLabel})`);
  const filename = safeFilename(
    `${pkg.id}-${pkg.version}${pkg.targetPlatform ? `@${pkg.targetPlatform}` : ''}.vsix`,
    `extension-${pkg.version}.vsix`,
  );
  const versionDir = pkg.targetPlatform ? `${pkg.version}@${pkg.targetPlatform}` : pkg.version;
  const relativeDir = storageRelative('extensions', pkg.publisher, pkg.name, versionDir);
  const relativePath = `${relativeDir}/${filename}`;
  const absolutePath = resolveWithin(relativePath);

  const result = await downloadFile({
    url: pkg.downloadUrl,
    destPath: absolutePath,
    expectedSha256: pkg.sha256,
    signal,
    onProgress,
  });
  addTaskEvent(task.id, 'info', '解析 vsix 元数据');
  const parsed = await parseVsix(absolutePath);
  if (parsed.metadata.extensionId !== pkg.id.toLowerCase()) {
    throw new ApiError(
      422,
      'VSIX_ID_MISMATCH',
      `vsix 标识 ${parsed.metadata.extensionId} 与市场记录 ${pkg.id} 不一致`,
    );
  }
  if (compareVersions(parsed.metadata.version, pkg.version) !== 0) {
    throw new ApiError(
      422,
      'VSIX_VERSION_MISMATCH',
      `vsix 版本 ${parsed.metadata.version} 与市场记录 ${pkg.version} 不一致`,
    );
  }

  let iconPath: string | null = null;
  if (parsed.icon) {
    iconPath = await saveIcon(parsed.icon.data, path.extname(parsed.icon.filename).slice(1));
  }

  addTaskEvent(task.id, 'info', '写入插件索引');
  const artifactId = upsertExtension({
    extensionId: parsed.metadata.extensionId,
    publisher: parsed.metadata.publisher,
    name: parsed.metadata.name,
    displayName: parsed.metadata.displayName,
    version: parsed.metadata.version,
    targetPlatform: pkg.targetPlatform,
    description: parsed.metadata.description,
    engineRange: parsed.metadata.engineRange ?? pkg.engineRange,
    categories: parsed.metadata.categories,
    keywords: parsed.metadata.keywords,
    dependencies: parsed.metadata.dependencies.length
      ? parsed.metadata.dependencies
      : pkg.dependencies,
    extensionPack: parsed.metadata.extensionPack.length
      ? parsed.metadata.extensionPack
      : pkg.extensionPack,
    iconPath,
    source: `marketplace:${pkg.provider}`,
    license: parsed.metadata.license,
    repositoryUrl: parsed.metadata.repositoryUrl,
    homepage: parsed.metadata.homepage,
    filename,
    storedPath: relativePath,
    size: result.size,
    sha256: result.sha256,
    publishedAt: pkg.publishedAt,
  });
  return { artifactId, size: result.size };
}

async function executeTask(
  task: TaskRow,
  signal: AbortSignal,
  onProgress: ProgressFn,
): Promise<{ artifactId: number; size: number }> {
  let payload: TaskPayload;
  try {
    payload = JSON.parse(task.payload) as TaskPayload;
  } catch {
    throw new ApiError(422, 'INVALID_TASK', '任务载荷不是合法 JSON');
  }
  if (payload.kind !== task.kind) {
    throw new ApiError(422, 'INVALID_TASK', '任务载荷类型与任务类型不匹配');
  }
  switch (payload.kind) {
    case 'vscode_package':
      return executeVSCodeTask(task, payload, signal, onProgress);
    case 'remote_server':
      return executeRemoteTask(task, payload, signal, onProgress);
    case 'extension':
      return executeExtensionTask(task, payload, signal, onProgress);
    default:
      throw new ApiError(422, 'INVALID_TASK', '未知任务类型');
  }
}

interface NormalizedTaskError {
  code: string;
  message: string;
  retryable: boolean;
}

function normalizeTaskError(error: unknown): NormalizedTaskError {
  if (error instanceof DownloadError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  if (error instanceof FetchError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.code === 'NETWORK' || error.code === 'TIMEOUT',
    };
  }
  if (error instanceof ApiError) {
    return { code: error.code, message: error.message, retryable: false };
  }
  const err = error as { code?: string; message?: string };
  return {
    code: err?.code ?? 'INTERNAL',
    message: err?.message ?? '未知错误',
    retryable: false,
  };
}

async function runTask(task: TaskRow, controller: AbortController): Promise<void> {
  const db = getDb();
  let attempt = task.attempts;
  const attemptsLimit = Math.max(1, task.max_attempts);
  let lastProgressWrite = 0;
  const onProgress: ProgressFn = (downloaded, total) => {
    const now = Date.now();
    if (now - lastProgressWrite < 800) return;
    lastProgressWrite = now;
    try {
      db.prepare(
        'UPDATE tasks SET progress_bytes = ?, total_bytes = ?, updated_at = ? WHERE id = ?',
      ).run(downloaded, total, nowIso(), task.id);
    } catch {
      // 进度写入失败不影响下载
    }
  };

  addTaskEvent(task.id, 'info', `开始执行（第 ${attempt}/${attemptsLimit} 次尝试）`);

  for (;;) {
    try {
      const result = await executeTask(task, controller.signal, onProgress);
      if (canceled.has(task.id)) return;
      db.prepare(
        `UPDATE tasks SET status='success', progress_bytes=?, total_bytes=?,
         error_code=NULL, error_message=NULL, artifact_id=?, finished_at=?, updated_at=?
         WHERE id=?`,
      ).run(result.size, result.size, result.artifactId, nowIso(), nowIso(), task.id);
      addTaskEvent(task.id, 'success', '缓存成功');
      canceled.delete(task.id);
      return;
    } catch (error) {
      if (stopping) return;
      if (canceled.has(task.id)) {
        addTaskEvent(task.id, 'warn', '任务已取消');
        canceled.delete(task.id);
        return;
      }
      if (controller.signal.aborted) {
        addTaskEvent(task.id, 'warn', '任务被中止');
        return;
      }
      const normalized = normalizeTaskError(error);
      if (normalized.retryable && attempt < attemptsLimit) {
        attempt += 1;
        const delay = Math.min(1000 * 2 ** (attempt - 2), 8000);
        db.prepare(
          'UPDATE tasks SET attempts = ?, error_message = ?, updated_at = ? WHERE id = ?',
        ).run(attempt, normalized.message.slice(0, 1000), nowIso(), task.id);
        addTaskEvent(
          task.id,
          'warn',
          `第 ${attempt - 1} 次尝试失败：${normalized.message}；${Math.round(delay / 1000)} 秒后重试`,
        );
        await sleep(delay);
        continue;
      }
      db.prepare(
        `UPDATE tasks SET status='failed', error_code=?, error_message=?,
         finished_at=?, updated_at=? WHERE id=?`,
      ).run(
        normalized.code,
        normalized.message.slice(0, 1000),
        nowIso(),
        nowIso(),
        task.id,
      );
      addTaskEvent(task.id, 'error', `失败：${normalized.message}`);
      canceled.delete(task.id);
      return;
    }
  }
}

function claimNextTask(): TaskRow | null {
  const db = getDb();
  for (let guard = 0; guard < 20; guard += 1) {
    const row = db
      .prepare("SELECT * FROM tasks WHERE status='queued' ORDER BY id LIMIT 1")
      .get() as TaskRow | undefined;
    if (!row) return null;
    const timestamp = nowIso();
    const info = db
      .prepare(
        `UPDATE tasks SET status='running', attempts = attempts + 1,
         started_at = COALESCE(started_at, ?), updated_at = ?
         WHERE id = ? AND status = 'queued'`,
      )
      .run(timestamp, timestamp, row.id);
    if (info.changes === 1) {
      return { ...row, status: 'running', attempts: row.attempts + 1 };
    }
  }
  return null;
}

async function tick(): Promise<void> {
  if (!running || ticking) return;
  ticking = true;
  try {
    const configured = Number(getSetting<number>('cache.concurrency')) || config.cacheConcurrency;
    const concurrency = Math.min(16, Math.max(1, configured));
    while (running && active.size < concurrency) {
      const task = claimNextTask();
      if (!task) break;
      const controller = new AbortController();
      active.set(task.id, controller);
      void runTask(task, controller).finally(() => {
        active.delete(task.id);
        schedule(0);
      });
    }
  } finally {
    ticking = false;
    if (running) schedule(config.queuePollMs);
  }
}

function schedule(delayMs: number): void {
  if (!running) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void tick();
  }, Math.max(0, delayMs));
  timer.unref();
}

export function startQueue(): void {
  if (running) return;
  stopping = false;
  running = true;
  const db = getDb();
  const interrupted = db
    .prepare("SELECT id FROM tasks WHERE status = 'running'")
    .all() as Array<{ id: number }>;
  if (interrupted.length > 0) {
    const recover = db.transaction(() => {
      const update = db.prepare(
        "UPDATE tasks SET status='queued', updated_at=? WHERE id=? AND status='running'",
      );
      for (const row of interrupted) {
        update.run(nowIso(), row.id);
        addTaskEvent(row.id, 'warn', '服务重启，任务重新排队');
      }
    });
    recover();
  }
  logger.info({ recovered: interrupted.length }, '任务队列已启动');
  schedule(0);
}

export function stopQueue(): void {
  running = false;
  stopping = true;
  if (timer) clearTimeout(timer);
  timer = null;
  for (const controller of active.values()) controller.abort();
  active.clear();
}

export function notifyQueue(): void {
  schedule(0);
}

export function getTask(id: number): TaskRow | null {
  return (
    (getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined) ?? null
  );
}

export function getTaskEvents(taskId: number): Array<{
  id: number;
  level: string;
  message: string;
  created_at: string;
}> {
  return getDb()
    .prepare(
      'SELECT id, level, message, created_at FROM task_events WHERE task_id = ? ORDER BY id DESC LIMIT 200',
    )
    .all(taskId) as Array<{ id: number; level: string; message: string; created_at: string }>;
}

export function cancelTask(id: number): TaskRow {
  const task = getTask(id);
  if (!task) throw notFound('任务不存在');
  if (task.status === 'success') throw conflict('任务已完成，无法取消');
  canceled.add(id);
  getDb()
    .prepare(
      `UPDATE tasks SET status='canceled', finished_at=?, updated_at=?
       WHERE id=? AND status IN ('queued','running')`,
    )
    .run(nowIso(), nowIso(), id);
  active.get(id)?.abort();
  addTaskEvent(id, 'warn', '管理员已取消任务');
  return getTask(id) as TaskRow;
}

export function retryTask(id: number): TaskRow {
  const task = getTask(id);
  if (!task) throw notFound('任务不存在');
  if (task.status !== 'failed' && task.status !== 'canceled') {
    throw conflict('只有失败或已取消的任务可以重试');
  }
  canceled.delete(id);
  getDb()
    .prepare(
      `UPDATE tasks SET status='queued', attempts=0, progress_bytes=0, total_bytes=0,
       error_code=NULL, error_message=NULL, finished_at=NULL, updated_at=?
       WHERE id=?`,
    )
    .run(nowIso(), id);
  addTaskEvent(id, 'info', '管理员触发重试');
  schedule(0);
  return getTask(id) as TaskRow;
}

export function retryAllFailed(limit = 100): number {
  const rows = getDb()
    .prepare("SELECT id FROM tasks WHERE status='failed' ORDER BY id LIMIT ?")
    .all(limit) as Array<{ id: number }>;
  const update = getDb().prepare(
    `UPDATE tasks SET status='queued', attempts=0, progress_bytes=0, total_bytes=0,
     error_code=NULL, error_message=NULL, finished_at=NULL, updated_at=? WHERE id=?`,
  );
  const transaction = getDb().transaction(() => {
    for (const row of rows) {
      canceled.delete(row.id);
      update.run(nowIso(), row.id);
      addTaskEvent(row.id, 'info', '批量重试');
    }
  });
  transaction();
  if (rows.length > 0) schedule(0);
  return rows.length;
}

export function queueStats(): Record<string, number> {
  const rows = getDb()
    .prepare('SELECT status, COUNT(*) AS count FROM tasks GROUP BY status')
    .all() as Array<{ status: string; count: number }>;
  const stats: Record<string, number> = {
    queued: 0,
    running: 0,
    success: 0,
    failed: 0,
    canceled: 0,
  };
  for (const row of rows) stats[row.status] = row.count;
  return stats;
}

const CLEARABLE_STATUSES = new Set(['success', 'failed', 'canceled']);

/** 清理已完成/已失败/已取消的任务（事件随外键级联删除），运行中的任务不受影响。 */
export function clearFinishedTasks(statuses: string[]): number {
  const allowed = statuses.filter((status) => CLEARABLE_STATUSES.has(status));
  if (allowed.length === 0) return 0;
  const placeholders = allowed.map(() => '?').join(', ');
  const rows = getDb()
    .prepare(`SELECT id FROM tasks WHERE status IN (${placeholders})`)
    .all(...allowed) as Array<{ id: number }>;
  if (rows.length === 0) return 0;
  const transaction = getDb().transaction(() => {
    const remove = getDb().prepare(`DELETE FROM tasks WHERE id = ? AND status IN (${placeholders})`);
    for (const row of rows) remove.run(row.id, ...allowed);
  });
  transaction();
  return rows.length;
}
