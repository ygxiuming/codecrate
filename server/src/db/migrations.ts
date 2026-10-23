const MIGRATION_001 = `
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_admin ON sessions(admin_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS vscode_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  version TEXT NOT NULL,
  platform TEXT NOT NULL,
  filename TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  commit_hash TEXT,
  build_time TEXT,
  download_count INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(channel, version, platform)
);
CREATE INDEX IF NOT EXISTS idx_vscode_version ON vscode_packages(version);
CREATE INDEX IF NOT EXISTS idx_vscode_platform ON vscode_packages(platform);

CREATE TABLE IF NOT EXISTS extensions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  extension_id TEXT NOT NULL,
  publisher TEXT NOT NULL,
  name TEXT NOT NULL,
  display_name TEXT,
  version TEXT NOT NULL,
  description TEXT,
  engine_range TEXT,
  target_platform TEXT NOT NULL DEFAULT '',
  categories TEXT NOT NULL DEFAULT '[]',
  keywords TEXT NOT NULL DEFAULT '[]',
  dependencies TEXT NOT NULL DEFAULT '[]',
  icon_path TEXT,
  source TEXT NOT NULL,
  license TEXT,
  repository_url TEXT,
  homepage TEXT,
  filename TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  download_count INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(extension_id, version, target_platform)
);
CREATE INDEX IF NOT EXISTS idx_extensions_extension_id ON extensions(extension_id);
CREATE INDEX IF NOT EXISTS idx_extensions_display ON extensions(display_name);

CREATE TABLE IF NOT EXISTS extension_categories (
  extension_pk INTEGER NOT NULL REFERENCES extensions(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  PRIMARY KEY(extension_pk, category)
);
CREATE INDEX IF NOT EXISTS idx_extension_categories_category ON extension_categories(category);

CREATE TABLE IF NOT EXISTS remote_servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL,
  commit_hash TEXT NOT NULL,
  platform TEXT NOT NULL,
  filename TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  download_count INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(version, platform)
);
CREATE INDEX IF NOT EXISTS idx_remote_version ON remote_servers(version);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  target_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','success','failed','canceled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  progress_bytes INTEGER NOT NULL DEFAULT 0,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  artifact_id INTEGER,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(kind, target_key)
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_kind ON tasks(kind);

CREATE TABLE IF NOT EXISTS task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  actor_id INTEGER,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);

CREATE TABLE IF NOT EXISTS access_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('page_view','click','download','search')),
  path TEXT,
  target TEXT,
  resource_type TEXT,
  resource_id INTEGER,
  metadata TEXT,
  ip TEXT,
  ip_family TEXT,
  user_agent TEXT,
  referer TEXT,
  visitor_id TEXT,
  status_code INTEGER,
  bytes_sent INTEGER,
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_access_created ON access_events(created_at);
CREATE INDEX IF NOT EXISTS idx_access_type_created ON access_events(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_access_resource ON access_events(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_access_visitor ON access_events(visitor_id, created_at);
`;

const MIGRATION_002 = `
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info'
    CHECK (level IN ('info','success','warning','error')),
  pinned INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT,
  ends_at TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_announcements_published
  ON announcements(published, pinned, created_at);
ALTER TABLE extensions ADD COLUMN extension_pack TEXT NOT NULL DEFAULT '[]';
`;

const MIGRATION_003 = `
CREATE INDEX IF NOT EXISTS idx_remote_commit_platform
  ON remote_servers(commit_hash, platform);
`;

const MIGRATION_004 = `
CREATE TABLE IF NOT EXISTS software_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '未分类',
  description_md TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL,
  stored_path TEXT NOT NULL UNIQUE,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  download_count INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'upload',
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_software_category ON software_packages(category);
CREATE INDEX IF NOT EXISTS idx_software_name ON software_packages(name);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL CHECK (target_type IN ('board','software')),
  target_id INTEGER NOT NULL DEFAULT 0,
  parent_id INTEGER,
  reply_to_id INTEGER,
  reply_to_nickname TEXT NOT NULL DEFAULT '',
  nickname TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  ip_family TEXT,
  user_agent TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_target
  ON comments(target_type, target_id, pinned DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);

CREATE TABLE IF NOT EXISTS public_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  stored_path TEXT NOT NULL UNIQUE,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  uploader_ip TEXT NOT NULL DEFAULT '',
  visitor_id TEXT NOT NULL DEFAULT '',
  download_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_public_files_expires ON public_files(expires_at);

CREATE TABLE IF NOT EXISTS file_shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  stored_path TEXT NOT NULL UNIQUE,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  code_hash TEXT NOT NULL,
  code_hmac TEXT NOT NULL UNIQUE,
  max_downloads INTEGER,
  download_count INTEGER NOT NULL DEFAULT 0,
  uploader_ip TEXT NOT NULL DEFAULT '',
  visitor_id TEXT NOT NULL DEFAULT '',
  revoked INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_file_shares_expires ON file_shares(expires_at);
`;

const MIGRATION_005 = `
CREATE INDEX IF NOT EXISTS idx_public_files_sha256 ON public_files(sha256);
CREATE INDEX IF NOT EXISTS idx_software_sha256 ON software_packages(sha256);
`;

const MIGRATIONS: string[] = [
  MIGRATION_001,
  MIGRATION_002,
  MIGRATION_003,
  MIGRATION_004,
  MIGRATION_005,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/**
 * 逐条执行 DDL。SQL 仅来自本文件内的常量，参数走绑定；
 * 不使用 exec()，避免多语句/字符串拼接带来的注入面。
 */
function applyScript(db: import('better-sqlite3').Database, script: string): void {
  for (const chunk of script.split(';')) {
    const statement = chunk.trim();
    if (statement) db.prepare(statement).run();
  }
}

export function runMigrations(db: import('better-sqlite3').Database): void {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`,
  ).run();
  const row = db
    .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations')
    .get() as { version: number };
  const apply = db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)');

  for (let index = row.version; index < MIGRATIONS.length; index += 1) {
    const sql = MIGRATIONS[index];
    const migrate = db.transaction(() => {
      applyScript(db, sql);
      apply.run(index + 1, new Date().toISOString());
    });
    migrate();
  }
}
