import Database from 'better-sqlite3'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 数据库文件放在项目根目录（server/ 的上一级）
const DB_PATH = join(__dirname, '..', 'vocab.db')

const db = new Database(DB_PATH)

// 开启 WAL 模式（读写并发更好，单用户 demo 也足够）
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chinese TEXT NOT NULL,
    english TEXT NOT NULL,
    pos TEXT DEFAULT '',
    count INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS records (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    chinese TEXT NOT NULL,
    english TEXT NOT NULL,
    pos TEXT DEFAULT '',
    correct INTEGER NOT NULL,
    ts INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_records_date ON records(date);

  CREATE TABLE IF NOT EXISTS wrongbook (
    word_id TEXT PRIMARY KEY,
    chinese TEXT NOT NULL,
    english TEXT NOT NULL,
    pos TEXT DEFAULT '',
    added_at INTEGER NOT NULL
  );
`)

// 默认设置
const DEFAULT_SETTINGS = { masteryThreshold: 5 }
for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(key, String(value))
}

export default db
