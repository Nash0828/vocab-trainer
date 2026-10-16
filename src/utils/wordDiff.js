/**
 * 逐词对比工具：把用户输入与正确答案按位置逐词对齐，
 * 返回用户输入各词的匹配标记，用于错题本/历史记录中着色展示
 * @param {string} userInput 用户输入
 * @param {string} rightAnswer 正确答案
 * @param {boolean} caseSensitive 是否区分大小写
 * @returns {Array<{word: string, ok: boolean}>}
 */
export function diffUserWords(userInput, rightAnswer, caseSensitive = false) {
  const right = String(rightAnswer || '').trim().split(/\s+/)
  const user = String(userInput || '').trim().split(/\s+/)
  const norm = (s) => (caseSensitive ? s : s.toLowerCase())
  return user.map((w, i) => ({ word: w, ok: i < right.length && norm(w) === norm(right[i]) }))
}
