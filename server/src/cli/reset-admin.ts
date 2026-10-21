import { hashPassword } from '../auth/password';
import { config, ensureRuntimeDirs } from '../config';
import { closeDb, getDb, nowIso } from '../db';

async function main(): Promise<void> {
  ensureRuntimeDirs();
  const db = getDb();
  const username = (process.env.ADMIN_USERNAME || config.adminUsername || 'admin')
    .trim()
    .toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? '';

  if (!/^[a-z0-9._-]{2,64}$/.test(username)) {
    console.error('ADMIN_USERNAME 只能包含小写字母、数字、点、下划线和短横线（2-64 位）');
    process.exit(1);
  }
  if (password.length < 10) {
    console.error('请通过 ADMIN_PASSWORD 环境变量提供至少 10 位的新密码');
    process.exit(1);
  }

  const hash = await hashPassword(password);
  const existing = db
    .prepare('SELECT id FROM admin_users WHERE username = ?')
    .all(username) as Array<{ id: number }>;

  if (existing[0]) {
    db.prepare('UPDATE admin_users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
      hash,
      nowIso(),
      existing[0].id,
    );
    db.prepare('DELETE FROM sessions WHERE admin_id = ?').run(existing[0].id);
  } else {
    db.prepare(
      'INSERT INTO admin_users (username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ).run(username, hash, nowIso(), nowIso());
  }

  console.log(`管理员 ${username} 的密码已重置，所有旧会话已失效。`);
  closeDb();
}

main().catch((error) => {
  console.error('重置失败：', (error as Error).message);
  process.exit(1);
});
