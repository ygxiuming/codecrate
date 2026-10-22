import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMockSource, type MockSource } from './helpers/mockSource';
import { createServerTarGz } from './helpers/serverArchive';
import { createVsix } from './helpers/vsix';

const XRW = 'XMLHttpRequest';

let app: Express;
let mock: MockSource;
let tmpDir: string;
let adminAgent: ReturnType<typeof request.agent>;
let getDbRef: () => any;
let closeDbRef: () => void;
let startQueueRef: () => void;
let stopQueueRef: () => void;

let vscodeArtifactId = 0;
let extensionArtifactId = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitTask(id: number, timeout = 20000): Promise<any> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const rows = getDbRef()
      .prepare('SELECT status, error_message FROM tasks WHERE id = ?')
      .all(id) as Array<{ status: string; error_message: string | null }>;
    const row = rows[0];
    if (row && ['success', 'failed', 'canceled'].includes(row.status)) {
      if (row.status !== 'success') {
        throw new Error(`任务 ${id} 失败（${row.status}）：${row.error_message ?? '未知错误'}`);
      }
      return row;
    }
    await sleep(120);
  }
  throw new Error(`任务 ${id} 超时`);
}

function binaryGet(url: string): request.Test {
  return request(app)
    .get(url)
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    }) as request.Test;
}

beforeAll(async () => {
  mock = await startMockSource();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-api-'));

  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = tmpDir;
  process.env.STORAGE_DIR = path.join(tmpDir, 'files');
  process.env.DB_PATH = path.join(tmpDir, 'registry.db');
  process.env.WEB_DIST = path.join(tmpDir, 'no-web');
  process.env.ADMIN_USERNAME = 'admin';
  process.env.ADMIN_PASSWORD = 'test-password-123';
  process.env.NETWORK_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
  process.env.LOG_LEVEL = 'silent';
  process.env.QUEUE_POLL_MS = '100';
  process.env.CACHE_CONCURRENCY = '2';
  process.env.SOURCE_TIMEOUT_MS = '10000';

  const { ensureRuntimeDirs } = await import('../src/config');
  ensureRuntimeDirs();
  const dbModule = await import('../src/db');
  dbModule.getDb();
  getDbRef = dbModule.getDb as any;
  closeDbRef = dbModule.closeDb;
  const { bootstrapAdmin } = await import('../src/bootstrap');
  await bootstrapAdmin();
  const { setSettings } = await import('../src/services/settings');
  setSettings({
    'sources.vscode.releases_url': `${mock.baseUrl}/api/releases/stable`,
    'sources.vscode.download_base': mock.baseUrl,
    'sources.remote.download_base': mock.baseUrl,
    'marketplace.provider': 'official',
    'marketplace.official.endpoint': `${mock.baseUrl}/marketplace`,
    'marketplace.openvsx.endpoint': `${mock.baseUrl}/openvsx`,
    'access.require_login': false,
    'access_log.enabled': true,
    'access_log.retention_days': 90,
  });

  const { createApp } = await import('../src/app');
  app = createApp();
  const queue = await import('../src/services/queue');
  startQueueRef = queue.startQueue;
  stopQueueRef = queue.stopQueue;
  startQueueRef();

  adminAgent = request.agent(app);
  await adminAgent
    .post('/api/auth/login')
    .set('X-Requested-With', XRW)
    .send({ username: 'admin', password: 'test-password-123' })
    .expect(200);
});

afterAll(async () => {
  stopQueueRef?.();
  closeDbRef?.();
  await mock?.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('auth and CSRF', () => {
  it('serves a healthy status', async () => {
    const response = await request(app).get('/api/health').expect(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.checks.db).toBe(true);
  });

  it('rejects unauthenticated admin requests', async () => {
    await request(app).get('/api/admin/overview').expect(401);
  });

  it('serves the admin overview endpoint', async () => {
    const overview = await adminAgent.get('/api/admin/overview').expect(200);
    expect(typeof overview.body.vscodeVersions).toBe('number');
    expect(overview.body.storage.artifacts.total).toBeTruthy();
    expect(overview.body.tasks).toBeTruthy();
  });

  it('rejects wrong passwords and accepts the correct one', async () => {
    await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', XRW)
      .send({ username: 'admin', password: 'wrong-password' })
      .expect(401);
    const me = await adminAgent.get('/api/auth/me').expect(200);
    expect(me.body.admin.username).toBe('admin');
  });

  it('accepts browser origins across localhost/127.0.0.1 or proxy ports', async () => {
    await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send({ username: 'admin', password: 'test-password-123' })
      .expect(200);
    await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://127.0.0.1:9999')
      .send({ username: 'admin', password: 'test-password-123' })
      .expect(200);
    await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://registry.example.com')
      .set('X-Forwarded-Host', 'registry.example.com')
      .send({ username: 'admin', password: 'test-password-123' })
      .expect(200);
  });

  it('blocks cross-origin writes and writes without a CSRF signal', async () => {
    await adminAgent
      .post('/api/admin/vscode/cache')
      .set('Origin', 'http://evil.example')
      .set('X-Requested-With', XRW)
      .send({ versions: ['1.95.0'], platforms: ['linux-x64'] })
      .expect(403);
    await adminAgent
      .post('/api/admin/vscode/cache')
      .send({ versions: ['1.95.0'], platforms: ['linux-x64'] })
      .expect(403);
  });
});

describe('VS Code caching and downloads', () => {
  it('creates one task per version/platform and caches files', async () => {
    const response = await adminAgent
      .post('/api/admin/vscode/cache')
      .set('X-Requested-With', XRW)
      .send({ versions: ['1.95.0'], platforms: ['linux-x64', 'linux-deb-x64'] })
      .expect(202);

    expect(response.body.created).toHaveLength(2);
    for (const item of response.body.created) {
      await waitTask(item.taskId);
    }
  });

  it('lists cached versions on the public API', async () => {
    const response = await request(app).get('/api/public/vscode').expect(200);
    expect(response.body.total).toBe(1);
    const version = response.body.items[0];
    expect(version.version).toBe('1.95.0');
    expect(version.commitHash).toMatch(/^[0-9a-f]{40}$/);
    expect(version.buildTime).toBeTruthy();
    expect(version.platforms).toHaveLength(2);
    const linux = version.platforms.find((item: any) => item.id === 'linux-x64');
    expect(linux).toBeTruthy();
    expect(linux.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(linux.sizeBytes).toBe(mock.binary.length);
    expect(linux.filename).toContain('.tar.gz');
    vscodeArtifactId = linux.artifactId;
  });

  it('downloads the full file and supports Range requests', async () => {
    const full = await binaryGet(`/api/download/vscode/${vscodeArtifactId}`).expect(200);
    expect(Buffer.isBuffer(full.body)).toBe(true);
    expect((full.body as Buffer).length).toBe(mock.binary.length);
    expect((full.body as Buffer).equals(mock.binary)).toBe(true);

    const partial = await binaryGet(`/api/download/vscode/${vscodeArtifactId}`)
      .set('Range', 'bytes=100-199')
      .expect(206);
    expect(partial.headers['content-range']).toBe(
      `bytes 100-199/${mock.binary.length}`,
    );
    expect((partial.body as Buffer).length).toBe(100);

    const list = await request(app).get('/api/public/vscode').expect(200);
    const linux = list.body.items[0].platforms.find((item: any) => item.id === 'linux-x64');
    expect(linux.downloadCount).toBe(1);
  });
});

describe('access logging', () => {
  it('records page views, clicks and real downloads with IP and visitor id', async () => {
    const visitor = request.agent(app);
    await visitor.get('/api/public/config').expect(200);

    const first = await visitor
      .post('/api/events')
      .send({
        events: [
          { type: 'page_view', path: '/extensions' },
          { type: 'page_view', path: '/extensions' },
          { type: 'search', target: 'python' },
          {
            type: 'click',
            target: 'download',
            resourceType: 'vscode',
            resourceId: vscodeArtifactId,
            metadata: { filename: 'demo.tar.gz' },
          },
        ],
      })
      .expect(202);
    expect(first.body.accepted).toBe(3);

    const pageViews = await adminAgent
      .get('/api/admin/access-events?type=page_view')
      .expect(200);
    expect(pageViews.body.total).toBe(1);
    expect(pageViews.body.items[0].ip).toBeTruthy();
    expect(pageViews.body.items[0].visitor_id).toBeTruthy();

    const clicks = await adminAgent.get('/api/admin/access-events?type=click').expect(200);
    expect(clicks.body.total).toBe(1);
    expect(clicks.body.items[0].resource_type).toBe('vscode');

    const downloads = await adminAgent
      .get('/api/admin/access-events?type=download')
      .expect(200);
    expect(downloads.body.total).toBeGreaterThanOrEqual(2);
    expect(downloads.body.items[0].bytes_sent).toBeGreaterThan(0);

    const overview = await adminAgent
      .get('/api/admin/analytics/overview?days=1')
      .expect(200);
    expect(overview.body.current.pv).toBeGreaterThanOrEqual(1);
    expect(overview.body.current.uv).toBeGreaterThanOrEqual(1);
    expect(overview.body.current.downloads).toBeGreaterThanOrEqual(1);

    const exported = await adminAgent
      .get('/api/admin/access-events/export')
      .expect(200);
    expect(exported.body.items.length).toBeGreaterThan(0);
  });

  it('prunes events older than the retention window', async () => {
    const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    getDbRef()
      .prepare("INSERT INTO access_events (event_type, path, ip, created_at) VALUES ('page_view', '/old', '10.0.0.9', ?)")
      .run(old);
    const { pruneAccessEvents } = await import('../src/analytics/retention');
    expect(pruneAccessEvents(90)).toBeGreaterThanOrEqual(1);
    const rows = getDbRef()
      .prepare("SELECT COUNT(*) AS count FROM access_events WHERE path = '/old'")
      .all() as Array<{ count: number }>;
    expect(rows[0]?.count).toBe(0);
  });
});

describe('extension upload and parsing', () => {
  it('uploads a vsix, parses metadata and makes it public', async () => {
    const vsixPath = path.join(tmpDir, 'upload.vsix');
    fs.writeFileSync(vsixPath, mock.uploadVsix);

    const upload = await adminAgent
      .post('/api/admin/extensions/upload')
      .set('X-Requested-With', XRW)
      .attach('file', vsixPath)
      .expect(201);

    expect(upload.body.metadata.extensionId).toBe('demo.demo-ext');
    expect(upload.body.metadata.engineRange).toBe('^1.95.0');
    expect(upload.body.metadata.categories).toContain('Testing');
    extensionArtifactId = upload.body.artifactId;

    const list = await request(app).get('/api/public/extensions?q=demo-ext').expect(200);
    const item = list.body.items.find((entry: any) => entry.id === 'demo.demo-ext');
    expect(item).toBeTruthy();
    expect(item.version).toBe('1.0.0');
    expect(item.engineRange).toBe('^1.95.0');
    expect(item.dependencies).toContain('demo.publisher.dep-ext');
    expect(item.extensionPack).toContain('demo.publisher.pack-ext');
    expect(item.iconUrl).toMatch(/^\/icons\/[a-f0-9]{32}\.png$/);

    await request(app).get(item.iconUrl).expect(200).expect('Content-Type', /image\/png/);

    const duplicate = await adminAgent
      .post('/api/admin/extensions/upload')
      .set('X-Requested-With', XRW)
      .attach('file', vsixPath)
      .expect(409);
    expect(duplicate.body.error.code).toBe('CONFLICT');
  });

  it('keeps a shared icon available after deleting one of the extensions', async () => {
    const vsixPath = path.join(tmpDir, 'shared-icon.vsix');
    fs.writeFileSync(
      vsixPath,
      await createVsix({
        publisher: 'demo',
        name: 'shared-icon',
        version: '1.0.0',
        displayName: 'Shared Icon Extension',
      }),
    );
    const upload = await adminAgent
      .post('/api/admin/extensions/upload')
      .set('X-Requested-With', XRW)
      .attach('file', vsixPath)
      .expect(201);
    const iconUrl = upload.body.iconUrl as string;
    expect(iconUrl).toMatch(/^\/icons\/[a-f0-9]{32}\.png$/);

    await adminAgent
      .delete(`/api/admin/extensions/${upload.body.artifactId}`)
      .set('X-Requested-With', XRW)
      .expect(200);

    // demo.demo-ext 仍引用同一内容哈希的图标，删除共享图标的那个插件不能影响它。
    await request(app).get(iconUrl).expect(200).expect('Content-Type', /image\/png/);
  });
});

describe('marketplace caching', () => {
  it('tests both the official adapter id and the legacy marketplace alias', async () => {
    for (const type of ['official', 'marketplace']) {
      const result = await adminAgent
        .post('/api/admin/settings/test-source')
        .set('X-Requested-With', XRW)
        .send({ type })
        .expect(200);
      expect(result.body.ok).toBe(true);
      expect(result.body.provider).toBe('official');
    }
  });

  it('returns all historical versions in the cache dialog', async () => {
    const detail = await adminAgent
      .get('/api/admin/marketplace/extension?provider=official&id=demo.market-ext')
      .expect(200);
    const versions = detail.body.detail.versions.map((item: any) => item.version);
    expect(versions).toContain('1.0.1');
    expect(versions).toContain('1.0.0');
    expect(versions.length).toBeGreaterThanOrEqual(2);
  });

  it('searches the official marketplace and caches a plugin', async () => {
    const search = await adminAgent
      .get('/api/admin/marketplace/search?provider=official&q=demo')
      .expect(200);
    const item = search.body.items.find((entry: any) => entry.id === 'demo.market-ext');
    expect(item).toBeTruthy();
    expect(item.cached).toBe(false);

    const cache = await adminAgent
      .post('/api/admin/marketplace/cache')
      .set('X-Requested-With', XRW)
      .send({ provider: 'official', id: 'demo.market-ext', version: '1.0.1' })
      .expect(202);
    await waitTask(cache.body.taskId);

    const list = await request(app).get('/api/public/extensions?q=market-ext').expect(200);
    const cached = list.body.items.find(
      (entry: any) => entry.id === 'demo.market-ext',
    );
    expect(cached).toBeTruthy();
    expect(cached.version).toBe('1.0.1');
    expect(cached.categories).toContain('Themes');
  });

  it('searches Open VSX and caches a plugin', async () => {
    const search = await adminAgent
      .get('/api/admin/marketplace/search?provider=openvsx&q=open')
      .expect(200);
    expect(search.body.items[0].id).toBe('demo.open-ext');

    const cache = await adminAgent
      .post('/api/admin/marketplace/cache')
      .set('X-Requested-With', XRW)
      .send({ provider: 'openvsx', id: 'demo.open-ext' })
      .expect(202);
    await waitTask(cache.body.taskId);

    const list = await request(app).get('/api/public/extensions?q=open-ext').expect(200);
    expect(list.body.items.some((entry: any) => entry.id === 'demo.open-ext')).toBe(true);
  });
});

describe('Remote-SSH server caching', () => {
  it('shows the commit from a cached VS Code package before the server is cached', async () => {
    const response = await adminAgent.get('/api/admin/remote/versions').expect(200);
    expect(response.body.remoteDownloadBase).toBe(mock.baseUrl);
    expect(response.body.remoteUploadMaxBytes).toBeGreaterThan(0);
    const item = response.body.items.find((entry: any) => entry.version === '1.95.0');
    expect(item).toBeTruthy();
    expect(item.commitHash).toBe('912bb683695358a54ae0c670461738984cbb5b95');
  });

  it('imports a manually uploaded server package and extracts metadata', async () => {
    const commit = 'b'.repeat(40);
    const archive = createServerTarGz({
      version: '1.94.0',
      commit,
      platform: 'linux-arm64',
    });
    const filePath = path.join(tmpDir, 'vscode-server-linux-arm64.tar.gz');
    fs.writeFileSync(filePath, archive);

    const upload = await adminAgent
      .post('/api/admin/remote/upload')
      .set('X-Requested-With', XRW)
      .attach('file', filePath)
      .expect(201);
    expect(upload.body.version).toBe('1.94.0');
    expect(upload.body.platform).toBe('linux-arm64');
    expect(upload.body.commitHash).toBe(commit);
    expect(upload.body.sizeBytes).toBe(archive.length);
    expect(upload.body.sha256).toMatch(/^[0-9a-f]{64}$/);

    const list = await request(app).get('/api/public/remote-servers').expect(200);
    const version = list.body.items.find((item: any) => item.version === '1.94.0');
    expect(version).toBeTruthy();
    expect(version.commitHash).toBe(commit);
    const platform = version.platforms.find((item: any) => item.id === 'linux-arm64');
    expect(platform).toBeTruthy();

    const downloaded = await binaryGet(
      `/api/download/remote-server/${platform.artifactId}`,
    ).expect(200);
    expect((downloaded.body as Buffer).equals(archive)).toBe(true);
  });

  it('resolves commit, caches the server and serves downloads', async () => {
    const cache = await adminAgent
      .post('/api/admin/remote/cache')
      .set('X-Requested-With', XRW)
      .send({ versions: ['1.95.0'], platforms: ['linux-x64'] })
      .expect(202);
    await waitTask(cache.body.created[0].taskId);

    const list = await request(app).get('/api/public/remote-servers').expect(200);
    const version = list.body.items.find((item: any) => item.version === '1.95.0');
    expect(version).toBeTruthy();
    expect(version.commitHash).toMatch(/^[0-9a-f]{40}$/);
    const platform = version.platforms.find((item: any) => item.id === 'linux-x64');
    expect(platform).toBeTruthy();

    const downloaded = await binaryGet(
      `/api/download/remote-server/${platform.artifactId}`,
    ).expect(200);
    expect((downloaded.body as Buffer).equals(mock.serverBinary)).toBe(true);

    const updateDownload = await binaryGet(
      `/api/vscode-update/commit:${version.commitHash}/server-linux-x64/stable`,
    ).expect(200);
    expect((updateDownload.body as Buffer).equals(mock.serverBinary)).toBe(true);

    await request(app)
      .get(`/api/vscode-update/commit:${'0'.repeat(40)}/server-linux-x64/stable`)
      .expect(404);
  });
});

describe('commit lookup and announcements', () => {
  it('finds a version by commit prefix from the local cache', async () => {
    const result = await adminAgent
      .post('/api/admin/vscode/commit-lookup')
      .set('X-Requested-With', XRW)
      .send({ commit: '912bb68' })
      .expect(200);
    expect(result.body.found).toBe(true);
    expect(result.body.matches[0].version).toBe('1.95.0');
    expect(result.body.matches[0].source).toBe('cache');
  });

  it('publishes, unpublishes and schedules announcements', async () => {
    const created = await adminAgent
      .post('/api/admin/announcements')
      .set('X-Requested-With', XRW)
      .send({
        title: '维护通知',
        content: '周六 22:00 维护',
        level: 'warning',
        pinned: true,
        published: true,
        startsAt: null,
        endsAt: null,
      })
      .expect(201);
    const id = created.body.announcement.id;

    const published = await request(app).get('/api/public/announcements').expect(200);
    expect(published.body.items.some((item: any) => item.id === id)).toBe(true);

    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await adminAgent
      .put(`/api/admin/announcements/${id}`)
      .set('X-Requested-With', XRW)
      .send({
        title: '定时公告',
        content: '明天生效',
        level: 'info',
        pinned: false,
        published: true,
        startsAt: future,
        endsAt: null,
      })
      .expect(200);
    const hidden = await request(app).get('/api/public/announcements').expect(200);
    expect(hidden.body.items.some((item: any) => item.id === id)).toBe(false);

    await adminAgent
      .put(`/api/admin/announcements/${id}`)
      .set('X-Requested-With', XRW)
      .send({
        title: '维护通知',
        content: '周六 22:00 维护',
        level: 'warning',
        pinned: true,
        published: false,
        startsAt: null,
        endsAt: null,
      })
      .expect(200);
    const offline = await request(app).get('/api/public/announcements').expect(200);
    expect(offline.body.items.some((item: any) => item.id === id)).toBe(false);

    await adminAgent
      .delete(`/api/admin/announcements/${id}`)
      .set('X-Requested-With', XRW)
      .expect(200);
  });
});

describe('VS Code gallery gateway', () => {
  it('returns cached extensions in gallery format and serves the vsix', async () => {
    const response = await request(app)
      .post('/api/gallery/extensionquery')
      .send({
        filters: [
          {
            criteria: [
              { filterType: 8, value: 'Microsoft.VisualStudio.Code' },
              { filterType: 10, value: 'demo' },
            ],
            pageNumber: 1,
            pageSize: 20,
            sortBy: 4,
            sortOrder: 0,
          },
        ],
        assetTypes: [],
        flags: 914,
      })
      .expect(200);

    const extensions = response.body.results[0].extensions;
    const uploaded = extensions.find((item: any) => item.extensionName === 'demo-ext');
    expect(uploaded).toBeTruthy();
    expect(uploaded.publisher.publisherName).toBe('demo');
    expect(uploaded.versions.length).toBeGreaterThan(0);

    const version = uploaded.versions.find((item: any) => item.version === '1.0.0');
    expect(version).toBeTruthy();
    const vsixFile = version.files.find(
      (item: any) => item.assetType === 'Microsoft.VisualStudio.Services.VSIXPackage',
    );
    expect(vsixFile.source).toContain(
      '/api/gallery/publishers/demo/vsextensions/demo-ext/1.0.0/vspackage',
    );

    const vsixUrl = new URL(vsixFile.source);
    const download = await binaryGet(`${vsixUrl.pathname}${vsixUrl.search}`).expect(200);
    expect(download.headers['content-type']).toContain('application/vsix');
    expect((download.body as Buffer).equals(mock.uploadVsix)).toBe(true);

    const manifestFile = version.files.find(
      (item: any) => item.assetType === 'Microsoft.VisualStudio.Code.Manifest',
    );
    const manifest = await request(app)
      .get(new URL(manifestFile.source).pathname)
      .expect(200);
    expect(manifest.body.publisher).toBe('demo');
    expect(manifest.body.name).toBe('demo-ext');

    const byId = await request(app)
      .post('/api/gallery/extensionquery')
      .send({
        filters: [
          {
            criteria: [{ filterType: 4, value: uploaded.extensionId }],
            pageNumber: 1,
            pageSize: 5,
            sortBy: 0,
            sortOrder: 0,
          },
        ],
        assetTypes: [],
        flags: 2151,
      })
      .expect(200);
    expect(byId.body.results[0].extensions).toHaveLength(1);
    expect(byId.body.results[0].extensions[0].extensionName).toBe('demo-ext');
  });
});

describe('storage management and settings', () => {
  it('lists storage and verifies SHA256', async () => {
    const usage = await adminAgent.get('/api/admin/storage').expect(200);
    expect(usage.body.artifacts.total.count).toBeGreaterThanOrEqual(4);

    const result = await adminAgent
      .post('/api/admin/storage/verify')
      .set('X-Requested-With', XRW)
      .send({ type: 'vscode', id: vscodeArtifactId })
      .expect(200);
    expect(result.body.ok).toBe(true);
  });

  it('scans the cache folder to import new files and remove deleted ones', async () => {
    const storageDir = path.join(tmpDir, 'files');
    const vscodePath = path.join(
      storageDir,
      'vscode',
      'stable',
      '1.93.0',
      'linux-x64',
      'code-stable-x64-1730152418.tar.gz',
    );
    const remotePath = path.join(
      storageDir,
      'remote-server',
      '1.92.0',
      'c'.repeat(40),
      'linux-x64',
      'vscode-server-linux-x64.tar.gz',
    );
    const scanVsixPath = path.join(
      storageDir,
      'extensions',
      'demo',
      'scan-ext',
      '2.0.0',
      'demo.scan-ext-2.0.0.vsix',
    );
    const scanVsix = await createVsix({
      publisher: 'demo',
      name: 'scan-ext',
      version: '2.0.0',
      displayName: 'Scan Extension',
    });

    fs.mkdirSync(path.dirname(vscodePath), { recursive: true });
    fs.writeFileSync(vscodePath, Buffer.from('scan-vscode-binary'));
    fs.mkdirSync(path.dirname(remotePath), { recursive: true });
    fs.writeFileSync(
      remotePath,
      createServerTarGz({
        version: '1.92.0',
        commit: 'c'.repeat(40),
        platform: 'linux-x64',
      }),
    );
    fs.mkdirSync(path.dirname(scanVsixPath), { recursive: true });
    fs.writeFileSync(scanVsixPath, scanVsix);

    const scanned = await adminAgent
      .post('/api/admin/storage/scan')
      .set('X-Requested-With', XRW)
      .expect(200);
    expect(scanned.body.added.vscode).toBeGreaterThanOrEqual(1);
    expect(scanned.body.added.remoteServers).toBeGreaterThanOrEqual(1);
    expect(scanned.body.added.extensions).toBeGreaterThanOrEqual(1);
    expect(scanned.body.errors).toEqual([]);

    const vscodeList = await request(app).get('/api/public/vscode').expect(200);
    const vscodeItem = vscodeList.body.items.find((item: any) => item.version === '1.93.0');
    expect(vscodeItem).toBeTruthy();
    expect(vscodeItem.platforms[0].id).toBe('linux-x64');

    const remoteList = await request(app).get('/api/public/remote-servers').expect(200);
    expect(remoteList.body.items.some((item: any) => item.version === '1.92.0')).toBe(true);

    const extensions = await request(app)
      .get('/api/public/extensions?q=scan-ext')
      .expect(200);
    expect(extensions.body.items.some((item: any) => item.id === 'demo.scan-ext')).toBe(true);

    fs.unlinkSync(vscodePath);
    fs.unlinkSync(remotePath);
    fs.unlinkSync(scanVsixPath);

    const rescanned = await adminAgent
      .post('/api/admin/storage/scan')
      .set('X-Requested-With', XRW)
      .expect(200);
    expect(rescanned.body.removed.vscode).toBeGreaterThanOrEqual(1);
    expect(rescanned.body.removed.remoteServers).toBeGreaterThanOrEqual(1);
    expect(rescanned.body.removed.extensions).toBeGreaterThanOrEqual(1);

    const vscodeAfter = await request(app).get('/api/public/vscode').expect(200);
    expect(vscodeAfter.body.items.some((item: any) => item.version === '1.93.0')).toBe(false);
    const remoteAfter = await request(app).get('/api/public/remote-servers').expect(200);
    expect(remoteAfter.body.items.some((item: any) => item.version === '1.92.0')).toBe(false);
    const extensionsAfter = await request(app)
      .get('/api/public/extensions?q=scan-ext')
      .expect(200);
    expect(extensionsAfter.body.items.length).toBe(0);
  });

  it('enforces the shared access code while keeping admin access', async () => {
    await adminAgent
      .put('/api/admin/settings')
      .set('X-Requested-With', XRW)
      .send({ 'access.require_login': true, 'access.code': 'test-code-1234' })
      .expect(200);

    const anonymous = request.agent(app);
    const denied = await anonymous.get('/api/public/vscode').expect(401);
    expect(denied.body.error.code).toBe('ACCESS_REQUIRED');

    const remoteRow = getDbRef()
      .prepare("SELECT commit_hash FROM remote_servers WHERE platform = 'linux-x64' LIMIT 1")
      .get() as { commit_hash: string };
    await request(app)
      .get(`/api/vscode-update/commit:${remoteRow.commit_hash}/server-linux-x64/stable`)
      .expect(200);

    await anonymous
      .post('/api/access/login')
      .set('X-Requested-With', XRW)
      .send({ code: 'test-code-1234' })
      .expect(200);
    await anonymous.get('/api/public/vscode').expect(200);
    await adminAgent.get('/api/public/vscode').expect(200);

    await adminAgent
      .put('/api/admin/settings')
      .set('X-Requested-With', XRW)
      .send({ 'access.require_login': false })
      .expect(200);
    await anonymous.get('/api/public/vscode').expect(200);
  });

  it('does not expose secrets and can test data sources', async () => {
    const settings = await adminAgent.get('/api/admin/settings').expect(200);
    expect(settings.body.settings['access.code_hash']).toBeUndefined();
    expect(settings.body.settings['security.cookie_secret']).toBeUndefined();

    const test = await adminAgent
      .post('/api/admin/settings/test-source')
      .set('X-Requested-With', XRW)
      .send({ type: 'vscode' })
      .expect(200);
    expect(test.body.ok).toBe(true);
  });

  it('deletes an extension and removes it from the public API', async () => {
    await adminAgent
      .delete(`/api/admin/extensions/${extensionArtifactId}`)
      .set('X-Requested-With', XRW)
      .expect(200);
    const list = await request(app).get('/api/public/extensions?q=demo-ext').expect(200);
    expect(list.body.items.some((entry: any) => entry.id === 'demo.demo-ext')).toBe(false);
  });

  it('cleans temporary files without failing', async () => {
    const result = await adminAgent
      .post('/api/admin/storage/cleanup')
      .set('X-Requested-With', XRW)
      .expect(200);
    expect(result.body.removed).toBeGreaterThanOrEqual(0);
  });
});
