import { ref } from 'vue'
import { api } from '../api/index.js'

/**
 * 错题本数据源（后端 API 持久化）
 * 每条记录：{ id: 单词id, chinese, english, pos, addedAt }
 * 规则：答错记入（同词只记一次）、答对移除；单词从词库删除后自动清理（惰性）
 */
const wrongWords = ref([])

/** 从后端数据初始化（main.js 中调用） */
export function initWrongbook(wrongbook) {
  wrongWords.value = Array.isArray(wrongbook) ? wrongbook : []
}

export function useWrongBook() {
  /** 答错时记入错题本（同一单词只记一次：优先按 id 去重，无 id 时按英文去重） */
  function addWrong(word) {
    if (!word || (!word.id && !word.english)) return false
    const exists = wrongWords.value.some((w) => {
      if (word.id && String(w.id) === String(word.id)) return true
      if (word.english && w.english.trim().toLowerCase() === word.english.trim().toLowerCase()) return true
      return false
    })
    if (exists) return false
    const entry = {
      id: word.id ? String(word.id) : '',
      chinese: (word.chinese || '').trim(),
      english: (word.english || '').trim(),
      pos: (word.pos || '').trim(),
      addedAt: Date.now(),
    }
    wrongWords.value.push(entry)
    api.addWrong({
      wordId: entry.id,
      chinese: entry.chinese,
      english: entry.english,
      pos: entry.pos,
    }).catch((err) => {
      console.error('addWrong 同步失败', err)
      const idx = wrongWords.value.findIndex((w) => w.id === entry.id && w.english === entry.english)
      if (idx !== -1) wrongWords.value.splice(idx, 1)
    })
    return true
  }

  /** 答对时从错题本移除 */
  function removeWrong(idOrWord) {
    const id = idOrWord && typeof idOrWord === 'object' ? idOrWord.id : idOrWord
    const english =
      idOrWord && typeof idOrWord === 'object' ? (idOrWord.english || '').trim().toLowerCase() : ''
    const before = wrongWords.value.length
    wrongWords.value = wrongWords.value.filter((w) => {
      if (id && String(w.id) === String(id)) return false
      if (english && w.english.trim().toLowerCase() === english) return false
      return true
    })
    const removed = wrongWords.value.length !== before
    if (removed && id) {
      api.removeWrong(id).catch((err) => console.error('removeWrong 同步失败', err))
    }
    return removed
  }

  /** 判断单词是否在错题本中 */
  function isWrong(word) {
    if (!word) return false
    if (word.id && wrongWords.value.some((w) => String(w.id) === String(word.id))) return true
    const e = (word.english || '').trim().toLowerCase()
    return e ? wrongWords.value.some((w) => w.english.trim().toLowerCase() === e) : false
  }

  /** 获取有效错题本列表：自动清理词库中已不存在的单词（惰性），按加入时间倒序 */
  function getValidWrongWords(words) {
    const valid = []
    for (const w of wrongWords.value) {
      const matched = (words || []).some(
        (x) =>
          (w.id && String(x.id) === String(w.id)) ||
          x.english.trim().toLowerCase() === w.english.trim().toLowerCase()
      )
      if (matched) valid.push(w)
    }
    if (valid.length !== wrongWords.value.length) {
      wrongWords.value = valid
    }
    return [...valid].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
  }

  /** 清空错题本 */
  function clearWrong() {
    wrongWords.value = []
    api.clearWrongbook().catch((err) => console.error('clearWrong 同步失败', err))
    return true
  }

  return {
    wrongWords,
    addWrong,
    removeWrong,
    isWrong,
    getValidWrongWords,
    clearWrong,
  }
}
