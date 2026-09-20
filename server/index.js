import express from 'express'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import fs from 'fs'
import db from './db.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const DIST_DIR = join(__dirname, '..', 'dist')

const app = express()
app.use(express.json())

// ============ 工具函数 ============

function rowToWord(row) {
  return {
    id: String(row.id),
    chinese: row.chinese,
    english: row.english,
    pos: row.pos || '',
    count: row.count || 0,
    createdAt: row.created_at,
  }
}

function getThreshold() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'masteryThreshold'").get()
  const t = Number(row?.value)
  return Number.isFinite(t) && t >= 1 ? Math.floor(t) : 5
}

function genId(prefix = '') {
  return `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ============ API 路由 ============

// 一次性拉取所有状态（前端启动时调用）
app.get('/api/state', (req, res) => {
  const words = db.prepare('SELECT * FROM words ORDER BY created_at ASC').all().map(rowToWord)
  const records = db.prepare('SELECT * FROM records ORDER BY ts ASC').all().map((r) => ({
    id: r.id,
    date: r.date,
    chinese: r.chinese,
    english: r.english,
    pos: r.pos || '',
    correct: !!r.correct,
    ts: r.ts,
  }))
  const wrongbook = db.prepare('SELECT * FROM wrongbook ORDER BY added_at ASC').all().map((w) => ({
    id: String(w.word_id),
    chinese: w.chinese,
    english: w.english,
    pos: w.pos || '',
    addedAt: w.added_at,
  }))
  res.json({
    words,
    settings: { masteryThreshold: getThreshold() },
    records,
    wrongbook,
  })
})

// ---- 单词 CRUD ----
app.post('/api/words', (req, res) => {
  const { chinese, english, pos } = req.body || {}
  const c = (chinese || '').trim()
  const e = (english || '').trim()
  const p = (pos || '').trim()
  if (!c || !e) return res.status(400).json({ error: '中文和英文不能为空' })
  const info = db
    .prepare('INSERT INTO words (chinese, english, pos, count, created_at) VALUES (?, ?, ?, 0, ?)')
    .run(c, e, p, Date.now())
  const word = rowToWord(db.prepare('SELECT * FROM words WHERE id = ?').get(info.lastInsertRowid))
  res.json(word)
})

app.put('/api/words/:id', (req, res) => {
  const id = Number(req.params.id)
  const { chinese, english, pos } = req.body || {}
  const c = (chinese || '').trim()
  const e = (english || '').trim()
  const p = (pos || '').trim()
  if (!c || !e) return res.status(400).json({ error: '中文和英文不能为空' })
  const info = db
    .prepare('UPDATE words SET chinese = ?, english = ?, pos = ? WHERE id = ?')
    .run(c, e, p, id)
  if (!info.changes) return res.status(404).json({ error: '单词不存在' })
  // 同步更新错题本里的冗余字段
  db.prepare('UPDATE wrongbook SET chinese = ?, english = ?, pos = ? WHERE word_id = ?').run(c, e, p, String(id))
  res.json({ ok: true })
})

app.delete('/api/words/:id', (req, res) => {
  const id = Number(req.params.id)
  db.prepare('DELETE FROM words WHERE id = ?').run(id)
  db.prepare('DELETE FROM wrongbook WHERE word_id = ?').run(String(id))
  res.json({ ok: true })
})

app.post('/api/words/:id/increment', (req, res) => {
  const id = Number(req.params.id)
  db.prepare('UPDATE words SET count = count + 1 WHERE id = ?').run(id)
  res.json({ ok: true })
})

app.post('/api/words/:id/reset-count', (req, res) => {
  const id = Number(req.params.id)
  db.prepare('UPDATE words SET count = 0 WHERE id = ?').run(id)
  res.json({ ok: true })
})

app.post('/api/words/reset-all-counts', (req, res) => {
  db.prepare('UPDATE words SET count = 0').run()
  res.json({ ok: true })
})

// ---- 设置 ----
app.put('/api/settings/threshold', (req, res) => {
  const t = Number(req.body?.value)
  if (!Number.isFinite(t) || t < 1) return res.status(400).json({ error: '阈值必须是不小于 1 的正整数' })
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('masteryThreshold', ?)").run(String(Math.floor(t)))
  res.json({ ok: true, masteryThreshold: Math.floor(t) })
})

// ---- 背诵记录 ----
app.post('/api/records', (req, res) => {
  const { chinese, english, pos, correct } = req.body || {}
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const id = genId('rec-')
  db.prepare(
    'INSERT INTO records (id, date, chinese, english, pos, correct, ts) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    date,
    (chinese || '').trim(),
    (english || '').trim(),
    (pos || '').trim(),
    correct ? 1 : 0,
    Date.now()
  )
  res.json({ ok: true, id })
})

app.delete('/api/records/:date', (req, res) => {
  db.prepare('DELETE FROM records WHERE date = ?').run(req.params.date)
  res.json({ ok: true })
})

app.delete('/api/records', (req, res) => {
  db.prepare('DELETE FROM records').run()
  res.json({ ok: true })
})

// ---- 错题本 ----
app.post('/api/wrongbook', (req, res) => {
  const { wordId, chinese, english, pos } = req.body || {}
  const id = String(wordId || '')
  if (!id || !chinese || !english) return res.status(400).json({ error: '参数不完整' })
  db.prepare(
    'INSERT OR IGNORE INTO wrongbook (word_id, chinese, english, pos, added_at) VALUES (?, ?, ?, ?, ?)'
  ).run(String(id), chinese, english, pos || '', Date.now())
  res.json({ ok: true })
})

app.delete('/api/wrongbook/:wordId', (req, res) => {
  db.prepare('DELETE FROM wrongbook WHERE word_id = ?').run(String(req.params.wordId))
  res.json({ ok: true })
})

app.delete('/api/wrongbook', (req, res) => {
  db.prepare('DELETE FROM wrongbook').run()
  res.json({ ok: true })
})

// ---- 词典查询代理（避免浏览器跨域问题） ----
app.get('/api/dict', async (req, res) => {
  const word = (req.query.word || '').trim()
  if (!word) return res.status(400).json({ error: '缺少 word 参数' })
  try {
    const url = `https://dict.youdao.com/jsonapi?q=${encodeURIComponent(word)}`
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!r.ok) return res.status(502).json({ error: '词典服务异常' })
    const data = await r.json()
    const ec = data.ec
    if (!ec || !ec.word || !ec.word.length) {
      return res.status(404).json({ error: '未找到该单词的释义' })
    }
    const w = ec.word[0]
    res.json({
      usphone: w.usphone || '',
      ukphone: w.ukphone || '',
      examType: ec.exam_type || [],
      trs: (w.trs || []).map(t => t.tr[0].l.i[0]),
      wfs: (w.wfs || []).map(wf => `${wf.wf.name}：${wf.wf.value}`),
    })
  } catch (e) {
    res.status(502).json({ error: '词典查询超时或失败' })
  }
})

// ---- 导入导出 ----
app.get('/api/export', (req, res) => {
  const words = db.prepare('SELECT * FROM words ORDER BY created_at ASC').all().map(rowToWord)
  res.json({
    app: 'vocab-trainer',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: { masteryThreshold: getThreshold() },
    words,
  })
})

app.post('/api/import', (req, res) => {
  const { data, mode } = req.body || {}
  if (!data || !Array.isArray(data.words)) {
    return res.status(400).json({ ok: false, reason: '文件结构不是本工具导出的备份格式' })
  }
  const list = data.words.filter((w) => w && typeof w === 'object')
  const valid = list.filter((w) => String(w.chinese || '').trim() && String(w.english || '').trim())
  if (!valid.length) return res.status(400).json({ ok: false, reason: '文件中没有可导入的单词' })

  const insertStmt = db.prepare(
    'INSERT INTO words (chinese, english, pos, count, created_at) VALUES (?, ?, ?, ?, ?)'
  )
  const normalize = (w) => ({
    chinese: String(w.chinese || '').trim(),
    english: String(w.english || '').trim(),
    pos: String(w.pos || '').trim(),
    count: Number.isFinite(Number(w.count)) && Number(w.count) >= 0 ? Math.floor(Number(w.count)) : 0,
    createdAt: Number.isFinite(Number(w.createdAt)) ? Number(w.createdAt) : Date.now(),
  })

  let imported = 0
  let skipped = 0

  const tx = db.transaction(() => {
    if (mode === 'overwrite') {
      db.prepare('DELETE FROM words').run()
      db.prepare('DELETE FROM wrongbook').run()
      for (const w of valid) {
        const n = normalize(w)
        insertStmt.run(n.chinese, n.english, n.pos, n.count, n.createdAt)
        imported++
      }
      skipped = list.length - valid.length
    } else {
      // 合并：中文或英文与已有重复的跳过
      const existing = db.prepare('SELECT chinese, english FROM words').all()
      const setC = new Set(existing.map((r) => r.chinese.trim().toLowerCase()))
      const setE = new Set(existing.map((r) => r.english.trim().toLowerCase()))
      for (const w of list) {
        const c = String(w.chinese || '').trim()
        const e = String(w.english || '').trim()
        if (!c || !e) {
          skipped++
          continue
        }
        if (setC.has(c.toLowerCase()) || setE.has(e.toLowerCase())) {
          skipped++
          continue
        }
        const n = normalize(w)
        insertStmt.run(n.chinese, n.english, n.pos, n.count, n.createdAt)
        setC.add(n.chinese.toLowerCase())
        setE.add(n.english.toLowerCase())
        imported++
      }
    }
    // 应用阈值
    if (data.settings && Number.isFinite(Number(data.settings.masteryThreshold))) {
      const t = Number(data.settings.masteryThreshold)
      if (t >= 1) {
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('masteryThreshold', ?)").run(String(Math.floor(t)))
      }
    }
  })
  tx()

  const total = db.prepare('SELECT COUNT(*) AS c FROM words').get().c
  res.json({ ok: true, imported, skipped, total })
})

// ---- 从 localStorage 批量迁移（一次性清空后导入所有旧数据） ----
app.post('/api/migrate', (req, res) => {
  const { words: oldWords, settings: oldSettings, records: oldRecords, wrongbook: oldWrongbook } = req.body || {}
  if (!Array.isArray(oldWords)) {
    return res.status(400).json({ ok: false, reason: '数据格式不正确' })
  }

  const result = { words: 0, records: 0, wrongbook: 0, threshold: null }

  const tx = db.transaction(() => {
    // 清空现有数据
    db.prepare('DELETE FROM words').run()
    db.prepare('DELETE FROM records').run()
    db.prepare('DELETE FROM wrongbook').run()

    // 导入单词（保留旧 id，确保 records/wrongbook 关联正确）
    const insertWord = db.prepare(
      'INSERT INTO words (id, chinese, english, pos, count, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    for (const w of oldWords) {
      const c = String(w.chinese || '').trim()
      const e = String(w.english || '').trim()
      if (!c || !e) continue
      const id = Number(w.id)
      if (!Number.isFinite(id) || id <= 0) continue
      insertWord.run(
        id, c, e,
        String(w.pos || '').trim(),
        Number.isFinite(Number(w.count)) ? Math.floor(Number(w.count)) : 0,
        Number(w.createdAt) || Date.now()
      )
      result.words++
    }

    // 导入设置
    if (oldSettings && Number.isFinite(Number(oldSettings.masteryThreshold))) {
      const t = Math.floor(Number(oldSettings.masteryThreshold))
      if (t >= 1) {
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('masteryThreshold', ?)").run(String(t))
        result.threshold = t
      }
    }

    // 导入背诵记录
    if (Array.isArray(oldRecords)) {
      const insertRec = db.prepare(
        'INSERT OR IGNORE INTO records (id, date, chinese, english, pos, correct, ts) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      for (const r of oldRecords) {
        insertRec.run(
          String(r.id || genId('rec-')),
          String(r.date || ''),
          String(r.chinese || '').trim(),
          String(r.english || '').trim(),
          String(r.pos || '').trim(),
          r.correct ? 1 : 0,
          Number(r.ts) || Date.now()
        )
        result.records++
      }
    }

    // 导入错题本
    if (Array.isArray(oldWrongbook)) {
      const insertWrong = db.prepare(
        'INSERT OR IGNORE INTO wrongbook (word_id, chinese, english, pos, added_at) VALUES (?, ?, ?, ?, ?)'
      )
      for (const w of oldWrongbook) {
        insertWrong.run(
          String(w.id || ''),
          String(w.chinese || '').trim(),
          String(w.english || '').trim(),
          String(w.pos || '').trim(),
          Number(w.addedAt) || Date.now()
        )
        result.wrongbook++
      }
    }
  })
  tx()

  res.json({ ok: true, ...result })
})

// ============ 静态文件托管（SPA） ============
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR))
  // SPA 回退：所有非 /api 请求都返回 index.html
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.sendFile(join(DIST_DIR, 'index.html'))
  })
}

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`✅ Vocab Trainer server running at http://localhost:${PORT}`)
})
