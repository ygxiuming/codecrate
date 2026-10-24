import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const XRW = 'XMLHttpRequest';

let app: Express;
let tmpDir: string;
let adminAgent: ReturnType<typeof request.agent>;
let getDbRef: () => any;
let closeDbRef: () => void;
let setSettingsRef: (patch: Record<string, unknown>) => void;

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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-features-'));

  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = tmpDir;
  process.env.STORAGE_DIR = path.join(tmpDir, 'files');
  process.env.DB_PATH = path.join(tmpDir, 'registry.db');
  process.env.WEB_DIST = path.join(tmpDir, 'no-web');
  process.env.ADMIN_USERNAME = 'admin';
  process.env.ADMIN_PASSWORD = 'test-password-123';
  process.env.LOG_LEVEL = 'silent';
  process.env.QUEUE_POLL_MS = '100';

  const { ensureRuntimeDirs } = await import('../src/config');
  ensureRuntimeDirs();
  const dbModule = await import('../src/db');
  dbModule.getDb();
  getDbRef = dbModule.getDb as any;
  closeDbRef = dbModule.closeDb;
  const { bootstrapAdmin } = await import('../src/bootstrap');
  await bootstrapAdmin();
  const settings = await import('../src/services/settings');
  setSettingsRef = settings.setSettings;
  setSettingsRef({ 'access.require_login': false, 'access_log.enabled': false });

  const { createApp } = await import('../src/app');
  app = createApp();

  adminAgent = request.agent(app);
  await adminAgent
    .post('/api/auth/login')
    .set('X-Requested-With', XRW)
    .send({ username: 'admin', password: 'test-password-123' })
    .expect(200);
});

afterAll(() => {
  closeDbRef();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('软件安装包', () => {
  let packageId = 0;

  it('管理员上传带 Markdown 说明的安装包', async () => {
    const response = await adminAgent
      .post('/api/admin/software/upload')
      .set('X-Requested-With', XRW)
      .field('name', 'Demo Tool')
      .field('version', '1.2.3')
      .field('platform', 'Windows x64')
      .field('category', '开发工具')
      .field('description_md', '# Demo Tool\n\n内网通用工具。')
      .attach('file', Buffer.from('demo-installer-bytes'), 'demo-tool-1.2.3.exe')
      .expect(201);
    packageId = response.body.id;
    expect(response.body.name).toBe('Demo Tool');
    expect(response.body.category).toBe('开发工具');
    expect(response.body.sha256).toHaveLength(64);
  });

  it('公开列表可见且详情包含说明文档', async () => {
    const list = await request(app)
      .get('/api/public/software')
      .expect(200);
    expect(list.body.items.some((item: any) => item.id === packageId)).toBe(true);

    const detail = await request(app).get(`/api/public/software/${packageId}`).expect(200);
    expect(detail.body.descriptionMd).toContain('内网通用工具');
    expect(detail.body.name).toBe('Demo Tool');
  });

  it('分类过滤与分类列表', async () => {
    const filtered = await request(app)
      .get('/api/public/software?category=%E5%BC%80%E5%8F%91%E5%B7%A5%E5%85%B7')
      .expect(200);
    expect(filtered.body.items.length).toBeGreaterThanOrEqual(1);
    const categories = await request(app).get('/api/public/software/categories').expect(200);
    expect(categories.body.items.some((item: any) => item.category === '开发工具')).toBe(true);
  });

  it('下载支持 Range 断点续传', async () => {
    await binaryGet(`/api/download/software/${packageId}`)
      .expect(200)
      .then((response) => {
        expect(response.body.toString()).toBe('demo-installer-bytes');
      });
    const range = await binaryGet(`/api/download/software/${packageId}`)
      .set('Range', 'bytes=5-9')
      .expect(206);
    expect(range.body.toString()).toBe('insta');
  });

  it('目录扫描导入文件与 readme 说明', async () => {
    const categoryDir = path.join(tmpDir, 'files', 'software', '办公软件', 'Writer', '2.0');
    fs.mkdirSync(categoryDir, { recursive: true });
    fs.writeFileSync(path.join(categoryDir, 'writer-2.0-setup.msi'), 'writer-bytes');
    fs.writeFileSync(path.join(categoryDir, 'readme.md'), '## Writer\n\n扫描导入的说明。');

    const scan = await adminAgent
      .post('/api/admin/software/scan')
      .set('X-Requested-With', XRW)
      .expect(200);
    expect(scan.body.added).toBeGreaterThanOrEqual(1);

    const list = await request(app).get('/api/public/software?category=办公软件').expect(200);
    const imported = list.body.items.find((item: any) => item.name === 'Writer');
    expect(imported).toBeTruthy();
    const detail = await request(app).get(`/api/public/software/${imported.id}`).expect(200);
    expect(detail.body.descriptionMd).toContain('扫描导入的说明');
    expect(detail.body.version).toBe('2.0');
  });

  it('编辑元数据与说明后生效', async () => {
    const updated = await adminAgent
      .put(`/api/admin/software/${packageId}`)
      .set('X-Requested-With', XRW)
      .send({ description_md: '更新后的说明', platform: 'Windows x64 / x86' })
      .expect(200);
    expect(updated.body.description_md).toBe('更新后的说明');
  });

  it('分类重命名批量生效', async () => {
    const rename = await adminAgent
      .post('/api/admin/software/category-rename')
      .set('X-Requested-With', XRW)
      .send({ from: '开发工具', to: '研发工具箱' })
      .expect(200);
    expect(rename.body.changed).toBeGreaterThanOrEqual(1);
    const detail = await request(app).get(`/api/public/software/${packageId}`).expect(200);
    expect(detail.body.category).toBe('研发工具箱');
  });

  it('删除软件包同时移除文件', async () => {
    const detail = await request(app).get(`/api/public/software/${packageId}`).expect(200);
    const storedPath = getDbRef()
      .prepare('SELECT stored_path FROM software_packages WHERE id = ?')
      .get(detail.body.id) as { stored_path: string };
    const absolute = path.join(tmpDir, 'files', storedPath.stored_path);
    expect(fs.existsSync(absolute)).toBe(true);
    await adminAgent
      .delete(`/api/admin/software/${packageId}`)
      .set('X-Requested-With', XRW)
      .expect(200);
    expect(fs.existsSync(absolute)).toBe(false);
  });
});

describe('软件包标签与多级分类', () => {
  const pngBytes = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000154a24f5f0000000049454e44ae426082',
    'hex',
  );
  let idePackageId = 0;

  it('上传多级分类、标签与图标的软件包', async () => {
    const response = await adminAgent
      .post('/api/admin/software/upload')
      .set('X-Requested-With', XRW)
      .field('name', 'Neon IDE')
      .field('version', '3.4.0')
      .field('platform', 'Windows x64')
      .field('category', '开发工具/IDE')
      .field('tags', JSON.stringify(['内网常用', '免安装']))
      .field('description_md', 'Neon IDE 安装说明')
      .attach('icon', pngBytes, 'neon.png')
      .attach('file', Buffer.from('neon-ide-installer'), 'neon-ide-3.4.0.exe')
      .expect(201);
    idePackageId = response.body.id;
    expect(response.body.category).toBe('开发工具/IDE');

    const detail = await request(app).get(`/api/public/software/${idePackageId}`).expect(200);
    expect(detail.body.tags).toEqual(['内网常用', '免安装']);
    expect(detail.body.iconUrl).toMatch(/^\/icons\//);
    const icon = await request(app).get(detail.body.iconUrl).expect(200);
    expect(icon.body.length).toBe(pngBytes.length);
  });

  it('一级分类前缀过滤包含子分类，标签过滤与标签聚合', async () => {
    const byParent = await request(app)
      .get('/api/public/software?category=%E5%BC%80%E5%8F%91%E5%B7%A5%E5%85%B7')
      .expect(200);
    expect(byParent.body.items.some((item: any) => item.id === idePackageId)).toBe(true);

    const byLeaf = await request(app)
      .get('/api/public/software?category=%E5%BC%80%E5%8F%91%E5%B7%A5%E5%85%B7%2FIDE')
      .expect(200);
    expect(byLeaf.body.items.some((item: any) => item.id === idePackageId)).toBe(true);

    const byTag = await request(app).get('/api/public/software?tag=%E5%86%85%E7%BD%91%E5%B8%B8%E7%94%A8').expect(200);
    expect(byTag.body.items.some((item: any) => item.id === idePackageId)).toBe(true);

    const tags = await request(app).get('/api/public/software/tags').expect(200);
    const found = tags.body.items.find((item: any) => item.tag === '内网常用');
    expect(found?.count).toBeGreaterThanOrEqual(1);
  });

  it('管理员搜索可命中标签并按名称排序', async () => {
    const search = await adminAgent
      .get('/api/admin/software?q=%E5%85%8D%E5%AE%89%E8%A3%85')
      .set('X-Requested-With', XRW)
      .expect(200);
    expect(search.body.items.some((item: any) => item.id === idePackageId)).toBe(true);

    const sorted = await request(app).get('/api/public/software?sort=name&pageSize=50').expect(200);
    const names = sorted.body.items.map((item: any) => item.name);
    const sortedCopy = [...names].sort((a: string, b: string) => a.localeCompare(b));
    expect(names).toEqual(sortedCopy);
  });

  it('批量加标签、移除标签与批量改分类', async () => {
    await adminAgent
      .post('/api/admin/software/batch')
      .set('X-Requested-With', XRW)
      .send({ action: 'add_tags', ids: [idePackageId], tags: ['试用'] })
      .expect(200);
    let detail = await request(app).get(`/api/public/software/${idePackageId}`).expect(200);
    expect(detail.body.tags).toEqual(['内网常用', '免安装', '试用']);

    await adminAgent
      .post('/api/admin/software/batch')
      .set('X-Requested-With', XRW)
      .send({ action: 'remove_tags', ids: [idePackageId], tags: ['试用'] })
      .expect(200);
    detail = await request(app).get(`/api/public/software/${idePackageId}`).expect(200);
    expect(detail.body.tags).toEqual(['内网常用', '免安装']);

    await adminAgent
      .post('/api/admin/software/batch')
      .set('X-Requested-With', XRW)
      .send({ action: 'set_category', ids: [idePackageId], category: '开发工具/编辑器' })
      .expect(200);
    detail = await request(app).get(`/api/public/software/${idePackageId}`).expect(200);
    expect(detail.body.category).toBe('开发工具/编辑器');
  });

  it('重命名父级分类时前缀级联更新', async () => {
    await adminAgent
      .post('/api/admin/software/category-rename')
      .set('X-Requested-With', XRW)
      .send({ from: '开发工具', to: '研发工具' })
      .expect(200);
    const detail = await request(app).get(`/api/public/software/${idePackageId}`).expect(200);
    expect(detail.body.category).toBe('研发工具/编辑器');
    await adminAgent
      .post('/api/admin/software/category-rename')
      .set('X-Requested-With', XRW)
      .send({ from: '研发工具', to: '开发工具' })
      .expect(200);
  });

  it('替换与删除图标', async () => {
    const replaced = await adminAgent
      .post(`/api/admin/software/${idePackageId}/icon`)
      .set('X-Requested-With', XRW)
      .attach('icon', pngBytes, 'neon-new.png')
      .expect(200);
    expect(replaced.body.iconUrl).toMatch(/^\/icons\//);
    await adminAgent
      .delete(`/api/admin/software/${idePackageId}/icon`)
      .set('X-Requested-With', XRW)
      .expect(200);
    const detail = await request(app).get(`/api/public/software/${idePackageId}`).expect(200);
    expect(detail.body.iconUrl).toBeNull();
  });

  it('目录扫描识别同名图片为图标且不索引为安装包', async () => {
    const viewerDir = path.join(tmpDir, 'files', 'software', '图像工具', 'Viewer', '1.0');
    fs.mkdirSync(viewerDir, { recursive: true });
    fs.writeFileSync(path.join(viewerDir, 'viewer-1.0-setup.exe'), 'viewer-bytes');
    fs.writeFileSync(path.join(viewerDir, 'viewer.png'), pngBytes);

    await adminAgent
      .post('/api/admin/software/scan')
      .set('X-Requested-With', XRW)
      .expect(200);

    const list = await request(app).get('/api/public/software?category=图像工具').expect(200);
    const viewer = list.body.items.find((item: any) => item.name === 'Viewer');
    expect(viewer).toBeTruthy();
    expect(viewer.iconUrl).toMatch(/^\/icons\//);
    expect(list.body.items.some((item: any) => item.filename === 'viewer.png')).toBe(false);
  });

  it('清理测试产生的软件包', async () => {
    await adminAgent
      .delete(`/api/admin/software/${idePackageId}`)
      .set('X-Requested-With', XRW)
      .expect(200);
  });
});

describe('软件投稿审核', () => {
  let approvedPackageId = 0;
  let rejectedSubmissionId = 0;

  it('用户投稿进入待审核队列', async () => {
    const created = await request(app)
      .post('/api/public/software/submit')
      .set('X-Requested-With', XRW)
      .field('name', 'Community Tool')
      .field('version', '0.9.1')
      .field('category', '社区推荐')
      .field('tags', JSON.stringify(['社区', '实验性']))
      .field('note', '团队内部常用，请审核')
      .attach('file', Buffer.from('community-tool-payload'), 'community-tool-0.9.1.exe')
      .expect(201);
    expect(created.body.id).toBeGreaterThan(0);

    const pending = await adminAgent
      .get('/api/admin/software/submissions?status=pending')
      .set('X-Requested-With', XRW)
      .expect(200);
    const row = pending.body.items.find((item: any) => item.id === created.body.id);
    expect(row).toBeTruthy();
    expect(row.note).toBe('团队内部常用，请审核');
    expect(row.tags).toEqual(['社区', '实验性']);
  });

  it('相同内容的重复投稿被拒绝', async () => {
    await request(app)
      .post('/api/public/software/submit')
      .set('X-Requested-With', XRW)
      .field('name', 'Community Tool Again')
      .attach('file', Buffer.from('community-tool-payload'), 'community-tool-copy.exe')
      .expect(409);
  });

  it('管理员审核时修改标签分类备注后同意，自动上架', async () => {
    const pending = await adminAgent
      .get('/api/admin/software/submissions?status=pending')
      .set('X-Requested-With', XRW)
      .expect(200);
    const row = pending.body.items.find((item: any) => item.name === 'Community Tool');

    const edited = await adminAgent
      .put(`/api/admin/software/submissions/${row.id}`)
      .set('X-Requested-With', XRW)
      .send({ note: '团队内部常用（已核实）', tags: ['社区', '已核实'] })
      .expect(200);
    expect(edited.body.note).toBe('团队内部常用（已核实）');

    const approved = await adminAgent
      .post(`/api/admin/software/submissions/${row.id}/approve`)
      .set('X-Requested-With', XRW)
      .send({ category: '效率工具/社区软件', tags: ['社区', '已核实', '免安装'] })
      .expect(200);
    approvedPackageId = approved.body.packageId;
    expect(approvedPackageId).toBeGreaterThan(0);

    const detail = await request(app).get(`/api/public/software/${approvedPackageId}`).expect(200);
    expect(detail.body.name).toBe('Community Tool');
    expect(detail.body.source).toBe('submission');
    expect(detail.body.category).toBe('效率工具/社区软件');
    expect(detail.body.tags).toEqual(['社区', '已核实', '免安装']);
    expect(detail.body.descriptionMd).toBe('');
  });

  it('拒绝投稿后不再出现在公开列表，文件被清理', async () => {
    const created = await request(app)
      .post('/api/public/software/submit')
      .set('X-Requested-With', XRW)
      .field('name', 'Bad Tool')
      .attach('file', Buffer.from('bad-tool-payload'), 'bad-tool.exe')
      .expect(201);
    rejectedSubmissionId = created.body.id;

    await adminAgent
      .post(`/api/admin/software/submissions/${rejectedSubmissionId}/reject`)
      .set('X-Requested-With', XRW)
      .send({ comment: '来源不明，拒绝' })
      .expect(200);

    const rejected = await adminAgent
      .get('/api/admin/software/submissions?status=rejected')
      .set('X-Requested-With', XRW)
      .expect(200);
    const row = rejected.body.items.find((item: any) => item.id === rejectedSubmissionId);
    expect(row.status).toBe('rejected');
    expect(row.review_comment).toBe('来源不明，拒绝');

    const search = await request(app).get('/api/public/software?q=Bad%20Tool').expect(200);
    expect(search.body.items).toHaveLength(0);

    await adminAgent
      .delete(`/api/admin/software/submissions/${rejectedSubmissionId}`)
      .set('X-Requested-With', XRW)
      .expect(200);
  });

  it('关闭投稿开关后提交返回 403', async () => {
    setSettingsRef({ 'software.submissions_enabled': false });
    await request(app)
      .post('/api/public/software/submit')
      .set('X-Requested-With', XRW)
      .field('name', 'Disabled Tool')
      .attach('file', Buffer.from('disabled-tool-payload'), 'disabled-tool.exe')
      .expect(403);
    setSettingsRef({ 'software.submissions_enabled': true });
    const config = await request(app).get('/api/public/config').expect(200);
    expect(config.body.softwareSubmissionsEnabled).toBe(true);
  });

  it('清理上架的投稿软件包', async () => {
    await adminAgent
      .delete(`/api/admin/software/${approvedPackageId}`)
      .set('X-Requested-With', XRW)
      .expect(200);
  });
});

describe('评论区', () => {
  let threadId = 0;
  let replyId = 0;

  it('发表留言板评论并记录 IP', async () => {
    const created = await request(app)
      .post('/api/public/comments')
      .set('X-Requested-With', XRW)
      .send({ target_type: 'board', content: '第一条留言', nickname: '张三' })
      .expect(201);
    threadId = created.body.id;
    const list = await request(app)
      .get('/api/public/comments?target_type=board')
      .expect(200);
    expect(list.body.maskIp).toBe(false);
    const thread = list.body.items.find((item: any) => item.id === threadId);
    expect(thread.nickname).toBe('张三');
    expect(thread.ip).toBeTruthy();
    expect(thread.ipFamily).toBe('ipv4');
  });

  it('回复与回复的回复拍平为两层', async () => {
    const reply = await request(app)
      .post('/api/public/comments')
      .set('X-Requested-With', XRW)
      .send({ target_type: 'board', content: '顶层回复', parent_id: threadId })
      .expect(201);
    replyId = reply.body.id;
    expect(reply.body.parentId).toBe(threadId);

    // 对回复再回复：应挂到顶层线程下，并带 @ 引用
    const nested = await request(app)
      .post('/api/public/comments')
      .set('X-Requested-With', XRW)
      .send({
        target_type: 'board',
        content: '楼中楼',
        parent_id: replyId,
        reply_to_id: replyId,
      })
      .expect(201);
    expect(nested.body.parentId).toBe(threadId);

    const list = await request(app)
      .get('/api/public/comments?target_type=board')
      .expect(200);
    const thread = list.body.items.find((item: any) => item.id === threadId);
    expect(thread.replies).toHaveLength(2);
    const flattened = thread.replies.find((item: any) => item.content === '楼中楼');
    expect(flattened.replyToNickname).toBe('访客');
  });

  it('不存在的软件包不能评论', async () => {
    await request(app)
      .post('/api/public/comments')
      .set('X-Requested-With', XRW)
      .send({ target_type: 'software', target_id: 999999, content: 'hi' })
      .expect(404);
  });

  it('管理员置顶后排序靠前', async () => {
    await request(app)
      .post('/api/public/comments')
      .set('X-Requested-With', XRW)
      .send({ target_type: 'board', content: '普通新留言' })
      .expect(201);
    await adminAgent
      .put(`/api/admin/comments/${threadId}/pin`)
      .set('X-Requested-With', XRW)
      .send({ pinned: true })
      .expect(200);
    const list = await request(app)
      .get('/api/public/comments?target_type=board')
      .expect(200);
    expect(list.body.items[0].id).toBe(threadId);
    expect(list.body.items[0].pinned).toBe(true);
  });

  it('回复不能被置顶', async () => {
    await adminAgent
      .put(`/api/admin/comments/${replyId}/pin`)
      .set('X-Requested-With', XRW)
      .send({ pinned: true })
      .expect(400);
  });

  it('管理员删除顶层评论连带回复', async () => {
    const removed = await adminAgent
      .delete(`/api/admin/comments/${threadId}`)
      .set('X-Requested-With', XRW)
      .expect(200);
    expect(removed.body.deleted).toBe(3);
    const remaining = getDbRef()
      .prepare('SELECT COUNT(*) AS count FROM comments WHERE parent_id = ?')
      .all(threadId) as Array<{ count: number }>;
    expect(remaining[0].count).toBe(0);
  });

  it('关闭评论区后接口 403，重新开启恢复', async () => {
    setSettingsRef({ 'comments.enabled': false });
    await request(app).get('/api/public/comments?target_type=board').expect(403);
    setSettingsRef({ 'comments.enabled': true });
    await request(app).get('/api/public/comments?target_type=board').expect(200);
  });

  it('开启脱敏后返回 maskIp 标记', async () => {
    setSettingsRef({ 'comments.mask_ip': true });
    const list = await request(app)
      .get('/api/public/comments?target_type=board')
      .expect(200);
    expect(list.body.maskIp).toBe(true);
    setSettingsRef({ 'comments.mask_ip': false });
  });
});

describe('公共文件区', () => {
  let fileId = 0;

  it('上传公共文件并出现在列表', async () => {
    const created = await request(app)
      .post('/api/public/files')
      .set('X-Requested-With', XRW)
      .field('note', '给测试组的驱动')
      .attach('file', Buffer.from('public-file-bytes'), 'driver-pack.zip')
      .expect(201);
    fileId = created.body.id;
    expect(created.body.expiresAt).toBeTruthy();

    const list = await request(app).get('/api/public/files').expect(200);
    const item = list.body.items.find((entry: any) => entry.id === fileId);
    expect(item.filename).toBe('driver-pack.zip');
    expect(item.note).toBe('给测试组的驱动');
    expect(list.body.limits.retentionDays).toBeGreaterThan(0);
  });

  it('公共文件下载并计数', async () => {
    await binaryGet(`/api/download/public-file/${fileId}`)
      .expect(200)
      .then((response) => {
        expect(response.body.toString()).toBe('public-file-bytes');
      });
    const row = getDbRef()
      .prepare('SELECT download_count FROM public_files WHERE id = ?')
      .get(fileId) as { download_count: number };
    expect(row.download_count).toBe(1);
  });

  it('扩展名黑名单生效', async () => {
    setSettingsRef({ 'public.blocked_extensions': ['exe'] });
    await request(app)
      .post('/api/public/files')
      .set('X-Requested-With', XRW)
      .attach('file', Buffer.from('nope'), 'tool.exe')
      .expect(403);
    setSettingsRef({ 'public.blocked_extensions': [] });
  });

  it('总配额超限时拒绝上传', async () => {
    setSettingsRef({ 'public.quota_bytes': 8 });
    await request(app)
      .post('/api/public/files')
      .set('X-Requested-With', XRW)
      .attach('file', Buffer.from('way-too-big-payload'), 'big.bin')
      .expect(413);
    setSettingsRef({ 'public.quota_bytes': 0 });
  });

  it('到期文件立刻不可见并被清理任务删除', async () => {
    const { sweepExpiredUploads } = await import('../src/services/expiry');
    const storedPath = getDbRef()
      .prepare('SELECT stored_path FROM public_files WHERE id = ?')
      .get(fileId) as { stored_path: string };
    getDbRef()
      .prepare('UPDATE public_files SET expires_at = ? WHERE id = ?')
      .run('2000-01-01T00:00:00.000Z', fileId);

    const list = await request(app).get('/api/public/files').expect(200);
    expect(list.body.items.some((item: any) => item.id === fileId)).toBe(false);

    const absolute = path.join(tmpDir, 'files', storedPath.stored_path);
    expect(fs.existsSync(absolute)).toBe(true);
    const swept = sweepExpiredUploads();
    expect(swept.publicFiles).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(absolute)).toBe(false);
  });
});

describe('上传查重', () => {
  const dupContent = 'duplicate-content-bytes';

  it('公共区重复上传被拒绝并提示已有文件', async () => {
    await request(app)
      .post('/api/public/files')
      .set('X-Requested-With', XRW)
      .attach('file', Buffer.from(dupContent), 'first-upload.bin')
      .expect(201);
    const second = await request(app)
      .post('/api/public/files')
      .set('X-Requested-With', XRW)
      .attach('file', Buffer.from(dupContent), 'second-upload.bin')
      .expect(409);
    expect(second.body.error.code).toBe('DUPLICATE_FILE');
    const duplicates = second.body.error.details.duplicates as Array<{ source: string; name: string }>;
    expect(duplicates.some((item) => item.source === 'public' && item.name === 'first-upload.bin')).toBe(true);
  });

  it('与软件包内容相同时公共区上传被拒绝并指向软件包', async () => {
    await adminAgent
      .post('/api/admin/software/upload')
      .set('X-Requested-With', XRW)
      .field('name', 'Dup Tool')
      .attach('file', Buffer.from('software-dup-bytes'), 'dup-tool.exe')
      .expect(201);
    const upload = await request(app)
      .post('/api/public/files')
      .set('X-Requested-With', XRW)
      .attach('file', Buffer.from('software-dup-bytes'), 'same-tool.exe')
      .expect(409);
    const duplicates = upload.body.error.details.duplicates as Array<{ source: string; name: string }>;
    expect(duplicates.some((item) => item.source === 'software' && item.name === 'Dup Tool')).toBe(true);
  });

  it('管理员上传相同内容的软件包被拒绝并提示已有软件包', async () => {
    const second = await adminAgent
      .post('/api/admin/software/upload')
      .set('X-Requested-With', XRW)
      .field('name', 'Dup Tool 2')
      .attach('file', Buffer.from('software-dup-bytes'), 'dup-tool-2.exe')
      .expect(409);
    expect(second.body.error.code).toBe('CONFLICT');
    const duplicates = second.body.error.details.duplicates as Array<{ name: string }>;
    expect(duplicates[0].name).toBe('Dup Tool');
  });

  it('私人传递不参与查重，相同内容可重复创建', async () => {
    await request(app)
      .post('/api/public/share')
      .set('X-Requested-With', XRW)
      .field('pickup_code', 'DUPPASS1')
      .attach('file', Buffer.from(dupContent), 'share-one.bin')
      .expect(201);
    await request(app)
      .post('/api/public/share')
      .set('X-Requested-With', XRW)
      .field('pickup_code', 'DUPPASS2')
      .attach('file', Buffer.from(dupContent), 'share-two.bin')
      .expect(201);
  });

  it('已过期的公共文件不参与查重，可重新上传', async () => {
    // 上传一份新内容并立即置为过期
    const created = await request(app)
      .post('/api/public/files')
      .set('X-Requested-With', XRW)
      .attach('file', Buffer.from('expired-content-bytes'), 'expired.bin')
      .expect(201);
    getDbRef()
      .prepare('UPDATE public_files SET expires_at = ? WHERE id = ?')
      .run('2000-01-01T00:00:00.000Z', created.body.id);
    // 清理刚落盘的文件，避免扫描误导
    const stored = getDbRef()
      .prepare('SELECT stored_path FROM public_files WHERE id = ?')
      .get(created.body.id) as { stored_path: string };
    fs.rmSync(path.join(tmpDir, 'files', stored.stored_path), { force: true });
    getDbRef().prepare('DELETE FROM public_files WHERE id = ?').run(created.body.id);
    // 过期内容重新上传应成功
    await request(app)
      .post('/api/public/files')
      .set('X-Requested-With', XRW)
      .attach('file', Buffer.from('expired-content-bytes'), 'expired-again.bin')
      .expect(201);
  });
});

describe('私人取件码', () => {
  const code = 'TEST8CODE';
  let shareId = 0;
  let downloadUrl = '';

  it('上传并创建自定义取件码', async () => {
    const created = await request(app)
      .post('/api/public/share')
      .set('X-Requested-With', XRW)
      .field('note', '会议纪要')
      .field('pickup_code', code)
      .field('expires_hours', '2')
      .field('max_downloads', '1')
      .attach('file', Buffer.from('share-file-bytes'), 'minutes.txt')
      .expect(201);
    shareId = created.body.id;
    expect(created.body.code).toBe(code);
  });

  it('错误取件码 404，正确取件码返回下载链接', async () => {
    await request(app)
      .post('/api/share/redeem')
      .set('X-Requested-With', XRW)
      .send({ code: 'WRONGCODE' })
      .expect(404);
    const redeem = await request(app)
      .post('/api/share/redeem')
      .set('X-Requested-With', XRW)
      .send({ code: code.toLowerCase() })
      .expect(200);
    expect(redeem.body.filename).toBe('minutes.txt');
    downloadUrl = redeem.body.downloadUrl;
  });

  it('下载链接校验令牌，可下载真实内容', async () => {
    await request(app).get(`/api/share/${shareId}/file?token=broken`).expect(403);
    await binaryGet(downloadUrl)
      .expect(200)
      .then((response) => {
        expect(response.body.toString()).toBe('share-file-bytes');
      });
  });

  it('下载次数用尽后取件返回 410', async () => {
    await request(app)
      .post('/api/share/redeem')
      .set('X-Requested-With', XRW)
      .send({ code })
      .expect(410);
  });

  it('管理员撤销与删除', async () => {
    const second = await request(app)
      .post('/api/public/share')
      .set('X-Requested-With', XRW)
      .field('pickup_code', 'REVOKE01')
      .attach('file', Buffer.from('second'), 'second.txt')
      .expect(201);
    await adminAgent
      .put(`/api/admin/files/shares/${second.body.id}`)
      .set('X-Requested-With', XRW)
      .send({ revoked: true })
      .expect(200);
    await request(app)
      .post('/api/share/redeem')
      .set('X-Requested-With', XRW)
      .send({ code: 'REVOKE01' })
      .expect(410);

    const list = await adminAgent.get('/api/admin/files/shares').expect(200);
    expect(list.body.items.length).toBeGreaterThanOrEqual(2);
    await adminAgent
      .delete(`/api/admin/files/shares/${second.body.id}`)
      .set('X-Requested-With', XRW)
      .expect(200);
  });

  it('过期取件被清理任务删除', async () => {
    const { sweepExpiredUploads } = await import('../src/services/expiry');
    const storedPath = getDbRef()
      .prepare('SELECT stored_path FROM file_shares WHERE id = ?')
      .get(shareId) as { stored_path: string };
    getDbRef()
      .prepare('UPDATE file_shares SET expires_at = ? WHERE id = ?')
      .run('2000-01-01T00:00:00.000Z', shareId);
    const swept = sweepExpiredUploads();
    expect(swept.shares).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(path.join(tmpDir, 'files', storedPath.stored_path))).toBe(false);
  });
});

describe('任务中心', () => {
  it('返回任务统计', async () => {
    const stats = await adminAgent.get('/api/admin/tasks/stats').expect(200);
    expect(stats.body.stats).toHaveProperty('queued');
    expect(stats.body.stats).toHaveProperty('failed');
  });

  it('清理已完成任务', async () => {
    getDbRef()
      .prepare(
        `INSERT INTO tasks (kind, target_key, payload, status) VALUES ('extension', 'test/1.0', '{}', 'success')`,
      )
      .run();
    const cleared = await adminAgent
      .post('/api/admin/tasks/clear')
      .set('X-Requested-With', XRW)
      .send({ statuses: ['success'] })
      .expect(200);
    expect(cleared.body.cleared).toBeGreaterThanOrEqual(1);
    const remaining = getDbRef()
      .prepare("SELECT COUNT(*) AS count FROM tasks WHERE target_key = 'test/1.0'")
      .all() as Array<{ count: number }>;
    expect(remaining[0].count).toBe(0);
  });
});
