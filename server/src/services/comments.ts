import { getDb, nowIso } from '../db';
import { badRequest } from '../http/errors';

export type CommentTargetType = 'board' | 'software';

export interface CommentRow {
  id: number;
  target_type: string;
  target_id: number;
  parent_id: number | null;
  reply_to_id: number | null;
  reply_to_nickname: string;
  nickname: string;
  content: string;
  ip: string;
  ip_family: string | null;
  user_agent: string;
  pinned: number;
  created_at: string;
}

export interface CommentThread {
  id: number;
  targetType: string;
  targetId: number;
  nickname: string;
  content: string;
  ip: string;
  ipFamily: string | null;
  pinned: boolean;
  createdAt: string;
  replies: Array<{
    id: number;
    nickname: string;
    content: string;
    ip: string;
    ipFamily: string | null;
    replyToId: number | null;
    replyToNickname: string;
    createdAt: string;
  }>;
}

export function getCommentById(id: number): CommentRow | undefined {
  return getDb().prepare('SELECT * FROM comments WHERE id = ?').get(id) as
    | CommentRow
    | undefined;
}

/** 顶层评论分页：置顶优先、时间倒序；回复按时间正序返回。 */
export function listCommentThreads(
  targetType: CommentTargetType,
  targetId: number,
  page: number,
  pageSize: number,
  offset: number,
): { items: CommentThread[]; total: number } {
  const db = getDb();
  const totalRows = db
    .prepare(
      `SELECT COUNT(*) AS count FROM comments
       WHERE target_type = ? AND target_id = ? AND parent_id IS NULL`,
    )
    .all(targetType, targetId) as Array<{ count: number }>;
  const total = totalRows[0]?.count ?? 0;
  const topRows = db
    .prepare(
      `SELECT * FROM comments
       WHERE target_type = ? AND target_id = ? AND parent_id IS NULL
       ORDER BY pinned DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .all(targetType, targetId, pageSize, offset) as CommentRow[];
  const replyRows = db
    .prepare(
      `SELECT * FROM comments
       WHERE parent_id IN (SELECT id FROM comments
                           WHERE target_type = ? AND target_id = ? AND parent_id IS NULL
                           ORDER BY pinned DESC, id DESC LIMIT ? OFFSET ?)
       ORDER BY id ASC`,
    )
    .all(targetType, targetId, pageSize, offset) as CommentRow[];

  const items = topRows.map((row) => ({
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    nickname: row.nickname,
    content: row.content,
    ip: row.ip,
    ipFamily: row.ip_family,
    pinned: Boolean(row.pinned),
    createdAt: row.created_at,
    replies: replyRows
      .filter((reply) => reply.parent_id === row.id)
      .map((reply) => ({
        id: reply.id,
        nickname: reply.nickname,
        content: reply.content,
        ip: reply.ip,
        ipFamily: reply.ip_family,
        replyToId: reply.reply_to_id,
        replyToNickname: reply.reply_to_nickname,
        createdAt: reply.created_at,
      })),
  }));
  return { items, total };
}

function toThread(row: CommentRow): CommentThread {
  const replies = (
    getDb()
      .prepare('SELECT * FROM comments WHERE parent_id = ? ORDER BY id ASC')
      .all(row.id) as CommentRow[]
  ).map((reply) => ({
    id: reply.id,
    nickname: reply.nickname,
    content: reply.content,
    ip: reply.ip,
    ipFamily: reply.ip_family,
    replyToId: reply.reply_to_id,
    replyToNickname: reply.reply_to_nickname,
    createdAt: reply.created_at,
  }));
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    nickname: row.nickname,
    content: row.content,
    ip: row.ip,
    ipFamily: row.ip_family,
    pinned: Boolean(row.pinned),
    createdAt: row.created_at,
    replies,
  };
}

export function getCommentThread(id: number): CommentThread | undefined {
  const row = getCommentById(id);
  if (!row || row.parent_id !== null) return undefined;
  return toThread(row);
}

export interface CreateCommentInput {
  targetType: CommentTargetType;
  targetId: number;
  nickname: string;
  content: string;
  ip: string;
  ipFamily: string | null;
  userAgent: string;
  parentId?: number | null;
  replyToId?: number | null;
}

/**
 * 发表评论/回复。层级约束：parent 必须是同 target 的顶层评论；
 * 回复的回复拍平为同一层，仅用 reply_to_id 标注「回复 @某人」，全站最多两层。
 */
export function createComment(input: CreateCommentInput): { id: number; parentId: number | null } {
  const db = getDb();
  let parentId: number | null = null;
  let replyToId: number | null = null;
  let replyToNickname = '';

  if (input.parentId) {
    const parent = getCommentById(input.parentId);
    if (!parent) throw badRequest('要回复的评论不存在');
    if (parent.target_type !== input.targetType || parent.target_id !== input.targetId) {
      throw badRequest('回复目标与评论对象不一致');
    }
    if (parent.parent_id !== null) {
      // 回复的回复：挂到顶层根评论下，拍平展示
      parentId = parent.parent_id;
      replyToId = parent.id;
      replyToNickname = parent.nickname;
    } else {
      parentId = parent.id;
      if (input.replyToId) {
        const replyTo = getCommentById(input.replyToId);
        if (!replyTo || replyTo.parent_id !== parentId) {
          throw badRequest('回复目标不属于该评论线程');
        }
        replyToId = replyTo.id;
        replyToNickname = replyTo.nickname;
      }
    }
  } else if (input.replyToId) {
    throw badRequest('回复必须指定所属评论');
  }

  const result = db
    .prepare(
      `INSERT INTO comments
        (target_type, target_id, parent_id, reply_to_id, reply_to_nickname, nickname, content, ip, ip_family, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.targetType,
      input.targetId,
      parentId,
      replyToId,
      replyToNickname,
      input.nickname,
      input.content,
      input.ip,
      input.ipFamily,
      input.userAgent.slice(0, 500),
    );
  return { id: Number(result.lastInsertRowid), parentId };
}

/** 删除评论：顶层评论连带删除全部回复；回复只删除自身。 */
export function deleteCommentWithReplies(id: number): { filename?: string; deleted: number } {
  const db = getDb();
  const row = getCommentById(id);
  if (!row) return { deleted: 0 };
  const run = db.transaction(() => {
    const removeReplies = db.prepare('DELETE FROM comments WHERE parent_id = ?');
    const removeSelf = db.prepare('DELETE FROM comments WHERE id = ?');
    const replyCount = removeReplies.run(id).changes;
    const selfCount = removeSelf.run(id).changes;
    return replyCount + selfCount;
  });
  return { deleted: run() };
}

export function setCommentPinned(id: number, pinned: boolean): void {
  getDb().prepare('UPDATE comments SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id);
}

export interface AdminCommentQuery {
  search: string;
  targetType: string | null;
  onlyPinned: boolean;
  page: number;
  pageSize: number;
  offset: number;
}

export function listCommentsForAdmin(query: AdminCommentQuery): {
  items: Array<CommentRow & { reply_count: number }>;
  total: number;
} {
  const db = getDb();
  const filterSearch = query.search ? 1 : 0;
  const like = `%${query.search.toLowerCase()}%`;
  const filterType = query.targetType ? 1 : 0;
  const filterPinned = query.onlyPinned ? 1 : 0;
  const totalRows = db
    .prepare(
      `SELECT COUNT(*) AS count FROM comments
       WHERE (? = 0 OR lower(content) LIKE ? OR lower(nickname) LIKE ? OR lower(ip) LIKE ?)
         AND (? = 0 OR target_type = ?)
         AND (? = 0 OR pinned = 1)`,
    )
    .all(filterSearch, like, like, like, filterType, query.targetType ?? '', filterPinned) as Array<{
    count: number;
  }>;
  const total = totalRows[0]?.count ?? 0;
  const rows = db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM comments r WHERE r.parent_id = c.id) AS reply_count
       FROM comments c
       WHERE (? = 0 OR lower(c.content) LIKE ? OR lower(c.nickname) LIKE ? OR lower(c.ip) LIKE ?)
         AND (? = 0 OR c.target_type = ?)
         AND (? = 0 OR c.pinned = 1)
       ORDER BY c.id DESC LIMIT ? OFFSET ?`,
    )
    .all(
      filterSearch,
      like,
      like,
      like,
      filterType,
      query.targetType ?? '',
      filterPinned,
      query.pageSize,
      query.offset,
    ) as Array<CommentRow & { reply_count: number }>;
  return { items: rows, total };
}

export function countComments(): number {
  const rows = getDb().prepare('SELECT COUNT(*) AS count FROM comments').all() as Array<{
    count: number;
  }>;
  return rows[0]?.count ?? 0;
}

export function currentIso(): string {
  return nowIso();
}
