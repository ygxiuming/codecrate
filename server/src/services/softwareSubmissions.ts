import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { getDb, nowIso } from '../db';
import { badRequest, conflict, notFound } from '../http/errors';
import {
  normalizeCategoryPath,
  normalizeTagList,
  parseTagsColumn,
  serializeTags,
} from './softwareMeta';
import { importSoftwarePackage } from './softwareUpload';
import { hashFile, moveFile, removeIfExists, resolveWithin, safeFilename } from '../storage/paths';

/**
 * 用户投稿软件包：文件暂存于 software-submissions 目录，
 * 管理员审核通过后并入正式软件包（software_packages）。
 */

export interface SoftwareSubmissionRow {
  id: number;
  name: string;
  version: string;
  platform: string;
  category: string;
  tags: string;
  description_md: string;
  note: string;
  filename: string;
  stored_path: string;
  size_bytes: number;
  sha256: string;
  status: 'pending' | 'approved' | 'rejected';
  review_comment: string;
  reviewed_by: string;
  reviewed_at: string | null;
  package_id: number | null;
  uploader_ip: string;
  visitor_id: string;
  created_at: string;
  updated_at: string;
}

export type SubmissionStatus = SoftwareSubmissionRow['status'];

/** 对外输出的投稿记录：tags 解析为数组。 */
export type SerializedSubmission = Omit<SoftwareSubmissionRow, 'tags'> & { tags: string[] };

export interface CreateSubmissionInput {
  tempPath: string;
  originalName: string;
  name?: string;
  version?: string;
  platform?: string;
  category?: string;
  tags?: readonly string[];
  descriptionMd?: string;
  note?: string;
  uploaderIp: string;
  visitorId: string;
}

function serializeSubmission(row: SoftwareSubmissionRow): SerializedSubmission {
  return { ...row, tags: parseTagsColumn(row.tags) };
}

export function getSubmissionById(id: number): SoftwareSubmissionRow | undefined {
  return getDb()
    .prepare('SELECT * FROM software_submissions WHERE id = ?')
    .get(id) as SoftwareSubmissionRow | undefined;
}

export function listSubmissions(
  status: SubmissionStatus | 'all',
  page: number,
  pageSize: number,
): { items: SerializedSubmission[]; total: number } {
  const db = getDb();
  const where = status === 'all' ? '' : 'WHERE status = ?';
  const params: unknown[] = status === 'all' ? [] : [status];
  const total = (
    db
      .prepare(`SELECT COUNT(*) AS count FROM software_submissions ${where}`)
      .get(...params) as { count: number }
  ).count;
  const rows = db
    .prepare(
      `SELECT * FROM software_submissions ${where}
       ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (page - 1) * pageSize) as SoftwareSubmissionRow[];
  return { items: rows.map(serializeSubmission), total };
}

export function countPendingSubmissions(): number {
  return (
    getDb()
      .prepare("SELECT COUNT(*) AS count FROM software_submissions WHERE status = 'pending'")
      .get() as { count: number }
  ).count;
}

export async function createSubmission(input: CreateSubmissionInput): Promise<{ id: number }> {
  const displayName = path
    .basename(input.originalName)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, 180);
  if (!displayName) throw badRequest('文件名不合法');

  const name = (input.name?.trim() || displayName.replace(/\.[^.]+$/, '')).slice(0, 120);
  if (!name.trim()) throw badRequest('请填写软件名称');

  const sha256 = await hashFile(input.tempPath);
  const size = (await fs.promises.stat(input.tempPath)).size;

  // 内容查重：同哈希的正式包或待审投稿已存在时直接拒绝
  const duplicatePackage = getDb()
    .prepare('SELECT name FROM software_packages WHERE sha256 = ? LIMIT 1')
    .get(sha256) as { name: string } | undefined;
  if (duplicatePackage) {
    throw conflict(`已有相同内容的软件包「${duplicatePackage.name}」，无需重复提交`);
  }
  const duplicateSubmission = getDb()
    .prepare(
      "SELECT id FROM software_submissions WHERE sha256 = ? AND status = 'pending' LIMIT 1",
    )
    .get(sha256) as { id: number } | undefined;
  if (duplicateSubmission) {
    throw conflict('相同内容的投稿正在审核中，请耐心等待');
  }

  const filename = safeFilename(displayName, `submission-${Date.now()}`);
  const relativePath = `software-submissions/${Date.now()}-${filename}`;
  const absolutePath = resolveWithin(relativePath);
  await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
  await moveFile(input.tempPath, absolutePath);

  const result = getDb()
    .prepare(
      `INSERT INTO software_submissions
        (name, version, platform, category, tags, description_md, note, filename, stored_path,
         size_bytes, sha256, status, uploader_ip, visitor_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .run(
      name,
      input.version?.trim().slice(0, 80) ?? '',
      input.platform?.trim().slice(0, 80) ?? '',
      input.category ? normalizeCategoryPath(input.category, '') : '',
      serializeTags(normalizeTagList(input.tags ?? [])),
      input.descriptionMd?.slice(0, 200_000) ?? '',
      input.note?.slice(0, 500) ?? '',
      displayName,
      relativePath,
      size,
      sha256,
      input.uploaderIp,
      input.visitorId,
    );
  return { id: Number(result.lastInsertRowid) };
}

export function updateSubmission(
  id: number,
  patch: { category?: string; tags?: string[]; note?: string },
): SerializedSubmission {
  const row = getSubmissionById(id);
  if (!row) throw notFound('投稿不存在');
  if (row.status !== 'pending') throw badRequest('该投稿已处理完毕，不能再修改');
  const next = {
    category: patch.category !== undefined ? normalizeCategoryPath(patch.category, '') : row.category,
    tags: patch.tags !== undefined ? serializeTags(normalizeTagList(patch.tags)) : row.tags,
    note: patch.note !== undefined ? patch.note.slice(0, 500) : row.note,
  };
  getDb()
    .prepare(
      'UPDATE software_submissions SET category = ?, tags = ?, note = ?, updated_at = ? WHERE id = ?',
    )
    .run(next.category || row.category, next.tags, next.note, nowIso(), id);
  const updated = getSubmissionById(id)!;
  return serializeSubmission(updated);
}

export interface ApproveResult {
  packageId: number;
  name: string;
  category: string;
}

/** 审核通过：把暂存文件并入正式软件包并对外展示；文件由 importSoftwarePackage 移动。 */
export async function approveSubmission(
  id: number,
  override: { category?: string; tags?: string[]; note?: string },
  reviewer: string,
): Promise<ApproveResult> {
  const row = getSubmissionById(id);
  if (!row) throw notFound('投稿不存在');
  if (row.status === 'approved') throw badRequest('该投稿已通过审核');
  if (row.status === 'rejected') throw badRequest('该投稿已被拒绝，不能再次审核');

  // 先落管理员对备注/标签/分类的修改（供审计留痕）
  if (override.category !== undefined || override.tags !== undefined || override.note !== undefined) {
    updateSubmission(id, override);
  }
  const latest = getSubmissionById(id)!;

  const source = resolveWithin(latest.stored_path);
  if (!fs.existsSync(source)) throw badRequest('投稿文件已丢失，请拒绝该投稿并让用户重新提交');

  const imported = await importSoftwarePackage({
    tempPath: source,
    originalName: latest.filename,
    name: latest.name,
    version: latest.version,
    platform: latest.platform,
    category: latest.category || undefined,
    tags: parseTagsColumn(latest.tags),
    descriptionMd: latest.description_md,
    source: 'submission',
  });

  getDb()
    .prepare(
      `UPDATE software_submissions
       SET status = 'approved', reviewed_by = ?, reviewed_at = ?, package_id = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(reviewer, nowIso(), imported.id, nowIso(), id);
  return { packageId: imported.id, name: imported.name, category: imported.category };
}

export function rejectSubmission(id: number, comment: string, reviewer: string): void {
  const row = getSubmissionById(id);
  if (!row) throw notFound('投稿不存在');
  if (row.status !== 'pending') throw badRequest('该投稿已处理完毕');
  void removeIfExists(resolveWithin(row.stored_path));
  getDb()
    .prepare(
      `UPDATE software_submissions
       SET status = 'rejected', review_comment = ?, reviewed_by = ?, reviewed_at = ?, stored_path = '', updated_at = ?
       WHERE id = ?`,
    )
    .run(comment.slice(0, 500), reviewer, nowIso(), nowIso(), id);
}

/** 删除投稿记录（清理已拒绝的历史记录）。 */
export async function deleteSubmission(id: number): Promise<void> {
  const row = getSubmissionById(id);
  if (!row) throw notFound('投稿不存在');
  if (row.status === 'pending') throw badRequest('待审核投稿请先同意或拒绝');
  if (row.stored_path) await removeIfExists(resolveWithin(row.stored_path));
  getDb().prepare('DELETE FROM software_submissions WHERE id = ?').run(id);
}

export function submissionStorageDir(): string {
  return path.join(config.storageDir, 'software-submissions');
}
