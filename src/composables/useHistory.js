import { ref, watch } from 'vue'

/**
 * 背诵历史数据源（localStorage 持久化）
 * key: vocab-history
 * 每条记录：{ id, date: 'YYYY-MM-DD', chinese, english, pos, correct, ts }
 * 按天维度统计：记录自带日期字段，展示时只取当天 ⇒ 隔天自动清零
 */
const HISTORY_KEY = 'vocab-history'

function todayStr() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function load() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const data = raw ? JSON.parse(raw) : []
    return Array.isArray(data) ? data : []
  } catch (e) {
    return []
  }
}

const history = ref(load())
// "今天"标记：跨零点自动刷新，供组件 computed 依赖以触发隔天清零
const today = ref(todayStr())
setInterval(() => {
  const t = todayStr()
  if (t !== today.value) today.value = t
}, 30000)

watch(
  history,
  (val) => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(val))
    } catch (e) {
      // 存储失败时静默处理
    }
  },
  { deep: true }
)

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function useHistory() {
  /** 写入一条当天背诵记录 */
  function addRecord({ chinese, english, pos, correct }) {
    history.value.push({
      id: uid(),
      date: todayStr(),
      chinese: (chinese || '').trim(),
      english: (english || '').trim(),
      pos: (pos || '').trim(),
      correct: !!correct,
      ts: Date.now(),
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

  /**
   * 当天去重单词统计：重复的单词只统计一次，正确/错误分别统计。
   * 注：同一单词当天既答对过又答错过时，会同时计入 correctWords 与 wrongWords。
   */
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

  /**
   * 按天维度的历史汇总（日期倒序，每天含 correct/wrong 次数与 correctWords/wrongWords/totalWords 去重单词数）
   */
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
    return true
  }

  /** 清空全部历史 */
  function clearAll() {
    history.value = []
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
