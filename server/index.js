import express from 'express'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import fs from 'fs'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import cookieParser from 'cookie-parser'
import db from './db.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const DIST_DIR = join(__dirname, '..', 'dist')

const app = express()
app.use(express.json())
app.use(cookieParser())

// ============ 初始化管理员 ============
const ADMIN_USER = 'Nash0828'
const ADMIN_PASS = '12345678'
const existingAdmin = db.prepare("SELECT id FROM users WHERE username = ?").get(ADMIN_USER)
if (!existingAdmin) {
  const hash = bcrypt.hashSync(ADMIN_PASS, 10)
  db.prepare("INSERT INTO users (username, password_hash, is_admin, created_at) VALUES (?, ?, 1, ?)")
    .run(ADMIN_USER, hash, Date.now())
  console.log(`✅ 管理员 ${ADMIN_USER} 已初始化`)
}

// ============ 工具函数 ============
function genToken() { return crypto.randomBytes(32).toString('hex') }
function genId(prefix = '') { return `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
function rowToWord(row) {
  return { id: String(row.id), chinese: row.chinese, english: row.english, pos: row.pos || '', count: row.count || 0, createdAt: row.created_at }
}
function getThreshold(uid) {
  const row = db.prepare("SELECT value FROM settings WHERE user_id = ? AND key = 'masteryThreshold'").get(uid)
  const t = Number(row?.value)
  return Number.isFinite(t) && t >= 1 ? Math.floor(t) : 5
}

// 中间件：解析当前用户
function auth(req, res, next) {
  const token = req.cookies?.vt_session
  let userId = null, username = null, isAdmin = false

  if (token) {
    const sess = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token)
    if (sess) {
      const u = db.prepare("SELECT * FROM users WHERE id = ?").get(sess.user_id)
      if (u) { userId = u.id; username = u.username; isAdmin = !!u.is_admin }
    }
  }

  if (!userId) {
    const anon = req.cookies?.vt_anon
    if (anon && /^anon_[a-z0-9]+$/.test(anon)) {
      userId = anon
    } else {
      userId = 'anon_' + crypto.randomBytes(8).toString('hex')
      res.cookie('vt_anon', userId, { maxAge: 365*24*3600*1000, httpOnly: true, sameSite: 'lax' })
    }
  }

  req.userId = userId
  req.username = username
  req.isAdmin = isAdmin
  next()
}
app.use(auth)

// ============ 认证 API ============
app.post('/api/register', (req, res) => {
  const { username, password } = req.body || {}
  const u = (username || '').trim(), p = password || ''
  if (u.length < 2 || u.length > 20) return res.status(400).json({ error: '用户名长度需 2-20 个字符' })
  if (p.length < 6) return res.status(400).json({ error: '密码至少 6 位' })
  if (!/^[a-zA-Z0-9_]+$/.test(u)) return res.status(400).json({ error: '用户名仅限字母数字下划线' })
  if (db.prepare("SELECT id FROM users WHERE username = ?").get(u)) return res.status(400).json({ error: '用户名已被占用' })

  const hash = bcrypt.hashSync(p, 10)
  const info = db.prepare("INSERT INTO users (username, password_hash, is_admin, created_at) VALUES (?, ?, 0, ?)").run(u, hash, Date.now())
  const userId = info.lastInsertRowid
  const oldUid = req.userId
  if (typeof oldUid === 'string' && oldUid.startsWith('anon_')) {
    db.prepare("UPDATE words SET user_id = ? WHERE user_id = ?").run(userId, oldUid)
    db.prepare("UPDATE records SET user_id = ? WHERE user_id = ?").run(userId, oldUid)
    db.prepare("UPDATE wrongbook SET user_id = ? WHERE user_id = ?").run(userId, oldUid)
    db.prepare("UPDATE settings SET user_id = ? WHERE user_id = ?").run(userId, oldUid)
  }
  const token = genToken()
  db.prepare("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)").run(token, userId, Date.now())
  res.cookie('vt_session', token, { maxAge: 30*24*3600*1000, httpOnly: true, sameSite: 'lax' })
  res.clearCookie('vt_anon')
  res.json({ ok: true, user: { username: u, isAdmin: false } })
})

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {}
  const u = (username || '').trim(), p = password || ''
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(u)
  if (!user || !bcrypt.compareSync(p, user.password_hash)) return res.status(400).json({ error: '用户名或密码错误' })
  const oldUid = req.userId
  if (typeof oldUid === 'string' && oldUid.startsWith('anon_')) {
    db.prepare("UPDATE words SET user_id = ? WHERE user_id = ?").run(user.id, oldUid)
    db.prepare("UPDATE records SET user_id = ? WHERE user_id = ?").run(user.id, oldUid)
    db.prepare("UPDATE wrongbook SET user_id = ? WHERE user_id = ?").run(user.id, oldUid)
    db.prepare("UPDATE settings SET user_id = ? WHERE user_id = ?").run(user.id, oldUid)
  }
  const token = genToken()
  db.prepare("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)").run(token, user.id, Date.now())
  res.cookie('vt_session', token, { maxAge: 30*24*3600*1000, httpOnly: true, sameSite: 'lax' })
  res.clearCookie('vt_anon')
  res.json({ ok: true, user: { username: user.username, isAdmin: !!user.is_admin } })
})

app.post('/api/logout', (req, res) => {
  const token = req.cookies?.vt_session
  if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token)
  res.clearCookie('vt_session')
  res.clearCookie('vt_anon')
  res.json({ ok: true })
})

app.get('/api/me', (req, res) => {
  res.json({ isLoggedIn: !!req.username, username: req.username, isAdmin: req.isAdmin })
})

// ============ 业务 API ============
app.get('/api/state', (req, res) => {
  const uid = req.userId
  const words = db.prepare('SELECT * FROM words WHERE user_id = ? ORDER BY created_at ASC').all(uid).map(rowToWord)
  const records = db.prepare('SELECT * FROM records WHERE user_id = ? ORDER BY ts ASC').all(uid).map((r) => ({
    id: r.id, date: r.date, chinese: r.chinese, english: r.english, pos: r.pos||'', correct: !!r.correct, userAnswer: r.user_answer||'', ts: r.ts,
  }))
  const wrongbook = db.prepare('SELECT * FROM wrongbook WHERE user_id = ? ORDER BY added_at ASC').all(uid).map((w) => ({
    id: String(w.word_id), chinese: w.chinese, english: w.english, pos: w.pos||'', addedAt: w.added_at,
  }))
  res.json({
    words, settings: { masteryThreshold: getThreshold(uid) }, records, wrongbook,
    user: { isLoggedIn: !!req.username, username: req.username, isAdmin: req.isAdmin },
  })
})

app.post('/api/words', (req, res) => {
  const { chinese, english, pos } = req.body || {}
  const c = (chinese||'').trim(), e = (english||'').trim(), p = (pos||'').trim()
  if (!c || !e) return res.status(400).json({ error: '中文和英文不能为空' })
  const info = db.prepare('INSERT INTO words (user_id, chinese, english, pos, count, created_at) VALUES (?, ?, ?, ?, 0, ?)').run(req.userId, c, e, p, Date.now())
  res.json(rowToWord(db.prepare('SELECT * FROM words WHERE id = ?').get(info.lastInsertRowid)))
})

app.put('/api/words/:id', (req, res) => {
  const id = Number(req.params.id)
  const { chinese, english, pos } = req.body || {}
  const c = (chinese||'').trim(), e = (english||'').trim(), p = (pos||'').trim()
  if (!c || !e) return res.status(400).json({ error: '中文和英文不能为空' })
  const info = db.prepare('UPDATE words SET chinese = ?, english = ?, pos = ? WHERE id = ? AND user_id = ?').run(c, e, p, id, req.userId)
  if (!info.changes) return res.status(404).json({ error: '单词不存在' })
  db.prepare('UPDATE wrongbook SET chinese = ?, english = ?, pos = ? WHERE word_id = ? AND user_id = ?').run(c, e, p, String(id), req.userId)
  res.json({ ok: true })
})

app.delete('/api/words/:id', (req, res) => {
  const id = Number(req.params.id)
  db.prepare('DELETE FROM words WHERE id = ? AND user_id = ?').run(id, req.userId)
  db.prepare('DELETE FROM wrongbook WHERE word_id = ? AND user_id = ?').run(String(id), req.userId)
  res.json({ ok: true })
})

app.post('/api/words/:id/increment', (req, res) => {
  db.prepare('UPDATE words SET count = count + 1 WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.userId)
  res.json({ ok: true })
})
app.post('/api/words/:id/reset-count', (req, res) => {
  db.prepare('UPDATE words SET count = 0 WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.userId)
  res.json({ ok: true })
})
app.post('/api/words/reset-all-counts', (req, res) => {
  db.prepare('UPDATE words SET count = 0 WHERE user_id = ?').run(req.userId)
  res.json({ ok: true })
})

app.put('/api/settings/threshold', (req, res) => {
  const t = Number(req.body?.value)
  if (!Number.isFinite(t) || t < 1) return res.status(400).json({ error: '阈值必须是不小于 1 的正整数' })
  db.prepare("INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (?, 'masteryThreshold', ?)").run(req.userId, String(Math.floor(t)))
  res.json({ ok: true, masteryThreshold: Math.floor(t) })
})

app.post('/api/records', (req, res) => {
  const { chinese, english, pos, correct, userAnswer } = req.body || {}
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`
  const id = genId('rec-')
  db.prepare('INSERT INTO records (id, user_id, date, chinese, english, pos, correct, user_answer, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.userId, date, (chinese||'').trim(), (english||'').trim(), (pos||'').trim(), correct?1:0, (userAnswer||'').trim(), Date.now())
  res.json({ ok: true, id })
})
app.delete('/api/records/:date', (req, res) => {
  db.prepare('DELETE FROM records WHERE date = ? AND user_id = ?').run(req.params.date, req.userId)
  res.json({ ok: true })
})
app.delete('/api/records', (req, res) => {
  db.prepare('DELETE FROM records WHERE user_id = ?').run(req.userId)
  res.json({ ok: true })
})

app.post('/api/wrongbook', (req, res) => {
  const { wordId, chinese, english, pos } = req.body || {}
  const id = String(wordId || '')
  if (!id || !chinese || !english) return res.status(400).json({ error: '参数不完整' })
  db.prepare('INSERT OR IGNORE INTO wrongbook (user_id, word_id, chinese, english, pos, added_at) VALUES (?, ?, ?, ?, ?, ?)').run(req.userId, id, chinese, english, pos||'', Date.now())
  res.json({ ok: true })
})
app.delete('/api/wrongbook/:wordId', (req, res) => {
  db.prepare('DELETE FROM wrongbook WHERE word_id = ? AND user_id = ?').run(String(req.params.wordId), req.userId)
  res.json({ ok: true })
})
app.delete('/api/wrongbook', (req, res) => {
  db.prepare('DELETE FROM wrongbook WHERE user_id = ?').run(req.userId)
  res.json({ ok: true })
})

app.get('/api/dict', async (req, res) => {
  const word = (req.query.word || '').trim()
  if (!word) return res.status(400).json({ error: '缺少 word 参数' })
  try {
    const r = await fetch(`https://dict.youdao.com/jsonapi?q=${encodeURIComponent(word)}`, { signal: AbortSignal.timeout(5000) })
    if (!r.ok) return res.status(502).json({ error: '词典服务异常' })
    const data = await r.json()
    const ec = data.ec
    if (!ec || !ec.word || !ec.word.length) return res.status(404).json({ error: '未找到该单词的释义' })
    const w = ec.word[0]
    res.json({
      usphone: w.usphone||'', ukphone: w.ukphone||'', examType: ec.exam_type||[],
      trs: (w.trs||[]).map(t => t.tr[0].l.i[0]),
      wfs: (w.wfs||[]).map(wf => `${wf.wf.name}：${wf.wf.value}`),
    })
  } catch (e) { res.status(502).json({ error: '词典查询超时或失败' }) }
})

app.get('/api/export', (req, res) => {
  const uid = req.userId
  const words = db.prepare('SELECT * FROM words WHERE user_id = ? ORDER BY created_at ASC').all(uid).map(rowToWord)
  const records = db.prepare('SELECT * FROM records WHERE user_id = ? ORDER BY ts ASC').all(uid).map((r) => ({
    id: r.id, date: r.date, chinese: r.chinese, english: r.english, pos: r.pos||'', correct: !!r.correct, userAnswer: r.user_answer||'', ts: r.ts,
  }))
  const wrongbook = db.prepare('SELECT * FROM wrongbook WHERE user_id = ? ORDER BY added_at ASC').all(uid).map((w) => ({
    wordId: String(w.word_id), chinese: w.chinese, english: w.english, pos: w.pos||'', addedAt: w.added_at,
  }))
  res.json({
    app: 'vocab-trainer', version: 2, exportedAt: new Date().toISOString(),
    settings: { masteryThreshold: getThreshold(uid) }, words, records, wrongbook,
  })
})

app.post('/api/import', (req, res) => {
  const { data, mode } = req.body || {}
  if (!data || !Array.isArray(data.words)) return res.status(400).json({ ok:false, reason:'文件格式不正确' })
  const list = data.words.filter(w => w && typeof w === 'object')
  const valid = list.filter(w => String(w.chinese||'').trim() && String(w.english||'').trim())
  if (!valid.length) return res.status(400).json({ ok:false, reason:'文件中没有可导入的单词' })
  const uid = req.userId
  const insertStmt = db.prepare('INSERT INTO words (user_id, chinese, english, pos, count, created_at) VALUES (?, ?, ?, ?, ?, ?)')
  const normalize = (w) => ({
    chinese: String(w.chinese||'').trim(), english: String(w.english||'').trim(), pos: String(w.pos||'').trim(),
    count: Number.isFinite(Number(w.count)) && Number(w.count)>=0 ? Math.floor(Number(w.count)) : 0,
    createdAt: Number.isFinite(Number(w.createdAt)) ? Number(w.createdAt) : Date.now(),
  })
  let imported = 0, skipped = 0
  const tx = db.transaction(() => {
    if (mode === 'overwrite') {
      db.prepare('DELETE FROM words WHERE user_id = ?').run(uid)
      db.prepare('DELETE FROM records WHERE user_id = ?').run(uid)
      db.prepare('DELETE FROM wrongbook WHERE user_id = ?').run(uid)
      for (const w of valid) { const n = normalize(w); insertStmt.run(uid, n.chinese, n.english, n.pos, n.count, n.createdAt); imported++ }
      skipped = list.length - valid.length
      if (Array.isArray(data.records)) {
        const insRec = db.prepare('INSERT OR REPLACE INTO records (id, user_id, date, chinese, english, pos, correct, user_answer, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        for (const r of data.records) {
          insRec.run(String(r.id||genId('rec-')), uid, String(r.date||''), String(r.chinese||'').trim(), String(r.english||'').trim(), String(r.pos||'').trim(), r.correct?1:0, String(r.userAnswer||'').trim(), Number(r.ts)||Date.now())
        }
      }
      if (Array.isArray(data.wrongbook)) {
        const insWrong = db.prepare('INSERT OR REPLACE INTO wrongbook (user_id, word_id, chinese, english, pos, added_at) VALUES (?, ?, ?, ?, ?, ?)')
        for (const w of data.wrongbook) {
          insWrong.run(uid, String(w.wordId||w.word_id||w.id||''), String(w.chinese||'').trim(), String(w.english||'').trim(), String(w.pos||'').trim(), Number(w.addedAt||w.added_at)||Date.now())
        }
      }
    } else {
      const existing = db.prepare('SELECT chinese, english FROM words WHERE user_id = ?').all(uid)
      const setC = new Set(existing.map(r => r.chinese.trim().toLowerCase()))
      const setE = new Set(existing.map(r => r.english.trim().toLowerCase()))
      for (const w of list) {
        const c = String(w.chinese||'').trim(), e = String(w.english||'').trim()
        if (!c || !e) { skipped++; continue }
        if (setC.has(c.toLowerCase()) || setE.has(e.toLowerCase())) { skipped++; continue }
        const n = normalize(w)
        insertStmt.run(uid, n.chinese, n.english, n.pos, n.count, n.createdAt)
        setC.add(n.chinese.toLowerCase()); setE.add(n.english.toLowerCase()); imported++
      }
    }
    if (data.settings && Number.isFinite(Number(data.settings.masteryThreshold))) {
      const t = Number(data.settings.masteryThreshold)
      if (t >= 1) db.prepare("INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (?, 'masteryThreshold', ?)").run(uid, String(Math.floor(t)))
    }
  })
  tx()
  const total = db.prepare('SELECT COUNT(*) AS c FROM words WHERE user_id = ?').get(uid).c
  res.json({ ok: true, imported, skipped, total })
})

// ============ 静态文件 ============
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR))
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(join(DIST_DIR, 'index.html')))
}

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`✅ Vocab Trainer running at http://localhost:${PORT}`))
