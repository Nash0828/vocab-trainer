import { ref, watch } from 'vue'

/**
 * 词库共享数据源（localStorage 持久化）
 * key: vocab-words（单词，含背诵次数 count）
 * key: vocab-settings（背熟阈值等设置）
 * 数据结构: [{ id, chinese, english, pos, count, createdAt }]
 */
const STORAGE_KEY = 'vocab-words'
const SETTINGS_KEY = 'vocab-settings'
const DEFAULT_THRESHOLD = 5 // 默认背熟阈值：答对 5 次视为已背熟

function loadWords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const data = raw ? JSON.parse(raw) : []
    // 兼容旧数据：无 count 字段的单词补为 0
    return Array.isArray(data)
      ? data.map((w) => ({ ...w, count: typeof w.count === 'number' ? w.count : 0 }))
      : []
  } catch (e) {
    return []
  }
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    const data = raw ? JSON.parse(raw) : {}
    const t = Number(data.masteryThreshold)
    return {
      masteryThreshold: Number.isFinite(t) && t >= 1 ? Math.floor(t) : DEFAULT_THRESHOLD,
    }
  } catch (e) {
    return { masteryThreshold: DEFAULT_THRESHOLD }
  }
}

const words = ref(loadWords())
const settings = ref(loadSettings())

// 任何变化自动写回 localStorage
watch(
  words,
  (val) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(val))
    } catch (e) {
      // 存储失败时静默处理
    }
  },
  { deep: true }
)

watch(
  settings,
  (val) => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(val))
    } catch (e) {
      // 存储失败时静默处理
    }
  },
  { deep: true }
)

let idSeed = words.value.reduce((max, w) => {
  const n = Number(w.id)
  return Number.isFinite(n) && n > max ? n : max
}, 0)

export function useWords() {
  function addWord({ chinese, english, pos }) {
    const word = {
      id: String(++idSeed),
      chinese: (chinese || '').trim(),
      english: (english || '').trim(),
      pos: (pos || '').trim(),
      count: 0,
      createdAt: Date.now(),
    }
    if (!word.chinese || !word.english) return null
    words.value.push(word)
    return word
  }

  function updateWord(id, patch) {
    const idx = words.value.findIndex((w) => w.id === id)
    if (idx === -1) return false
    words.value[idx] = { ...words.value[idx], ...patch }
    return true
  }

  function removeWord(id) {
    const idx = words.value.findIndex((w) => w.id === id)
    if (idx === -1) return false
    words.value.splice(idx, 1)
    return true
  }

  /**
   * 重复校验：检查中文/英文是否与词库已有条目重复。
   * @param {object} param
   * @param {string} param.chinese 待校验的中文
   * @param {string} param.english 待校验的英文
   * @param {string} [param.excludeId] 排除的单词 id（编辑自身时传入，避免把自己的旧值误判为重复）
   * @returns {{ duplicateChinese: boolean, duplicateEnglish: boolean }}
   */
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
    return true
  }

  /** 单个单词背诵次数归 0 */
  function resetCount(id) {
    const w = words.value.find((x) => x.id === id)
    if (!w) return false
    w.count = 0
    return true
  }

  /** 一键重置所有单词背诵次数归 0 */
  function resetAllCounts() {
    words.value.forEach((w) => {
      w.count = 0
    })
  }

  /** 设置背熟阈值（正整数），非法值返回 false */
  function setThreshold(value) {
    const t = Number(value)
    if (!Number.isFinite(t) || t < 1) return false
    settings.value.masteryThreshold = Math.floor(t)
    return true
  }

  /** 判断单词是否已背熟（次数达到阈值） */
  function isMastered(word, threshold = settings.value.masteryThreshold) {
    return (word?.count || 0) >= threshold
  }

  /** 导出备份数据（单词+背诵次数+设置），供下载为 JSON 文件 */
  function exportData() {
    return {
      app: 'vocab-trainer',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: { ...settings.value },
      words: words.value.map((w) => ({ ...w })),
    }
  }

  /** 导入前只读校验：检查文件结构是否为本工具导出的备份格式 */
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

  /**
   * 导入词库数据。
   * @param {object} data 由 exportData 导出的备份对象
   * @param {'merge'|'overwrite'} mode merge=合并（跳过重复），overwrite=覆盖（整体替换）
   * @returns {{ ok: boolean, reason?: string, imported: number, skipped: number, total: number }}
   */
  function importData(data, mode = 'merge') {
    if (!data || typeof data !== 'object' || !Array.isArray(data.words)) {
      return { ok: false, reason: '结构不符' }
    }
    const list = data.words.filter((w) => w && typeof w === 'object')
    if (!list.length) return { ok: false, reason: '没有可导入的单词' }

    const normalize = (w) => ({
      id: String(++idSeed),
      chinese: String(w.chinese || '').trim(),
      english: String(w.english || '').trim(),
      pos: String(w.pos || '').trim(),
      count: Number.isFinite(Number(w.count)) && Number(w.count) >= 0 ? Math.floor(Number(w.count)) : 0,
      createdAt: Number.isFinite(Number(w.createdAt)) ? Number(w.createdAt) : Date.now(),
    })

    let imported = 0
    let skipped = 0

    if (mode === 'overwrite') {
      const valid = list.filter(
        (w) => String(w.chinese || '').trim() && String(w.english || '').trim()
      )
      skipped = list.length - valid.length
      words.value = valid.map(normalize)
      imported = words.value.length
    } else {
      // 合并：中文或英文与已有单词重复的跳过
      for (const w of list) {
        const chinese = String(w.chinese || '').trim().toLowerCase()
        const english = String(w.english || '').trim().toLowerCase()
        if (!chinese || !english) {
          skipped += 1
          continue
        }
        const dup = words.value.some(
          (x) => x.chinese.trim().toLowerCase() === chinese || x.english.trim().toLowerCase() === english
        )
        if (dup) {
          skipped += 1
          continue
        }
        words.value.push(normalize(w))
        imported += 1
      }
    }

    // 文件若包含合法的背熟阈值则一并应用
    if (data.settings && Number.isFinite(Number(data.settings.masteryThreshold))) {
      const t = Number(data.settings.masteryThreshold)
      if (t >= 1) settings.value.masteryThreshold = Math.floor(t)
    }

    return { ok: true, imported, skipped, total: words.value.length }
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
