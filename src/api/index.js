/**
 * 后端 API 封装层
 * 所有写操作：先改内存 ref（乐观更新），再异步同步到后端
 */

async function req(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `请求失败: ${res.status}`)
  }
  return res.json()
}

export const api = {
  // 全量状态（启动时调用一次）
  getState: () => req('/api/state'),

  // 认证
  me: () => req('/api/me'),
  register: (username, password) => req('/api/register', { method: 'POST', body: { username, password } }),
  login: (username, password) => req('/api/login', { method: 'POST', body: { username, password } }),
  logout: () => req('/api/logout', { method: 'POST' }),
  changePassword: (oldPassword, newPassword) => req('/api/me/password', { method: 'PUT', body: { oldPassword, newPassword } }),

  // 管理员
  adminUsers: () => req('/api/admin/users'),
  adminUserLogs: (id) => req(`/api/admin/users/${id}/logs`),
  adminResetPassword: (id) => req(`/api/admin/users/${id}/password`, { method: 'PUT' }),
  adminToggleDisable: (id) => req(`/api/admin/users/${id}/disable`, { method: 'PUT' }),
  adminDeleteUser: (id) => req(`/api/admin/users/${id}`, { method: 'DELETE' }),

  // 单词 CRUD
  addWord: (data) => req('/api/words', { method: 'POST', body: data }),
  updateWord: (id, data) => req(`/api/words/${id}`, { method: 'PUT', body: data }),
  removeWord: (id) => req(`/api/words/${id}`, { method: 'DELETE' }),
  incrementCount: (id) => req(`/api/words/${id}/increment`, { method: 'POST' }),
  resetCount: (id) => req(`/api/words/${id}/reset-count`, { method: 'POST' }),
  resetAllCounts: () => req('/api/words/reset-all-counts', { method: 'POST' }),

  // 设置
  setThreshold: (value) => req('/api/settings/threshold', { method: 'PUT', body: { value } }),

  // 背诵记录
  addRecord: (data) => req('/api/records', { method: 'POST', body: data }),
  clearDay: (date) => req(`/api/records/${date}`, { method: 'DELETE' }),
  clearAllRecords: () => req('/api/records', { method: 'DELETE' }),

  // 错题本
  addWrong: (data) => req('/api/wrongbook', { method: 'POST', body: data }),
  removeWrong: (wordId) => req(`/api/wrongbook/${wordId}`, { method: 'DELETE' }),
  clearWrongbook: () => req('/api/wrongbook', { method: 'DELETE' }),

  // 导入导出
  exportData: () => req('/api/export'),
  importData: (data, mode) => req('/api/import', { method: 'POST', body: { data, mode } }),
  migrateData: (payload) => req('/api/migrate', { method: 'POST', body: payload }),
}
