import express from 'express'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import fs from 'fs'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import cookieParser from 'cookie-parser'
import { createRequire } from 'module'
import WebSocket from 'ws'
import db from './db.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const req = createRequire(import.meta.url)
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
const ttsCache = new Map()
function genId(prefix = '') { return `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
function rowToWord(row) {
  return { id: String(row.id), chinese: row.chinese, english: row.english, pos: row.pos || '', type: row.type || 'word', count: row.count || 0, createdAt: row.created_at, caseSensitive: !!row.case_sensitive }
}
function getThreshold(uid) {
  const row = db.prepare("SELECT value FROM settings WHERE user_id = ? AND key = 'masteryThreshold'").get(uid)
  const t = Number(row?.value)
  return Number.isFinite(t) && t >= 1 ? Math.floor(t) : 5
}
// 答对自动下一题：默认开启
function getAutoNext(uid) {
  const row = db.prepare("SELECT value FROM settings WHERE user_id = ? AND key = 'autoNext'").get(uid)
  return row?.value !== '0'
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
    db.prepare("UPDATE groups SET user_id = ? WHERE user_id = ?").run(userId, oldUid)
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
    db.prepare("UPDATE groups SET user_id = ? WHERE user_id = ?").run(user.id, oldUid)
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
  const wids = db.prepare("SELECT id FROM words WHERE user_id = ?").all(id).map((r) => r.id)
  if (wids.length) db.prepare(`DELETE FROM word_groups WHERE word_id IN (${wids.map(() => '?').join(',')})`).run(...wids)
  db.prepare("DELETE FROM words WHERE user_id = ?").run(id)
  db.prepare("DELETE FROM groups WHERE user_id = ?").run(id)
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
function getWordGroupMap(uid) {
  // 该用户所有词的组归属：word_id -> group_id
  const map = {}
  const rows = db.prepare(`
    SELECT wg.word_id, wg.group_id FROM word_groups wg
    JOIN words w ON w.id = wg.word_id AND w.user_id = ?
  `).all(uid)
  for (const r of rows) map[r.word_id] = r.group_id
  return map
}

app.get('/api/state', (req, res) => {
  const uid = req.userId
  const groupMap = getWordGroupMap(uid)
  const words = db.prepare('SELECT * FROM words WHERE user_id = ? ORDER BY created_at ASC').all(uid).map((row) => {
    const w = rowToWord(row)
    w.groupId = groupMap[row.id] || null
    return w
  })
  const records = db.prepare('SELECT * FROM records WHERE user_id = ? ORDER BY ts ASC').all(uid).map((r) => ({
    id: r.id, date: r.date, chinese: r.chinese, english: r.english, pos: r.pos||'', type: r.type||'word', correct: !!r.correct, userAnswer: r.user_answer||'', ts: r.ts,
  }))
  const wrongbook = db.prepare('SELECT * FROM wrongbook WHERE user_id = ? ORDER BY added_at ASC').all(uid).map((w) => ({
    id: String(w.word_id), chinese: w.chinese, english: w.english, pos: w.pos||'', addedAt: w.added_at,
  }))
  res.json({
    words, settings: { masteryThreshold: getThreshold(uid), autoNext: getAutoNext(uid) }, records, wrongbook,
    user: { isLoggedIn: !!req.username, username: req.username, isAdmin: req.isAdmin },
  })
})

// ============ 分组 API ============
// 读取分组配置（含每组实际数量与已背熟数）
app.get('/api/groups', (req, res) => {
  const uid = req.userId
  const threshold = getThreshold(uid)
  const groups = db.prepare('SELECT * FROM groups WHERE user_id = ? ORDER BY seq ASC, id ASC').all(uid).map((g) => {
    const size = db.prepare('SELECT COUNT(*) c FROM word_groups wg JOIN words w ON w.id = wg.word_id WHERE wg.group_id = ? AND w.user_id = ?').get(g.id, uid).c
    const mastered = db.prepare('SELECT COUNT(*) c FROM word_groups wg JOIN words w ON w.id = wg.word_id WHERE wg.group_id = ? AND w.user_id = ? AND w.count >= ?').get(g.id, uid, threshold).c
    return { id: g.id, name: g.name, seq: g.seq, size, mastered }
  })
  const total = db.prepare('SELECT COUNT(*) c FROM words WHERE user_id = ?').get(uid).c
  res.json({ groups, total, threshold })
})

// 保存分组配置：至少 1 组；Σ数量 = 当前词库总数；按目标数量随机分配（尽量保留已有归属）
app.post('/api/groups/save', (req, res) => {
  const uid = req.userId
  const list = (req.body?.groups || []).filter((g) => g && typeof g === 'object')
  const total = db.prepare('SELECT COUNT(*) c FROM words WHERE user_id = ?').get(uid).c
  // 校验
  if (!list.length) return res.status(400).json({ error: '至少需要保留一个分组' })
  const sum = list.reduce((a, g) => a + (Number.isFinite(Number(g.size)) ? Math.floor(Number(g.size)) : NaN), 0)
  if (!Number.isFinite(sum)) return res.status(400).json({ error: '分组数量必须是正整数' })
  if (sum !== total) return res.status(400).json({ error: `所有分组数量之和(${sum})必须等于词句总数(${total})` })
  for (const g of list) {
    if (!String(g.name || '').trim()) return res.status(400).json({ error: '分组名称不能为空' })
    const s = Number(g.size)
    if (!Number.isFinite(s) || s < 0 || Math.floor(s) !== s) return res.status(400).json({ error: '分组数量必须是正整数' })
  }

  const tx = db.transaction(() => {
    const oldGroups = db.prepare('SELECT * FROM groups WHERE user_id = ?').all(uid)
    const oldIds = oldGroups.map((g) => g.id)
    const newIds = []
    list.forEach((g, i) => {
      const name = String(g.name).trim()
      if (g.id && oldIds.includes(Number(g.id))) {
        db.prepare('UPDATE groups SET name = ?, seq = ? WHERE id = ? AND user_id = ?').run(name, i + 1, Number(g.id), uid)
        newIds.push(Number(g.id))
      } else {
        const r = db.prepare('INSERT INTO groups (user_id, name, seq, created_at) VALUES (?, ?, ?, ?)').run(uid, name, i + 1, Date.now())
        newIds.push(Number(r.lastInsertRowid))
      }
    })
    // 被删组的 id（其词进入待分配池）
    const removedIds = oldIds.filter((id) => !newIds.includes(id))

    const allWords = db.prepare('SELECT id FROM words WHERE user_id = ?').all(uid).map((w) => w.id)
    const wordSet = new Set(allWords)
    const target = list.map((g, i) => ({ id: newIds[i], size: Math.floor(Number(g.size)) }))

    // 已有归属：保留仍在词库且组仍存在的词
    const assign = new Map() // word_id -> group_id
    const groupCount = new Map() // group_id -> 已分配数
    const pool = []
    const poolSet = new Set()
    const pushPool = (wid) => {
      if (!poolSet.has(wid)) {
        poolSet.add(wid)
        pool.push(wid)
      }
    }
    const inClause = oldIds.length ? oldIds.map(() => '?').join(',') : '0'
    const existing = oldIds.length
      ? db.prepare(`SELECT word_id, group_id FROM word_groups WHERE group_id IN (${inClause})`).all(...oldIds)
      : []
    for (const row of existing) {
      if (!wordSet.has(row.word_id)) continue
      if (newIds.includes(row.group_id)) {
        assign.set(row.word_id, row.group_id)
        groupCount.set(row.group_id, (groupCount.get(row.group_id) || 0) + 1)
      } else {
        pushPool(row.word_id) // 被删组的词进池
      }
    }
    // 未分配词进池（池已去重，避免重复词导致覆盖）
    for (const w of allWords) if (!assign.has(w)) pushPool(w)

    // 超出目标数量的组：多出的词移入池
    for (const g of target) {
      const cnt = groupCount.get(g.id) || 0
      if (cnt > g.size) {
        const members = [...assign.entries()].filter(([, gid]) => gid === g.id).map(([wid]) => wid)
        shuffle(members)
        for (let i = 0; i < cnt - g.size; i++) {
          const w = members[i]
          assign.delete(w)
          pushPool(w)
        }
        groupCount.set(g.id, g.size)
      }
    }

    // 按配置顺序补足；池优先，池空则从富余组借
    shuffle(pool)
    let pi = 0
    const membersOf = (gid) => [...assign.entries()].filter(([, g]) => g === gid).map(([wid]) => wid)
    for (const g of target) {
      let need = g.size - (groupCount.get(g.id) || 0)
      while (need > 0) {
        let w = null
        if (pi < pool.length) {
          w = pool[pi++]
        } else {
          // 从词数最多的其他组随机借一个
          let best = null
          for (const tg of target) {
            const m = membersOf(tg.id)
            if (m.length > (tg.size || 0)) {
              if (!best || m.length - tg.size > best.over) best = { id: tg.id, over: m.length - tg.size }
            }
          }
          if (best) {
            const m = membersOf(best.id)
            w = m[Math.floor(Math.random() * m.length)]
          }
        }
        if (w == null) break
        assign.set(w, g.id)
        need--
      }
    }

    // 写库
    if (oldIds.length) db.prepare(`DELETE FROM word_groups WHERE group_id IN (${inClause})`).run(...oldIds)
    for (const rid of removedIds) db.prepare('DELETE FROM groups WHERE id = ? AND user_id = ?').run(rid, uid)
    const ins = db.prepare('INSERT OR REPLACE INTO word_groups (word_id, group_id) VALUES (?, ?)')
    for (const [wid, gid] of assign) ins.run(wid, gid)
  })
  tx()

  const threshold = getThreshold(uid)
  const groups = db.prepare('SELECT * FROM groups WHERE user_id = ? ORDER BY seq ASC, id ASC').all(uid).map((g) => {
    const size = db.prepare('SELECT COUNT(*) c FROM word_groups wg JOIN words w ON w.id = wg.word_id WHERE wg.group_id = ? AND w.user_id = ?').get(g.id, uid).c
    const mastered = db.prepare('SELECT COUNT(*) c FROM word_groups wg JOIN words w ON w.id = wg.word_id WHERE wg.group_id = ? AND w.user_id = ? AND w.count >= ?').get(g.id, uid, threshold).c
    return { id: g.id, name: g.name, seq: g.seq, size, mastered }
  })
  res.json({ ok: true, groups, total })
})

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// 重新分配：保持各组序号/名称/数量不变，把词库词句完全打散随机重新分到各组
app.post('/api/groups/reshuffle', (req, res) => {
  const uid = req.userId
  const threshold = getThreshold(uid)
  const groups = db.prepare('SELECT id, name, seq FROM groups WHERE user_id = ? ORDER BY seq ASC, id ASC').all(uid)
  if (!groups.length) return res.json({ ok: true, groups: [], total: 0 })

  // 各组当前实时数量（口径与 /api/groups 一致）
  const sizeOf = (gid) =>
    db.prepare('SELECT COUNT(*) c FROM word_groups wg JOIN words w ON w.id = wg.word_id WHERE wg.group_id = ? AND w.user_id = ?').get(gid, uid).c
  const targets = groups.map((g) => sizeOf(g.id))

  const wordIds = db.prepare('SELECT id FROM words WHERE user_id = ?').all(uid).map((w) => w.id)
  const total = wordIds.length
  if (!total) {
    return res.json({ ok: true, groups: groups.map((g) => ({ id: g.id, name: g.name, seq: g.seq, size: 0, mastered: 0 })), total: 0 })
  }

  // 兜底：组数量总和与词库总数不一致时（如未入组的新词），按比例补齐到总数
  const sum = targets.reduce((a, b) => a + b, 0)
  if (sum !== total) {
    for (let i = 0; i < total; i++) targets[i % targets.length]++
    // 削平超出：从最大组逐个减到总数为 total
    while (targets.reduce((a, b) => a + b, 0) > total) {
      let mi = 0
      for (let i = 1; i < targets.length; i++) if (targets[i] > targets[mi]) mi = i
      targets[mi]--
    }
  }

  shuffle(wordIds)
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM word_groups WHERE group_id IN (SELECT id FROM groups WHERE user_id = ?)').run(uid)
    const ins = db.prepare('INSERT OR REPLACE INTO word_groups (word_id, group_id) VALUES (?, ?)')
    let idx = 0
    for (let gi = 0; gi < groups.length; gi++) {
      for (let k = 0; k < targets[gi]; k++) ins.run(wordIds[idx++], groups[gi].id)
    }
  })
  tx()

  const result = groups.map((g) => {
    const size = sizeOf(g.id)
    const mastered = db
      .prepare('SELECT COUNT(*) c FROM word_groups wg JOIN words w ON w.id = wg.word_id WHERE wg.group_id = ? AND w.user_id = ? AND w.count >= ?')
      .get(g.id, uid, threshold).c
    return { id: g.id, name: g.name, seq: g.seq, size, mastered }
  })
  res.json({ ok: true, groups: result, total })
})

// 新词自动分到数量最少的组（用户无分组时不入组）
function assignWordToSmallestGroup(uid, wordId) {
  const g = db.prepare(`
    SELECT g.id FROM groups g
    LEFT JOIN word_groups wg ON wg.group_id = g.id
    WHERE g.user_id = ?
    GROUP BY g.id
    ORDER BY COUNT(wg.word_id) ASC, g.id ASC LIMIT 1
  `).get(uid)
  if (g) db.prepare('INSERT OR IGNORE INTO word_groups (word_id, group_id) VALUES (?, ?)').run(wordId, g.id)
}

app.post('/api/words', (req, res) => {
  const { chinese, english, pos, type, caseSensitive } = req.body || {}
  const c = (chinese||'').trim(), e = (english||'').trim(), p = (pos||'').trim()
  const t = ['word', 'phrase', 'sentence'].includes(type) ? type : 'word'
  if (!c || !e) return res.status(400).json({ error: '中文和英文不能为空' })
  const info = db.prepare('INSERT INTO words (user_id, chinese, english, pos, type, count, created_at, case_sensitive) VALUES (?, ?, ?, ?, ?, 0, ?, ?)').run(req.userId, c, e, p, t, Date.now(), caseSensitive ? 1 : 0)
  const word = rowToWord(db.prepare('SELECT * FROM words WHERE id = ?').get(info.lastInsertRowid))
  assignWordToSmallestGroup(req.userId, info.lastInsertRowid)
  word.groupId = db.prepare('SELECT group_id FROM word_groups WHERE word_id = ?').get(info.lastInsertRowid)?.group_id || null
  res.json(word)
})

app.put('/api/words/:id', (req, res) => {
  const id = Number(req.params.id)
  const { chinese, english, pos, type, caseSensitive } = req.body || {}
  const c = (chinese||'').trim(), e = (english||'').trim(), p = (pos||'').trim()
  const t = ['word', 'phrase', 'sentence'].includes(type) ? type : 'word'
  if (!c || !e) return res.status(400).json({ error: '中文和英文不能为空' })
  const info = db.prepare('UPDATE words SET chinese = ?, english = ?, pos = ?, type = ?, case_sensitive = ? WHERE id = ? AND user_id = ?').run(c, e, p, t, caseSensitive ? 1 : 0, id, req.userId)
  if (!info.changes) return res.status(404).json({ error: '单词不存在' })
  db.prepare('UPDATE wrongbook SET chinese = ?, english = ?, pos = ? WHERE word_id = ? AND user_id = ?').run(c, e, p, String(id), req.userId)
  res.json({ ok: true })
})

app.delete('/api/words/:id', (req, res) => {
  const id = Number(req.params.id)
  db.prepare('DELETE FROM words WHERE id = ? AND user_id = ?').run(id, req.userId)
  db.prepare('DELETE FROM wrongbook WHERE word_id = ? AND user_id = ?').run(String(id), req.userId)
  db.prepare('DELETE FROM word_groups WHERE word_id = ?').run(id)
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

// 答对自动下一题开关
app.put('/api/settings/autoNext', (req, res) => {
  const v = req.body?.value
  db.prepare("INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (?, 'autoNext', ?)").run(req.userId, v ? '1' : '0')
  res.json({ ok: true, autoNext: !!v })
})

app.post('/api/records', (req, res) => {
  const { chinese, english, pos, correct, userAnswer, type } = req.body || {}
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`
  const id = genId('rec-')
  db.prepare('INSERT INTO records (id, user_id, date, chinese, english, pos, correct, user_answer, type, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.userId, date, (chinese||'').trim(), (english||'').trim(), (pos||'').trim(), correct?1:0, (userAnswer||'').trim(), (type||'word').trim() || 'word', Date.now())
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

// 百度翻译开放平台（整句翻译）
const BAIDU_APPID = '20261010002698344'
const BAIDU_KEY = 'rZ9HkdaEImD2KGoVLeCV'

// ============ AI 日常用法（DeepSeek，key 存于 config.js 不入库） ============
let DEEPSEEK_KEY = ''
let BYTEDANCE_TTS_KEY = ''
try {
  const cfg = req('./config.cjs')
  DEEPSEEK_KEY = cfg.DEEPSEEK_KEY || ''
  BYTEDANCE_TTS_KEY = cfg.BYTEDANCE_TTS_KEY || ''
} catch (e) { console.error('config load fail:', e.message) }
const usagePending = new Map() // 并发锁：同词同时查询只调一次 AI

app.get('/api/usage', async (req, res) => {
  const word = String(req.query.word || '').trim().slice(0, 200)
  const type = String(req.query.type || 'word').slice(0, 10)
  if (!word) return res.status(400).json({ error: '缺少单词' })
  // 缓存命中直接返回
  const cached = db.prepare('SELECT content FROM usage_cache WHERE word = ?').get(word)
  if (cached) return res.json({ word, usage: cached.content })
  if (!DEEPSEEK_KEY) return res.status(503).json({ error: 'AI 未配置' })
  // 同词并发：复用进行中的请求
  if (usagePending.has(word)) {
    try {
      const usage = await usagePending.get(word)
      return res.json({ word, usage })
    } catch (e) {
      return res.status(502).json({ error: e.message || 'AI 查询失败' })
    }
  }
  // 提示词：句子用句子版（400 字内），单词/短语用通用版（300 字内）
  const sysPrompt = type === 'sentence'
    ? '你是一位英语学习助手。请用简体中文讲解一个英语句子的含义和用法，格式如下：1. 整句意思（中文翻译）；2. 结构拆解（简要说明句型、时态、关键搭配或短语，适合初中生理解）；3. 使用场景（这句话通常用在什么场合，1-2 句话）。控制在400字以内，语言自然口语化。不要使用任何 Markdown 符号（如 *、#、- 等）。'
    : '你是一位英语学习助手。请用简体中文解释一个英语单词或短语在日常生活中的用法，格式如下：1. 核心含义（一句话）；2. 常见用法/搭配（2-3条，每条一行）；3. 三个日常生活例句（英文+中文翻译）。控制在300字以内，语言自然口语化。不要使用任何 Markdown 符号（如 *、#、- 等）。'
  const task = (async () => {
    const r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEEPSEEK_KEY}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: word },
        ],
        temperature: 0.7,
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(15000),
    })
    const j = await r.json()
    const usage = j?.choices?.[0]?.message?.content
    if (!usage) throw new Error(j?.error?.message || 'AI 返回为空')
    db.prepare('INSERT OR REPLACE INTO usage_cache (word, content, created_at) VALUES (?, ?, ?)').run(word, usage, Date.now())
    return usage
  })()
  usagePending.set(word, task)
  try {
    const usage = await task
    res.json({ word, usage })
  } catch (e) {
    res.status(502).json({ error: e.message || 'AI 查询失败' })
  } finally {
    usagePending.delete(word)
  }
})

async function baiduTranslate(text) {
  const q = String(text || '').trim().slice(0, 2000)
  if (!q) return null
  const salt = String(Math.floor(Math.random() * 1e9))
  const sign = crypto.createHash('md5').update(BAIDU_APPID + q + salt + BAIDU_KEY).digest('hex')
  const url = `https://fanyi-api.baidu.com/api/trans/vip/translate?q=${encodeURIComponent(q)}&from=auto&to=zh&appid=${BAIDU_APPID}&salt=${salt}&sign=${sign}`
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (!r.ok) return null
    const j = await r.json()
    if (j.error_code) return null
    const dst = (j.trans_result || []).map((x) => x.dst || '').join('')
    return dst || null
  } catch (e) { return null }
}

app.get('/api/dict', async (req, res) => {
  const word = (req.query.word || '').trim()
  if (!word) return res.status(400).json({ error: '缺少 word 参数' })
  // 1) 有道词典（单词/短语详情）
  try {
    const r = await fetch(`https://dict.youdao.com/jsonapi?q=${encodeURIComponent(word)}`, { signal: AbortSignal.timeout(6000) })
    if (r.ok) {
      const data = await r.json()
      const ec = data.ec
      if (ec && ec.word && ec.word.length) {
        const w = ec.word[0]
        // 双语例句（blng_sents_part / media_sents_part 兜底）
        let sentences = []
        const blng = data.blng_sents_part
        if (blng && Array.isArray(blng['sentence-pair'])) {
          sentences = blng['sentence-pair'].map((s) => ({
            en: String(s.sentence || s['sentence-eng'] || '').trim(),
            zh: String(s['sentence-translation'] || '').trim(),
          })).filter((s) => s.en)
        }
        if (!sentences.length && data.media_sents_part && Array.isArray(data.media_sents_part['sentence-pair'])) {
          sentences = data.media_sents_part['sentence-pair'].map((s) => ({
            en: String(s.sentence || s['sentence-eng'] || '').trim(),
            zh: String(s['sentence-translation'] || '').trim(),
          })).filter((s) => s.en)
        }
        return res.json({
          usphone: w.usphone||'', ukphone: w.ukphone||'', examType: ec.exam_type||[],
          trs: (w.trs||[]).map(t => t.tr[0].l.i[0]),
          wfs: (w.wfs||[]).map(wf => `${wf.wf.name}：${wf.wf.value}`),
          sentences: sentences.slice(0, 5),
        })
      }
    }
  } catch (e) { /* 有道失败则走翻译 */ }
  // 2) 回退：百度翻译（整句/短语翻译）
  const translation = await baiduTranslate(word)
  if (translation) return res.json({ translation })
  res.status(404).json({ error: '未找到该内容的释义或翻译' })
})

app.get('/api/tts', async (req, res) => {
  const text = String(req.query.text || '').trim().slice(0, 300)
  if (!text) return res.status(400).json({ error: '缺少 text 参数' })
  const cached = ttsCache.get(text)
  if (cached) {
    res.set('Content-Type', 'audio/mpeg')
    res.set('Cache-Control', 'public, max-age=86400')
    return res.send(cached)
  }
  let buf = null
  // 单词/短语（词数≤6 且非句末标点）走百度：标准词典音、平实无语气；句子走豆包：自然语气
  const isSentence = /[.?!]["'\u201d]?\s*$/.test(text) || text.split(/\s+/).length > 6
  if (isSentence) {
    // 1) 豆包语音合成（seed-tts-2.0 双向流式，低时延、音色自然）
    if (BYTEDANCE_TTS_KEY) {
      try { buf = await volcTts(text) } catch (e) { console.error('豆包流式 TTS 失败:', e.message) }
    }
    // 2) 兜底：百度翻译发音
    if (!buf) buf = await baiduTts(text)
  } else {
    // 单词/短语：百度优先（平实），豆包兜底
    buf = await baiduTts(text)
    if (!buf && BYTEDANCE_TTS_KEY) {
      try { buf = await volcTts(text) } catch (e) { console.error('豆包流式 TTS 失败:', e.message) }
    }
  }
  if (!buf) return res.status(502).json({ error: 'TTS 未生成音频' })
  if (ttsCache.size > 2000) ttsCache.clear()
  ttsCache.set(text, buf)
  res.set('Content-Type', 'audio/mpeg')
  res.set('Cache-Control', 'public, max-age=86400')
  res.send(buf)
})

async function baiduTts(text) {
  try {
    const url = `https://fanyi.baidu.com/gettts?lan=en&text=${encodeURIComponent(text)}&spd=3&source=web`
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(8000),
    })
    if (r.ok) {
      const audio = Buffer.from(await r.arrayBuffer())
      if (audio.length >= 1000) return audio
    }
  } catch (e) {
    console.error('百度 TTS 失败:', e.message)
  }
  return null
}

// ===== 豆包语音合成（seed-tts-2.0 双向流式 WebSocket）=====
const VOLC_EV = { START_CONNECTION: 1, FINISH_CONNECTION: 2, CONNECTION_STARTED: 50, CONNECTION_FAILED: 51, CONNECTION_FINISHED: 52, START_SESSION: 100, FINISH_SESSION: 102, SESSION_STARTED: 150, SESSION_FINISHED: 152, SESSION_FAILED: 153, TASK_REQUEST: 200, TTS_RESPONSE: 352 }
function volcFrame(event, sessionId, payload) {
  const head = Buffer.from([0b00010001, 0b00010100, 0b00010000, 0])
  const ev = Buffer.alloc(4); ev.writeUInt32BE(event)
  const parts = [head, ev]
  if (sessionId != null) {
    const sid = Buffer.from(sessionId)
    const l = Buffer.alloc(4); l.writeUInt32BE(sid.length)
    parts.push(l, sid)
  }
  const p = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || '{}')
  const pl = Buffer.alloc(4); pl.writeUInt32BE(p.length)
  parts.push(pl, p)
  return Buffer.concat(parts)
}
function volcParse(buf) {
  const headerSize = (buf[0] & 0x0F) * 4
  const messageType = buf[1] >> 4
  const flags = buf[1] & 0x0F
  const event = buf.readUInt32BE(4)
  let pos = headerSize
  if (flags & 0x04) pos += 4
  let sessionId = null
  if ([1, 9, 11].includes(messageType)) {
    const sl = buf.readUInt32BE(pos); pos += 4
    sessionId = buf.subarray(pos, pos + sl).toString(); pos += sl
  }
  const pl = buf.readUInt32BE(pos); pos += 4
  return { event, sessionId, payload: buf.subarray(pos, pos + pl) }
}
async function volcTts(text) {
  return await new Promise((resolve, reject) => {
    const sid = crypto.randomUUID()
    const chunks = []
    let settled = false
    const done = (err, buf) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { ws.terminate() } catch (e) {}
      err ? reject(err) : resolve(buf)
    }
    const timer = setTimeout(() => done(new Error('火山 TTS 超时')), 25000)
    let ws
    try {
      ws = new WebSocket('wss://openspeech.bytedance.com/api/v3/tts/bidirection', {
        headers: { 'X-Api-Key': BYTEDANCE_TTS_KEY, 'X-Api-Resource-Id': 'seed-tts-2.0', 'X-Api-Connect-Id': crypto.randomUUID() },
      })
    } catch (e) { return done(e) }
    ws.on('open', () => ws.send(volcFrame(VOLC_EV.START_CONNECTION, null, '{}')))
    ws.on('message', (data, isBinary) => {
      if (!isBinary) return
      let f
      try { f = volcParse(Buffer.from(data)) } catch (e) { return }
      switch (f.event) {
        case VOLC_EV.CONNECTION_STARTED:
          ws.send(volcFrame(VOLC_EV.START_SESSION, sid, JSON.stringify({ event: VOLC_EV.START_SESSION, req_params: { speaker: 'en_female_jenny_uranus_bigtts', audio_params: { format: 'mp3', sample_rate: 24000 } } })))
          break
        case VOLC_EV.SESSION_STARTED:
          ws.send(volcFrame(VOLC_EV.TASK_REQUEST, sid, JSON.stringify({ event: VOLC_EV.TASK_REQUEST, req_params: { text } })))
          ws.send(volcFrame(VOLC_EV.FINISH_SESSION, sid, '{}'))
          break
        case VOLC_EV.TTS_RESPONSE:
          chunks.push(Buffer.from(f.payload))
          break
        case VOLC_EV.SESSION_FINISHED:
          ws.send(volcFrame(VOLC_EV.FINISH_CONNECTION, null, '{}'))
          break
        case VOLC_EV.CONNECTION_FINISHED:
          const full = Buffer.concat(chunks)
          done(full.length > 1000 ? null : new Error('火山 TTS 音频为空'), full)
          break
        case VOLC_EV.CONNECTION_FAILED: case VOLC_EV.SESSION_FAILED:
          done(new Error('火山 TTS 会话失败'))
          break
      }
    })
    ws.on('error', (e) => done(e))
  })
}

app.get('/api/export', (req, res) => {
  const uid = req.userId
  const words = db.prepare('SELECT * FROM words WHERE user_id = ? ORDER BY created_at ASC').all(uid).map(rowToWord)
  const records = db.prepare('SELECT * FROM records WHERE user_id = ? ORDER BY ts ASC').all(uid).map((r) => ({
    id: r.id, date: r.date, chinese: r.chinese, english: r.english, pos: r.pos||'', type: r.type||'word', correct: !!r.correct, userAnswer: r.user_answer||'', ts: r.ts,
  }))
  const wrongbook = db.prepare('SELECT * FROM wrongbook WHERE user_id = ? ORDER BY added_at ASC').all(uid).map((w) => ({
    wordId: String(w.word_id), chinese: w.chinese, english: w.english, pos: w.pos||'', addedAt: w.added_at,
  }))
  res.json({
    app: 'vocab-trainer', version: 2, exportedAt: new Date().toISOString(),
    settings: { masteryThreshold: getThreshold(uid), autoNext: getAutoNext(uid) }, words, records, wrongbook,
  })
})

app.post('/api/import', (req, res) => {
  const { data, mode } = req.body || {}
  if (!data || !Array.isArray(data.words)) return res.status(400).json({ ok:false, reason:'文件格式不正确' })
  const list = data.words.filter(w => w && typeof w === 'object')
  const valid = list.filter(w => String(w.chinese||'').trim() && String(w.english||'').trim())
  if (!valid.length) return res.status(400).json({ ok:false, reason:'文件中没有可导入的单词' })
  const uid = req.userId
  const insertStmt = db.prepare('INSERT INTO words (user_id, chinese, english, pos, type, count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
  const normalize = (w) => ({
    chinese: String(w.chinese||'').trim(), english: String(w.english||'').trim(), pos: String(w.pos||'').trim(),
    type: ['word', 'phrase', 'sentence'].includes(w.type) ? w.type : 'word',
    count: Number.isFinite(Number(w.count)) && Number(w.count)>=0 ? Math.floor(Number(w.count)) : 0,
    createdAt: Number.isFinite(Number(w.createdAt)) ? Number(w.createdAt) : Date.now(),
  })
  let imported = 0, skipped = 0
  const tx = db.transaction(() => {
    if (mode === 'overwrite') {
      // 清空旧分组归属
      const oldIds = db.prepare('SELECT id FROM words WHERE user_id = ?').all(uid).map((r) => r.id)
      if (oldIds.length) db.prepare(`DELETE FROM word_groups WHERE word_id IN (${oldIds.map(() => '?').join(',')})`).run(...oldIds)
      db.prepare('DELETE FROM words WHERE user_id = ?').run(uid)
      db.prepare('DELETE FROM records WHERE user_id = ?').run(uid)
      db.prepare('DELETE FROM wrongbook WHERE user_id = ?').run(uid)
      for (const w of valid) {
        const n = normalize(w)
        const r = insertStmt.run(uid, n.chinese, n.english, n.pos, n.type, n.count, n.createdAt)
        assignWordToSmallestGroup(uid, r.lastInsertRowid)
        imported++
      }
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
        const r = insertStmt.run(uid, n.chinese, n.english, n.pos, n.type, n.count, n.createdAt)
        assignWordToSmallestGroup(uid, r.lastInsertRowid)
        setC.add(n.chinese.toLowerCase()); setE.add(n.english.toLowerCase()); imported++
      }
    }
    if (data.settings && Number.isFinite(Number(data.settings.masteryThreshold))) {
      const t = Number(data.settings.masteryThreshold)
      if (t >= 1) db.prepare("INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (?, 'masteryThreshold', ?)").run(uid, String(Math.floor(t)))
    }
    if (data.settings && typeof data.settings.autoNext === 'boolean') {
      db.prepare("INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (?, 'autoNext', ?)").run(uid, data.settings.autoNext ? '1' : '0')
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
  // index.html 不缓存，确保每次部署后用户刷新即拿到最新版本
  app.use((req, res, next) => {
    if (req.path === '/' || req.path === '/index.html') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    }
    next()
  })
  // 带 hash 的静态资源可长缓存
  app.use(
    express.static(DIST_DIR, {
      setHeaders(res, filePath) {
        if (/[0-9a-f]{8}-/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      },
    })
  )
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(join(DIST_DIR, 'index.html')))
}

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`✅ Vocab Trainer running at http://localhost:${PORT}`))
