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

  /** 按天维度的历史汇总（日期倒序，每天含 correct/wrong/records） */
  function getHistoryByDay() {
    const map = new Map()
    for (const r of history.value) {
      if (!map.has(r.date)) {
        map.set(r.date, { date: r.date, correct: 0, wrong: 0, records: [] })
      }
      const day = map.get(r.date)
      day.records.push(r)
      if (r.correct) day.correct += 1
      else day.wrong += 1
    }
    const days = [...map.values()].sort((a, b) => (a.date < b.date ? 1 : -1))
    for (const d of days) {
      d.records.sort((a, b) => (b.ts || 0) - (a.ts || 0))
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
    getHistoryByDay,
    clearDay,
    clearAll,
  }
}
