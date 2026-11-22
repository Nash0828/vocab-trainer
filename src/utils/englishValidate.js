// 英文内容校验：允许字母、数字、空白与常见标点（含引号、破折号、省略号等），
// 且不限定首字符 —— 以引号开头的直接引语句（如 'I trust you completely,' he said.）必须能通过。
// 这样只拦明显非法内容（中文、emoji、控制字符等），不再误杀正常英文标点。
const EN_ALLOWED_RE =
  /^[A-Za-z0-9\s.,!?;:'"()\[\]{}\-_/\\&@#$%*+=<>|~^`’‘“”—–…]*$/

export function isValidEnglish(value) {
  const v = String(value ?? '').trim()
  if (!v) return false
  // 至少要有一个字母或数字，避免只输入一串标点
  if (!/[A-Za-z0-9]/.test(v)) return false
  return EN_ALLOWED_RE.test(v)
}
