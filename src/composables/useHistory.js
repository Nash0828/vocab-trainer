import { ref } from 'vue'
import { api } from '../api/index.js'

/**
 * 背诵历史数据源（后端 API 持久化）
 * 每条记录：{ id, date: 'YYYY-MM-DD', chinese, english, pos, correct, ts }
 * 按天维度统计：记录自带日期字段，展示时只取当天 ⇒ 隔天自动清零
 */
function todayStr() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const history = ref([])
const today = ref(todayStr())
setInterval(() => {
  const t = todayStr()
  if (t !== today.value) today.value = t
}, 30000)

/** 从后端数据初始化（main.js 中调用） */
export function initRecords(records) {
  history.value = Array.isArray(records) ? records : []
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function useHistory() {
  /** 写入一条当天背诵记录 */
  function addRecord({ chinese, english, pos, correct }) {
    const rec = {
      id: uid(),
      date: todayStr(),
      chinese: (chinese || '').trim(),
      english: (english || '').trim(),
      pos: (pos || '').trim(),
      correct: !!correct,
      ts: Date.now(),
    }
    history.value.push(rec)
    api.addRecord({ chinese: rec.chinese, english: rec.english, pos: rec.pos, correct: rec.correct })
      .catch((err) => {
        console.error('addRecord 同步失败', err)
        const idx = history.value.findIndex((r) => r.id === rec.id)
        if (idx !== -1) history.value.splice(idx, 1)
      })
    return true
  }

  /** 当天记录（按时间倒序） */
  function getTodayRecords() {
    const t = todayStr()
    return history.value
      .filter((r) => r.date === t)
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
  }

  /** 当天统计 */
  function getTodayStats() {
    const recs = getTodayRecords()
    return {
      correct: recs.filter((r) => r.correct).length,
      wrong: recs.filter((r) => !r.correct).length,
      total: recs.length,
    }
  }

  /** 当天去重单词统计 */
  function getTodayUniqueStats() {
    const correctSet = new Set()
    const wrongSet = new Set()
    for (const r of getTodayRecords()) {
      const key = r.english.trim().toLowerCase()
      if (!key) continue
      if (r.correct) correctSet.add(key)
      else wrongSet.add(key)
    }
    return {
      correctWords: correctSet.size,
      wrongWords: wrongSet.size,
      totalWords: new Set([...correctSet, ...wrongSet]).size,
    }
  }

  /** 按天维度的历史汇总 */
  function getHistoryByDay() {
    const map = new Map()
    for (const r of history.value) {
      if (!map.has(r.date)) {
        map.set(r.date, {
          date: r.date,
          correct: 0,
          wrong: 0,
          records: [],
          correctWords: new Set(),
          wrongWords: new Set(),
          allWords: new Set(),
        })
      }
      const day = map.get(r.date)
      day.records.push(r)
      const key = r.english.trim().toLowerCase()
      if (!key) continue
      day.allWords.add(key)
      if (r.correct) {
        day.correct += 1
        day.correctWords.add(key)
      } else {
        day.wrong += 1
        day.wrongWords.add(key)
      }
    }
    const days = [...map.values()].sort((a, b) => (a.date < b.date ? 1 : -1))
    for (const d of days) {
      d.records.sort((a, b) => (b.ts || 0) - (a.ts || 0))
      d.correctWords = d.correctWords.size
      d.wrongWords = d.wrongWords.size
      d.totalWords = d.allWords.size
      delete d.allWords
    }
    return days
  }

  /** 清空某天的记录 */
  function clearDay(date) {
    history.value = history.value.filter((r) => r.date !== date)
    api.clearDay(date).catch((err) => console.error('clearDay 同步失败', err))
    return true
  }

  /** 清空全部历史 */
  function clearAll() {
    history.value = []
    api.clearAllRecords().catch((err) => console.error('clearAll 同步失败', err))
    return true
  }

  return {
    history,
    today,
    todayStr,
    addRecord,
    getTodayRecords,
    getTodayStats,
    getTodayUniqueStats,
    getHistoryByDay,
    clearDay,
    clearAll,
  }
}
