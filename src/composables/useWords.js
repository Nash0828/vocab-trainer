import { ref } from 'vue'
import { api } from '../api/index.js'

/**
 * 词库共享数据源（后端 API 持久化）
 * 数据结构: [{ id, chinese, english, pos, count, createdAt }]
 * 策略：启动时一次性从后端加载到 ref；写操作先乐观更新 ref，再异步同步到后端
 */
const DEFAULT_THRESHOLD = 10

const words = ref([])
const settings = ref({ masteryThreshold: DEFAULT_THRESHOLD })

let idSeed = 0

/** 从后端全量数据初始化（main.js 中调用，state 由 api.getState() 返回） */
export function loadState(state) {
  words.value = (state.words || []).map((w) => ({
    ...w,
    count: typeof w.count === 'number' ? w.count : 0,
  }))
  settings.value = { masteryThreshold: state.settings?.masteryThreshold || DEFAULT_THRESHOLD }
  idSeed = words.value.reduce((max, w) => {
    const n = Number(w.id)
    return Number.isFinite(n) && n > max ? n : max
  }, 0)
}

/**
 * 加权随机抽题：熟练程度低的单词优先出现（背诵次数越少，权重越大）。
 */
export function weightedPickIndex(counts, threshold, lastIndex = -1) {
  const n = counts.length
  if (n <= 0) return -1
  if (n <= 1) return 0
  const candidates = []
  for (let i = 0; i < n; i++) {
    if (i !== lastIndex) candidates.push(i)
  }
  const weights = candidates.map((i) => Math.max(1, threshold - (counts[i] || 0)))
  const total = weights.reduce((a, b) => a + b, 0)
  let r = Math.random() * total
  let chosen = 0
  for (let k = 0; k < candidates.length; k++) {
    r -= weights[k]
    if (r <= 0) {
      chosen = k
      break
    }
  }
  return candidates[chosen]
}

export function useWords() {
  function addWord({ chinese, english, pos, caseSensitive }) {
    const c = (chinese || '').trim()
    const e = (english || '').trim()
    const p = (pos || '').trim()
    if (!c || !e) return null
    const word = {
      id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      chinese: c,
      english: e,
      pos: p,
      caseSensitive: !!caseSensitive,
      count: 0,
      createdAt: Date.now(),
    }
    words.value.push(word)
    // 异步同步到后端，成功后用真实 id 替换临时 id
    api.addWord({ chinese: c, english: e, pos: p, caseSensitive: !!caseSensitive })
      .then((real) => {
        const idx = words.value.findIndex((w) => w.id === word.id)
        if (idx !== -1) words.value[idx] = { ...real, count: 0 }
        idSeed = Math.max(idSeed, Number(real.id) || 0)
      })
      .catch((err) => {
        console.error('addWord 同步失败', err)
        const idx = words.value.findIndex((w) => w.id === word.id)
        if (idx !== -1) words.value.splice(idx, 1)
      })
    return word
  }

  function updateWord(id, patch) {
    const idx = words.value.findIndex((w) => w.id === id)
    if (idx === -1) return false
    words.value[idx] = { ...words.value[idx], ...patch }
    const w = words.value[idx]
    api.updateWord(id, { chinese: w.chinese, english: w.english, pos: w.pos }).catch((err) =>
      console.error('updateWord 同步失败', err)
    )
    return true
  }

  function removeWord(id) {
    const idx = words.value.findIndex((w) => w.id === id)
    if (idx === -1) return false
    words.value.splice(idx, 1)
    api.removeWord(id).catch((err) => console.error('removeWord 同步失败', err))
    return true
  }

  function checkDuplicate({ chinese, english, excludeId = null }) {
    const c = (chinese || '').trim().toLowerCase()
    const e = (english || '').trim().toLowerCase()
    let duplicateChinese = false
    let duplicateEnglish = false
    for (const w of words.value) {
      if (excludeId && w.id === excludeId) continue
      if (w.chinese.trim().toLowerCase() === c) duplicateChinese = true
      if (w.english.trim().toLowerCase() === e) duplicateEnglish = true
      if (duplicateChinese && duplicateEnglish) break
    }
    return { duplicateChinese, duplicateEnglish }
  }

  /** 答对一次：背诵次数 +1 */
  function incrementCount(id) {
    const w = words.value.find((x) => x.id === id)
    if (!w) return false
    w.count = (w.count || 0) + 1
    api.incrementCount(id).catch((err) => console.error('incrementCount 同步失败', err))
    return true
  }

  /** 单个单词背诵次数归 0 */
  function resetCount(id) {
    const w = words.value.find((x) => x.id === id)
    if (!w) return false
    w.count = 0
    api.resetCount(id).catch((err) => console.error('resetCount 同步失败', err))
    return true
  }

  /** 一键重置所有单词背诵次数归 0 */
  function resetAllCounts() {
    words.value.forEach((w) => {
      w.count = 0
    })
    api.resetAllCounts().catch((err) => console.error('resetAllCounts 同步失败', err))
  }

  /** 设置背熟阈值（正整数），非法值返回 false */
  function setThreshold(value) {
    const t = Number(value)
    if (!Number.isFinite(t) || t < 1) return false
    settings.value.masteryThreshold = Math.floor(t)
    api.setThreshold(Math.floor(t)).catch((err) => console.error('setThreshold 同步失败', err))
    return true
  }

  /** 判断单词是否已背熟 */
  function isMastered(word, threshold = settings.value.masteryThreshold) {
    return (word?.count || 0) >= threshold
  }

  /** 导出备份数据（从后端拉取最新） */
  async function exportData() {
    return await api.exportData()
  }

  /** 导入前只读校验 */
  function validateImport(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.words)) {
      return { ok: false, reason: '文件结构不是本工具导出的备份格式' }
    }
    const list = data.words.filter((w) => w && typeof w === 'object')
    const validCount = list.filter(
      (w) => String(w.chinese || '').trim() && String(w.english || '').trim()
    ).length
    if (!list.length || !validCount) {
      return { ok: false, reason: '文件中没有可导入的单词' }
    }
    return { ok: true, validCount, totalInFile: list.length }
  }

  /** 导入词库数据（调后端接口，成功后重新加载全量） */
  async function importData(data, mode = 'merge') {
    const result = await api.importData(data, mode)
    if (result.ok) {
      const state = await api.getState()
      loadState(state)
    }
    return result
  }

  return {
    words,
    settings,
    addWord,
    updateWord,
    removeWord,
    checkDuplicate,
    incrementCount,
    resetCount,
    resetAllCounts,
    setThreshold,
    isMastered,
    exportData,
    validateImport,
    importData,
  }
}
