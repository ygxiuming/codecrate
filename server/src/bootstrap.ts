import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { hashPassword } from './auth/password';
import { config } from './config';
import { getDb } from './db';
import { logger } from './logger';

/**
 * 首次启动创建管理员：
 * - 提供 ADMIN_PASSWORD 时使用该密码；
 * - 未提供时生成随机密码，打印一次并写入 DATA_DIR/initial-admin-password（0600）。
 */
export async function bootstrapAdmin(): Promise<void> {
  const db = getDb();
  const rows = db.prepare('SELECT COUNT(*) AS count FROM admin_users').all() as Array<{
    count: number;
  }>;
  if ((rows[0]?.count ?? 0) > 0) return;

  const username = (config.adminUsername || 'admin').trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,64}$/.test(username)) {
    throw new Error('ADMIN_USERNAME 只能包含小写字母、数字、点、下划线和短横线（2-64 位）');
  }

  let password = config.adminPassword;
  let generated = false;
  if (!password) {
    password = crypto.randomBytes(12).toString('base64url');
    generated = true;
  }
  if (password.length < 10) {
    throw new Error('ADMIN_PASSWORD 至少需要 10 位');
  }

  const hash = await hashPassword(password);
  db.prepare(
    'INSERT INTO admin_users (username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)',
  ).run(username, hash, new Date().toISOString(), new Date().toISOString());

  if (generated) {
    const passwordFile = path.join(config.dataDir, 'initial-admin-password');
    await fs.promises.writeFile(
      passwordFile,
      `username: ${username}\npassword: ${password}\n`,
      { mode: 0o600 },
    );
    logger.warn(
      { username, passwordFile },
      `首次启动已生成管理员账号 ${username}，初始密码：${password}（请登录后立即修改，并删除该文件）`,
    );
  } else {
    logger.info({ username }, '已根据环境变量创建管理员账号');
  }
}
