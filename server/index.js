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
  return { id: String(row.id), chinese: row.chinese, english: row.english, pos: row.pos || '', count: row.count || 0, createdAt: row.created_at, caseSensitive: !!row.case_sensitive }
}
function getThreshold(uid) {
  const row = db.prepare("SELECT value FROM settings WHERE user_id = ? AND key = 'masteryThreshold'").get(uid)
  const t = Number(row?.value)
  return Number.isFinite(t) && t >= 1 ? Math.floor(t) : 5
}
function getClientIp(req) {
  return (req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim()
}
function logUser(userId, username, action, ip, detail = '') {
  try {
    db.prepare("INSERT INTO user_logs (user_id, username, action, ip, detail, ts) VALUES (?, ?, ?, ?, ?, ?)")
      .run(userId, username, action, ip || '', detail, Date.now())
  } catch (e) {}
}

// 中间件：解析当前用户
function auth(req, res, next) {
  const token = req.cookies?.vt_session
  let userId = null, username = null, isAdmin = false

  if (token) {
    const sess = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token)
    if (sess) {
      const u = db.prepare("SELECT * FROM users WHERE id = ?").get(sess.user_id)
      if (u && !u.is_disabled) { userId = u.id; username = u.username; isAdmin = !!u.is_admin }
    }
  }

  if (!userId) {
    const anon = req.cookies?.vt_anon
    const ip = getClientIp(req)
    if (anon && /^anon_[a-z0-9]+$/.test(anon)) {
      userId = anon
      // 已有访客：更新 IP 和访问时间
      try {
        db.prepare("INSERT OR REPLACE INTO guest_meta (user_id, last_ip, last_visit) VALUES (?, ?, ?)")
          .run(userId, ip, Date.now())
      } catch (e) {}
    } else {
      userId = 'anon_' + crypto.randomBytes(8).toString('hex')
      res.cookie('vt_anon', userId, { maxAge: 365*24*3600*1000, httpOnly: true, sameSite: 'lax' })
      // 新访客：记录 IP 和首次访问日志
      try {
        db.prepare("INSERT OR REPLACE INTO guest_meta (user_id, last_ip, last_visit) VALUES (?, ?, ?)")
          .run(userId, ip, Date.now())
        logUser(userId, '访客', 'visit', ip)
      } catch (e) {}
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
  const ip = getClientIp(req)
  db.prepare("UPDATE users SET last_login_at = ?, last_login_ip = ? WHERE id = ?").run(Date.now(), ip, userId)
  logUser(userId, u, 'register', ip, '注册并登录')
  res.json({ ok: true, user: { username: u, isAdmin: false } })
})

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {}
  const u = (username || '').trim(), p = password || ''
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(u)
  if (!user || !bcrypt.compareSync(p, user.password_hash)) return res.status(400).json({ error: '用户名或密码错误' })
  if (user.is_disabled) return res.status(403).json({ error: '该账号已被禁用，请联系管理员' })
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
  const ip = getClientIp(req)
  db.prepare("UPDATE users SET last_login_at = ?, last_login_ip = ? WHERE id = ?").run(Date.now(), ip, user.id)
  logUser(user.id, user.username, 'login', ip)
  res.json({ ok: true, user: { username: user.username, isAdmin: !!user.is_admin } })
})

app.post('/api/logout', (req, res) => {
  const token = req.cookies?.vt_session
  if (token) {
    const sess = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token)
    if (sess) {
      const u = db.prepare("SELECT username FROM users WHERE id = ?").get(sess.user_id)
      logUser(sess.user_id, u?.username || '', 'logout', getClientIp(req))
    }
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token)
  }
  res.clearCookie('vt_session')
  res.clearCookie('vt_anon')
  res.json({ ok: true })
})

// 修改密码
app.put('/api/me/password', (req, res) => {
  if (!req.username) return res.status(401).json({ error: '请先登录' })
  const { oldPassword, newPassword } = req.body || {}
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(req.username)
  if (!user || !bcrypt.compareSync(oldPassword || '', user.password_hash)) {
    return res.status(400).json({ error: '原密码错误' })
  }
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: '新密码至少 6 位' })
  const hash = bcrypt.hashSync(newPassword, 10)
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, user.id)
  logUser(user.id, user.username, 'change_password', getClientIp(req))
  res.json({ ok: true })
})

// 管理员：查看所有用户
app.get('/api/admin/users', (req, res) => {
  if (!req.isAdmin) return res.status(403).json({ error: '需要管理员权限' })
  // 注册用户
  const registered = db.prepare(`
    SELECT u.id, u.username, u.is_admin, u.is_disabled, u.last_login_at, u.last_login_ip, u.created_at,
      (SELECT COUNT(*) FROM words WHERE user_id = u.id) as word_count,
      (SELECT MAX(ts) FROM user_logs WHERE user_id = u.id) as last_active
    FROM users u ORDER BY u.created_at DESC
  `).all().map(u => ({
    id: u.id, username: u.username, isAdmin: !!u.is_admin, isDisabled: !!u.is_disabled,
    lastLoginAt: u.last_login_at, lastLoginIp: u.last_login_ip || '', createdAt: u.created_at,
    wordCount: u.word_count, lastActive: u.last_active || 0, isGuest: false,
  }))
  // 访客用户（user_id 是 anon_ 开头的字符串）：按 user_id 分组
  const guestRows = db.prepare(`
    SELECT w.user_id, COUNT(*) as word_count, MIN(w.created_at) as created_at, MAX(w.created_at) as last_active,
      g.last_ip
    FROM words w LEFT JOIN guest_meta g ON w.user_id = g.user_id
    WHERE typeof(w.user_id) = 'text' AND w.user_id LIKE 'anon_%'
    GROUP BY w.user_id
  `).all()
  const guests = guestRows.map((g, i) => ({
    id: -1000 - i,
    username: '访客-' + (g.user_id || '').slice(-6),
    isAdmin: false,
    isDisabled: false,
    lastLoginAt: g.last_active,
    lastLoginIp: g.last_ip || '',
    createdAt: g.created_at,
    wordCount: g.word_count,
    lastActive: g.last_active,
    isGuest: true,
  }))
  const users = [...registered, ...guests].sort((a, b) => (b.lastActive || b.createdAt) - (a.lastActive || a.createdAt))
  res.json({ users })
})

// 管理员：查看用户登录日志
app.get('/api/admin/users/:id/logs', (req, res) => {
  if (!req.isAdmin) return res.status(403).json({ error: '需要管理员权限' })
  const logs = db.prepare("SELECT * FROM user_logs WHERE user_id = ? ORDER BY ts DESC LIMIT 50").all(req.params.id)
  res.json({ logs })
})

// 管理员：重置用户密码
app.put('/api/admin/users/:id/password', (req, res) => {
  if (!req.isAdmin) return res.status(403).json({ error: '需要管理员权限' })
  const id = Number(req.params.id)
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id)
  if (!user) return res.status(404).json({ error: '用户不存在' })
  if (user.is_admin) return res.status(400).json({ error: '不能修改管理员密码' })
  const newPass = Math.random().toString(36).slice(-8)
  const hash = bcrypt.hashSync(newPass, 10)
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, id)
  logUser(id, user.username, 'admin_reset_password', getClientIp(req), `管理员 ${req.username} 重置了密码`)
  res.json({ ok: true, newPassword: newPass })
})

// 管理员：禁用/启用用户
app.put('/api/admin/users/:id/disable', (req, res) => {
  if (!req.isAdmin) return res.status(403).json({ error: '需要管理员权限' })
  const id = Number(req.params.id)
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id)
  if (!user) return res.status(404).json({ error: '用户不存在' })
  if (user.is_admin) return res.status(400).json({ error: '不能禁用管理员' })
  const newVal = user.is_disabled ? 0 : 1
  db.prepare("UPDATE users SET is_disabled = ? WHERE id = ?").run(newVal, id)
  logUser(id, user.username, newVal ? 'admin_disable' : 'admin_enable', getClientIp(req))
  res.json({ ok: true, isDisabled: !!newVal })
})

// 管理员：删除用户
app.delete('/api/admin/users/:id', (req, res) => {
  if (!req.isAdmin) return res.status(403).json({ error: '需要管理员权限' })
  const id = Number(req.params.id)
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id)
  if (!user) return res.status(404).json({ error: '用户不存在' })
  if (user.is_admin) return res.status(400).json({ error: '不能删除管理员' })
  db.prepare("DELETE FROM words WHERE user_id = ?").run(id)
  db.prepare("DELETE FROM records WHERE user_id = ?").run(id)
  db.prepare("DELETE FROM wrongbook WHERE user_id = ?").run(id)
  db.prepare("DELETE FROM settings WHERE user_id = ?").run(id)
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id)
  db.prepare("DELETE FROM users WHERE id = ?").run(id)
  logUser(null, user.username, 'admin_delete', getClientIp(req), `管理员 ${req.username} 删除了该用户`)
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
  const { chinese, english, pos, caseSensitive } = req.body || {}
  const c = (chinese||'').trim(), e = (english||'').trim(), p = (pos||'').trim()
  if (!c || !e) return res.status(400).json({ error: '中文和英文不能为空' })
  const info = db.prepare('INSERT INTO words (user_id, chinese, english, pos, count, created_at, case_sensitive) VALUES (?, ?, ?, ?, 0, ?, ?)').run(req.userId, c, e, p, Date.now(), caseSensitive ? 1 : 0)
  res.json(rowToWord(db.prepare('SELECT * FROM words WHERE id = ?').get(info.lastInsertRowid)))
})

app.put('/api/words/:id', (req, res) => {
  const id = Number(req.params.id)
  const { chinese, english, pos, caseSensitive } = req.body || {}
  const c = (chinese||'').trim(), e = (english||'').trim(), p = (pos||'').trim()
  if (!c || !e) return res.status(400).json({ error: '中文和英文不能为空' })
  const info = db.prepare('UPDATE words SET chinese = ?, english = ?, pos = ?, case_sensitive = ? WHERE id = ? AND user_id = ?').run(c, e, p, caseSensitive ? 1 : 0, id, req.userId)
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

// ============ 建议反馈 ============
app.post('/api/feedback', (req, res) => {
  const { content, contact } = req.body || {}
  const c = (content || '').trim()
  if (!c) return res.status(400).json({ error: '反馈内容不能为空' })
  db.prepare('INSERT INTO feedbacks (user_id, username, content, contact, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(req.userId, req.username || '访客', c, (contact || '').trim(), Date.now())
  res.json({ ok: true })
})

app.get('/api/admin/feedbacks', (req, res) => {
  if (!req.isAdmin) return res.status(403).json({ error: '需要管理员权限' })
  const list = db.prepare('SELECT * FROM feedbacks ORDER BY created_at DESC').all()
  res.json({ feedbacks: list })
})

// ============ 静态文件 ============
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR))
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(join(DIST_DIR, 'index.html')))
}

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`✅ Vocab Trainer running at http://localhost:${PORT}`))
