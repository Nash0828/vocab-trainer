/**
 * 词句对比工具：忽略标点符号与空白（含中文空格），按"词干 token"逐词对齐，
 * 用于答题判定、错题本/历史记录中着色展示
 */

// 提取词干 token：只保留字母数字及词内连字符/撇号（don't、well-known 视为一个词），
// 忽略所有标点与空白（含全角空格、中英文标点）
export function tokensOf(input, caseSensitive = false) {
  const m = String(input || '').match(/[a-zA-Z0-9]+(?:['’-][a-zA-Z0-9]+)*/g) || []
  return m.map((t) => (caseSensitive ? t : t.toLowerCase()))
}

// 展示用拆分：词（含词内撇号/连字符及词尾撇号）与独立标点分开，保留原文
const DISPLAY_TOKEN_RE = /[a-zA-Z0-9]+(?:['’-][a-zA-Z0-9]+)*['’]*|[^\s]+/g
export function displayTokensOf(input) {
  return String(input || '').match(DISPLAY_TOKEN_RE) || []
}
// 展示 token 的词干（用于对错比对）；纯标点返回空串
export function stemOf(token) {
  const m = String(token).match(/[a-zA-Z0-9]+(?:['’-][a-zA-Z0-9]+)*/)
  return m ? m[0].toLowerCase() : ''
}

/**
 * 判定用户输入是否与答案一致
 * @param {string} userInput 用户输入
 * @param {string} rightAnswer 正确答案
 * @param {boolean} caseSensitive 是否区分大小写
 * @param {boolean} isPhrase 短语/句子（true）：忽略标点与空白，仅逐词比较；
 *                           单词（false）：整串精确比较（去除首尾空格）
 */
export function isAnswerMatch(userInput, rightAnswer, caseSensitive = false, isPhrase = false) {
  if (!isPhrase) {
    const u = String(userInput || '').trim()
    const r = String(rightAnswer || '').trim()
    return caseSensitive ? u === r : u.toLowerCase() === r.toLowerCase()
  }
  const u = tokensOf(userInput, caseSensitive)
  const r = tokensOf(rightAnswer, caseSensitive)
  return r.length > 0 && u.length === r.length && u.every((t, i) => t === r[i])
}

/**
 * 逐词对比：返回用户输入各词的匹配标记（忽略标点/空白），用于着色展示
 * 展示层保留原文大小写与标点；标点（ok=null）中性显示不参与对错；比对忽略大小写（除非 caseSensitive）
 * @returns {Array<{word: string, ok: boolean|null}>}
 */
export function diffUserWords(userInput, rightAnswer, caseSensitive = false) {
  const right = tokensOf(rightAnswer, caseSensitive)
  const userTokens = tokensOf(userInput, true)
  const userNorm = caseSensitive ? userTokens : userTokens.map((t) => t.toLowerCase())
  const words = displayTokensOf(userInput)
  let idx = 0
  return words.map((w) => {
    const stem = stemOf(w)
    if (!stem) return { word: w, ok: null } // 标点：中性
    const ok = idx < right.length && idx < userTokens.length && userNorm[idx] === right[idx]
    idx++
    return { word: w, ok }
  })
}
