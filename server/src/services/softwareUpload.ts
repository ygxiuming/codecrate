import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../db';
import { badRequest, conflict } from '../http/errors';
import {
  hashFile,
  moveFile,
  removeIfExists,
  resolveWithin,
  safeFilename,
  storageRelative,
} from '../storage/paths';
import {
  normalizeCategoryPath,
  normalizeTagList,
  serializeTags,
} from './softwareMeta';
import { saveIcon } from './icons';

export interface SoftwareRow {
  id: number;
  name: string;
  version: string;
  platform: string;
  category: string;
  tags: string;
  description_md: string;
  filename: string;
  stored_path: string;
  icon_path: string | null;
  size_bytes: number;
  sha256: string;
  download_count: number;
  source: string;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ImportSoftwareInput {
  tempPath: string;
  originalName: string;
  name?: string;
  version?: string;
  platform?: string;
  category?: string;
  tags?: readonly string[];
  descriptionMd?: string;
  /** 可选的本地图标（png/jpg/jpeg/webp/gif），按内容哈希存入 icons 目录。 */
  iconData?: Buffer;
  iconExt?: string;
  /** 记录来源：管理员上传或用户投稿合并。 */
  source?: 'upload' | 'submission';
}

export interface ImportSoftwareResult {
  id: number;
  name: string;
  version: string;
  platform: string;
  category: string;
  filename: string;
  storedPath: string;
  sizeBytes: number;
  sha256: string;
}

export function getSoftwareById(id: number): SoftwareRow | undefined {
  return getDb().prepare('SELECT * FROM software_packages WHERE id = ?').get(id) as
    | SoftwareRow
    | undefined;
}

/**
 * 管理员上传任意软件安装包：文件名只保留安全字符，展示名与说明单独存库。
 * 存储约定 data/files/software/<分类路径>/<软件名>/<版本目录>/<文件>，与目录扫描一致；
 * 分类支持「/」分隔的多级路径（最多 3 级）。
 */
export async function importSoftwarePackage(
  input: ImportSoftwareInput,
): Promise<ImportSoftwareResult> {
  const displayName = path
    .basename(input.originalName)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, 180);
  if (!displayName) throw badRequest('文件名不合法');
  const filename = safeFilename(input.originalName, `package-${Date.now()}`);

  const name = (input.name?.trim() || displayName.replace(/\.[^.]+$/, '') || filename).slice(0, 120);
  const version = input.version?.trim().slice(0, 80) ?? '';
  const platform = input.platform?.trim().slice(0, 80) ?? '';
  const category = normalizeCategoryPath(input.category);
  const tags = serializeTags(normalizeTagList(input.tags ?? []));
  const descriptionMd = input.descriptionMd?.slice(0, 200_000) ?? '';

  const relativePath = storageRelative('software', category, name, version || '通用', filename);
  const duplicate = getDb()
    .prepare('SELECT id FROM software_packages WHERE stored_path = ?')
    .get(relativePath) as { id: number } | undefined;
  if (duplicate) {
    throw conflict('同路径软件包已存在，请修改名称、版本或分类后重试');
  }

  const absolutePath = resolveWithin(relativePath);
  await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
  const sha256 = await hashFile(input.tempPath);

  // 内容查重：同哈希的软件包已存在时拒绝入库，并告知与哪个软件包重复
  const duplicates = getDb()
    .prepare(
      `SELECT name, version, category, filename FROM software_packages
       WHERE sha256 = ? LIMIT 5`,
    )
    .all(sha256) as Array<{ name: string; version: string; category: string; filename: string }>;
  if (duplicates.length > 0) {
    throw conflict('已存在相同内容的软件包，本次上传未保存', {
      duplicates: duplicates.map((row) => ({
        source: 'software',
        name: row.name,
        info: `${row.version || '未标注版本'} · 分类「${row.category}」 · ${row.filename}`,
      })),
    });
  }

  const size = (await fs.promises.stat(input.tempPath)).size;
  await removeIfExists(absolutePath);
  await moveFile(input.tempPath, absolutePath);

  const iconPath = input.iconData?.length
    ? await saveIcon(input.iconData, input.iconExt ?? 'png')
    : null;

  const result = getDb()
    .prepare(
      `INSERT INTO software_packages
        (name, version, platform, category, tags, description_md, filename, stored_path, icon_path, size_bytes, sha256, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      name,
      version,
      platform,
      category,
      tags,
      descriptionMd,
      displayName,
      relativePath,
      iconPath,
      size,
      sha256,
      input.source ?? 'upload',
    );

  return {
    id: Number(result.lastInsertRowid),
    name,
    version,
    platform,
    category,
    filename: displayName,
    storedPath: relativePath,
    sizeBytes: size,
    sha256,
  };
}
