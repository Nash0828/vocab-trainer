<script setup>
import { ref, computed, onMounted } from 'vue'
import { api } from '../api/index.js'

const users = ref([])
const loading = ref(true)
const error = ref('')
const filter = ref('all')
const selectedLogs = ref(null)
const resetPwdUser = ref(null)
const resetPwdResult = ref('')
const confirmDelete = ref(null)
const confirmResetPwd = ref(null)
const confirmToggle = ref(null)

const filteredUsers = computed(() => {
  if (filter.value === 'registered') return users.value.filter(u => !u.isGuest)
  if (filter.value === 'guest') return users.value.filter(u => u.isGuest)
  return users.value
})

async function loadUsers() {
  loading.value = true
  error.value = ''
  try {
    const res = await api.adminUsers()
    users.value = res.users
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function showLogs(user) {
  try {
    const res = await api.adminUserLogs(user.id)
    selectedLogs.value = { user, logs: res.logs }
  } catch (e) {
    alert(e.message)
  }
}

async function doResetPwd(user) {
  try {
    const res = await api.adminResetPassword(user.id)
    resetPwdUser.value = user
    resetPwdResult.value = res.newPassword
  } catch (e) {
    alert(e.message)
  }
}

async function toggleDisable(user) {
  try {
    await api.adminToggleDisable(user.id)
    await loadUsers()
  } catch (e) {
    alert(e.message)
  }
}

async function doDelete(user) {
  try {
    await api.adminDeleteUser(user.guestId || user.id) // 访客按真实 user_id 删除
    confirmDelete.value = null
    await loadUsers()
  } catch (e) {
    alert(e.message)
  }
}

function fmtTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

onMounted(loadUsers)
</script>

<template>
  <div class="admin-page">
    <div v-if="loading" class="muted">加载中...</div>
    <div v-else-if="error" class="error">{{ error }}</div>

    <template v-else>
      <!-- 筛选栏 -->
      <div class="filter-bar">
        <button :class="{ active: filter === 'all' }" @click="filter = 'all'">全部</button>
        <button :class="{ active: filter === 'registered' }" @click="filter = 'registered'">注册用户</button>
        <button :class="{ active: filter === 'guest' }" @click="filter = 'guest'">访客</button>
      </div>

      <div class="user-list">
        <div v-for="u in filteredUsers" :key="u.id" class="user-card">
          <div class="uc-head">
            <div class="uc-avatar" :class="{ admin: u.isAdmin, guest: u.isGuest }">{{ u.username.charAt(0).toUpperCase() }}</div>
            <div class="uc-info">
              <div class="uc-name-row">
                <span class="uc-name">{{ u.username }}</span>
                <span v-if="u.isAdmin" class="tag-admin">管理员</span>
                <span v-if="u.isGuest" class="tag-guest">访客</span>
                <span v-if="u.isDisabled" class="tag-disabled">已禁用</span>
              </div>
              <div class="uc-meta">最近活跃 {{ fmtTime(u.lastLoginAt) }}</div>
            </div>
          </div>
          <div class="uc-stats">
            <span>{{ u.wordCount }} 词句</span>
            <span class="uc-dot">·</span>
            <span>创建于 {{ fmtTime(u.createdAt) }}</span>
          </div>
          <div class="uc-actions">
            <button class="uc-icon-btn" title="日志" @click="showLogs(u)">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            </button>
            <button v-if="!u.isAdmin && !u.isGuest" class="uc-icon-btn" title="重置密码" @click="confirmResetPwd = u">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
            </button>
            <button v-if="!u.isAdmin && !u.isGuest" class="uc-icon-btn" :title="u.isDisabled ? '启用' : '禁用'" @click="confirmToggle = u">
              <svg v-if="!u.isDisabled" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              <svg v-else width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            </button>
            <button v-if="!u.isAdmin" class="uc-icon-btn danger" title="删除" @click="confirmDelete = u">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            </button>
          </div>
        </div>
        <div v-if="!filteredUsers.length" class="empty-state">
          <p class="empty-title">暂无用户</p>
        </div>
      </div>
    </template>

    <!-- 日志弹窗 -->
    <div v-if="selectedLogs" class="mask" @click.self="selectedLogs = null" @touchmove.prevent>
      <div class="modal">
        <div class="modal-head">
          <h3>{{ selectedLogs.user.username }} 登录日志</h3>
          <button class="modal-close" @click="selectedLogs = null">✕</button>
        </div>
        <div class="modal-body" @touchmove.stop>
          <div v-if="!selectedLogs.logs.length" class="empty-tip">暂无记录</div>
          <ul v-else class="log-list">
            <li v-for="l in selectedLogs.logs" :key="l.id">
              <div class="log-main">
                <span class="log-action">{{ l.action }}</span>
                <span class="log-time">{{ fmtTime(l.ts) }}</span>
              </div>
              <div class="log-sub">
                <span class="log-ip">IP：{{ l.ip }}</span>
                <span v-if="l.detail" class="log-detail">{{ l.detail }}</span>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- 重置密码结果弹窗 -->
    <div v-if="resetPwdUser" class="mask" @click.self="resetPwdUser = null" @touchmove.prevent>
      <div class="modal">
        <div class="modal-head">
          <h3>重置密码</h3>
          <button class="modal-close" @click="resetPwdUser = null">✕</button>
        </div>
        <div class="modal-body" @touchmove.stop>
          <p class="result-text">已重置 <strong>{{ resetPwdUser.username }}</strong> 的密码</p>
          <div class="new-pwd-box">新密码：{{ resetPwdResult }}</div>
          <p class="muted small">请复制给用户并提醒其登录后修改密码</p>
          <button class="btn primary" @click="resetPwdUser = null">知道了</button>
        </div>
      </div>
    </div>

    <!-- 删除确认 -->
    <div v-if="confirmDelete" class="mask" @click.self="confirmDelete = null" @touchmove.prevent>
      <div class="modal">
        <div class="modal-head">
          <h3>确认删除</h3>
          <button class="modal-close" @click="confirmDelete = null">✕</button>
        </div>
        <div class="modal-body" @touchmove.stop>
          <p class="confirm-text">确定要删除{{ confirmDelete.isGuest ? '访客' : '用户' }} <strong>{{ confirmDelete.username }}</strong> 吗？删除后其词句库、背诵记录等数据将全部清除，且无法恢复。</p>
          <p class="muted small">该用户的所有单词、记录、错题本都会被删除，不可恢复！</p>
          <div class="row">
            <button class="btn danger" @click="doDelete(confirmDelete)">确认删除</button>
            <button class="btn ghost" @click="confirmDelete = null">取消</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 重置密码确认 -->
    <div v-if="confirmResetPwd" class="mask" @click.self="confirmResetPwd = null" @touchmove.prevent>
      <div class="modal">
        <div class="modal-head">
          <h3>重置密码</h3>
          <button class="modal-close" @click="confirmResetPwd = null">✕</button>
        </div>
        <div class="modal-body" @touchmove.stop>
          <p class="confirm-text">确定要重置 <strong>{{ confirmResetPwd.username }}</strong> 的密码吗？</p>
          <p class="muted small">重置后将生成新的随机密码，请提醒用户及时修改。</p>
          <div class="row">
            <button class="btn primary" @click="doResetPwd(confirmResetPwd); confirmResetPwd = null">确认重置</button>
            <button class="btn ghost" @click="confirmResetPwd = null">取消</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 禁用/启用确认 -->
    <div v-if="confirmToggle" class="mask" @click.self="confirmToggle = null" @touchmove.prevent>
      <div class="modal">
        <div class="modal-head">
          <h3>{{ confirmToggle.isDisabled ? '启用用户' : '禁用用户' }}</h3>
          <button class="modal-close" @click="confirmToggle = null">✕</button>
        </div>
        <div class="modal-body" @touchmove.stop>
          <p class="confirm-text">
            确定要{{ confirmToggle.isDisabled ? '启用' : '禁用' }}用户 <strong>{{ confirmToggle.username }}</strong> 吗？
          </p>
          <p v-if="!confirmToggle.isDisabled" class="muted small">禁用后该用户将无法登录。</p>
          <div class="row">
            <button class="btn primary" @click="toggleDisable(confirmToggle); confirmToggle = null">确认</button>
            <button class="btn ghost" @click="confirmToggle = null">取消</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.filter-bar {
  display: flex;
  background: #fff;
  margin: 8px 16px;
  border-radius: 10px;
  padding: 3px;
  gap: 3px;
}
.filter-bar button {
  flex: 1;
  border: none;
  background: transparent;
  padding: 8px;
  border-radius: 8px;
  font-size: 14px;
  color: var(--text-sub);
  cursor: pointer;
}
.filter-bar button.active {
  background: var(--primary);
  color: #fff;
}

.user-list {
  margin: 0 16px;
}
.user-card {
  background: #fff;
  border-radius: 12px;
  padding: 14px;
  margin-bottom: 10px;
}
.uc-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.uc-avatar {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: #e7ebf3;
  color: #576b95;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  font-weight: 600;
  flex-shrink: 0;
}
.uc-avatar.admin {
  background: rgba(250, 81, 81, 0.1);
  color: #fa5151;
}
.uc-avatar.guest {
  background: rgba(250, 157, 59, 0.12);
  color: #fa9d3b;
}
.uc-info {
  flex: 1;
  min-width: 0;
}
.uc-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 3px;
}
.uc-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tag-admin {
  background: rgba(250, 81, 81, 0.1);
  color: #fa5151;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}
.tag-guest {
  background: rgba(250, 157, 59, 0.12);
  color: #fa9d3b;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}
.tag-disabled {
  background: #f5f5f5;
  color: var(--text-sub);
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}
.uc-meta {
  font-size: 13px;
  color: var(--text-sub);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.uc-stats {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-sub);
  margin: 10px 0 0 54px;
}
.uc-dot {
  color: #d0d0d0;
}
.uc-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  border-top: 0.5px solid #f0f0f0;
  padding-top: 10px;
  margin-top: 10px;
}
.uc-icon-btn {
  width: 34px;
  height: 34px;
  border: none;
  background: #f5f5f5;
  border-radius: 50%;
  color: var(--text-main);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}
.uc-icon-btn.danger {
  color: #fa5151;
}
.uc-icon-btn:active {
  background: #e0e0e0;
}

.mask {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 200;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  touch-action: none;
}
.modal {
  background: #fff;
  border-radius: 16px 16px 0 0;
  width: 100%;
  max-width: 100%;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  touch-action: pan-y;
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  position: relative;
  border-bottom: 0.5px solid #f0f0f0;
}
.modal-head h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-main);
}
.modal-close {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  border: none;
  background: #f0f0f0;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  font-size: 14px;
  cursor: pointer;
  color: #888;
  display: flex;
  align-items: center;
  justify-content: center;
}
.modal-body {
  padding: 16px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}
.empty-tip {
  text-align: center;
  padding: 40px 0;
  color: var(--text-sub);
  font-size: 15px;
}
.log-list { list-style: none; padding: 0; margin: 0; }
.log-list li {
  padding: 12px 0;
  border-bottom: 0.5px solid #f0f0f0;
}
.log-list li:last-child { border-bottom: none; }
.log-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.log-action { font-weight: 600; color: var(--text-main); font-size: 15px; }
.log-time { color: var(--text-sub); font-size: 13px; }
.log-sub { display: flex; flex-direction: column; gap: 2px; }
.log-ip { color: var(--text-sub); font-size: 13px; }
.log-detail { color: var(--text-sub); font-size: 13px; }
.result-text { font-size: 15px; color: var(--text-main); margin: 0 0 12px 0; }
.new-pwd-box {
  background: #f5f5f5;
  padding: 12px;
  border-radius: 8px;
  font-size: 18px;
  color: var(--primary);
  text-align: center;
  margin-bottom: 12px;
  font-weight: 600;
}
.confirm-text { font-size: 16px; color: var(--text-main); margin: 0 0 8px 0; }
.row {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}
.row .btn { flex: 1; }
.error { color: var(--danger); padding: 20px; }

@media (max-width: 768px) {
  .user-table, .user-table thead, .user-table tbody, .user-table tr, .user-table td {
    display: block;
  }
  .user-table thead { display: none; }
  .user-table tr {
    background: #fff;
    border-bottom: 8px solid #f2f2f2;
    padding: 12px 14px;
  }
  .user-table td {
    border: none;
    padding: 2px 0;
    font-size: 14px;
  }
  .user-table td:first-child {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .user-table td:nth-child(2)::before { content: '单词数：'; color: var(--text-faint); }
  .user-table td:nth-child(3)::before { content: '创建时间：'; color: var(--text-faint); }
  .user-table td:nth-child(4)::before { content: '最近登录：'; color: var(--text-faint); }
  .user-table td:nth-child(6)::before { content: '状态：'; color: var(--text-faint); }
  .user-table td.actions {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 0.5px solid #f0f0f0;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
}
</style>
