import Database from 'better-sqlite3'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const DB_PATH = join(__dirname, '..', 'vocab.db')

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    is_disabled INTEGER DEFAULT 0,
    last_login_at INTEGER DEFAULT 0,
    last_login_ip TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    action TEXT NOT NULL,
    ip TEXT DEFAULT '',
    detail TEXT DEFAULT '',
    ts INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_user_logs_user ON user_logs(user_id);

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    chinese TEXT NOT NULL,
    english TEXT NOT NULL,
    pos TEXT DEFAULT '',
    count INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    user_id INTEGER NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
  );

  CREATE TABLE IF NOT EXISTS records (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    chinese TEXT NOT NULL,
    english TEXT NOT NULL,
    pos TEXT DEFAULT '',
    correct INTEGER NOT NULL,
    user_answer TEXT DEFAULT '',
    ts INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_records_user_date ON records(user_id, date);

  CREATE TABLE IF NOT EXISTS wrongbook (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    word_id TEXT NOT NULL,
    chinese TEXT NOT NULL,
    english TEXT NOT NULL,
    pos TEXT DEFAULT '',
    added_at INTEGER NOT NULL,
    UNIQUE(user_id, word_id)
  );

  CREATE TABLE IF NOT EXISTS guest_meta (
    user_id TEXT PRIMARY KEY,
    last_ip TEXT DEFAULT '',
    last_visit INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS feedbacks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    username TEXT DEFAULT '',
    content TEXT NOT NULL,
    contact TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  );
`)

// 迁移：旧表加列（已存在则忽略）
function tryMigrate(sql) {
  try { db.exec(sql) } catch (e) {}
}

tryMigrate("ALTER TABLE words ADD COLUMN user_id INTEGER DEFAULT 0")
tryMigrate("ALTER TABLE records ADD COLUMN user_id INTEGER DEFAULT 0")
tryMigrate("ALTER TABLE records ADD COLUMN user_answer TEXT DEFAULT ''")
tryMigrate("ALTER TABLE wrongbook ADD COLUMN user_id INTEGER DEFAULT 0")
tryMigrate("ALTER TABLE wrongbook ADD COLUMN word_id TEXT DEFAULT ''")
tryMigrate("ALTER TABLE users ADD COLUMN is_disabled INTEGER DEFAULT 0")
tryMigrate("ALTER TABLE users ADD COLUMN last_login_at INTEGER DEFAULT 0")
tryMigrate("ALTER TABLE users ADD COLUMN last_login_ip TEXT DEFAULT ''")

// 旧 settings 表结构迁移：如果还是老的 (key, value) 结构，迁移到 (user_id, key, value)
try {
  const cols = db.prepare("PRAGMA table_info(settings)").all().map(c => c.name)
  if (!cols.includes('user_id')) {
    // 老表，重建
    const rows = db.prepare("SELECT * FROM settings").all()
    db.exec("DROP TABLE settings")
    db.exec(`CREATE TABLE settings (
      user_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (user_id, key)
    )`)
    for (const r of rows) {
      db.prepare("INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (0, ?, ?)").run(r.key, r.value)
    }
  }
} catch (e) {}

// 旧 wrongbook 表：主键是 word_id，需要改成自增 id + user_id + word_id
try {
  const cols = db.prepare("PRAGMA table_info(wrongbook)").all().map(c => c.name)
  if (!cols.includes('id') && cols.includes('word_id')) {
    const rows = db.prepare("SELECT * FROM wrongbook").all()
    db.exec("DROP TABLE wrongbook")
    db.exec(`CREATE TABLE wrongbook (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      word_id TEXT NOT NULL,
      chinese TEXT NOT NULL,
      english TEXT NOT NULL,
      pos TEXT DEFAULT '',
      added_at INTEGER NOT NULL,
      UNIQUE(user_id, word_id)
    )`)
    for (const r of rows) {
      db.prepare("INSERT INTO wrongbook (user_id, word_id, chinese, english, pos, added_at) VALUES (0, ?, ?, ?, ?, ?)")
        .run(r.word_id, r.chinese, r.english, r.pos || '', r.added_at)
    }
  }
} catch (e) {}

export default db
