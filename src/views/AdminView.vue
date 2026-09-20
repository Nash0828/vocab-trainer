<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../api/index.js'

const users = ref([])
const loading = ref(true)
const error = ref('')
const selectedLogs = ref(null)
const resetPwdUser = ref(null)
const resetPwdResult = ref('')
const confirmDelete = ref(null)

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
    await api.adminDeleteUser(user.id)
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

    <table v-else class="user-table">
      <thead>
        <tr>
          <th>用户名</th>
          <th>单词数</th>
          <th>创建时间</th>
          <th>最近登录</th>
          <th>最近 IP</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="u in users" :key="u.id">
          <td><strong>{{ u.username }}</strong><span v-if="u.isAdmin" class="tag-admin">管理员</span></td>
          <td>{{ u.wordCount }}</td>
          <td>{{ fmtTime(u.createdAt) }}</td>
          <td>{{ fmtTime(u.lastLoginAt) }}</td>
          <td>{{ u.lastLoginIp || '—' }}</td>
          <td>
            <span v-if="u.isDisabled" class="tag-disabled">已禁用</span>
            <span v-else class="tag-active">正常</span>
          </td>
          <td class="actions">
            <button class="btn ghost mini" @click="showLogs(u)">日志</button>
            <button v-if="!u.isAdmin" class="btn ghost mini" @click="doResetPwd(u)">重置密码</button>
            <button v-if="!u.isAdmin" class="btn ghost mini" @click="toggleDisable(u)">
              {{ u.isDisabled ? '启用' : '禁用' }}
            </button>
            <button v-if="!u.isAdmin" class="btn danger-ghost mini" @click="confirmDelete = u">删除</button>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- 日志弹窗 -->
    <div v-if="selectedLogs" class="mask" @click.self="selectedLogs = null">
      <div class="modal">
        <div class="modal-head">
          <h3>{{ selectedLogs.user.username }} 登录日志</h3>
          <button class="modal-close" @click="selectedLogs = null">✕</button>
        </div>
        <div class="modal-body">
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
    <div v-if="resetPwdUser" class="mask" @click.self="resetPwdUser = null">
      <div class="modal">
        <div class="modal-head">
          <h3>重置密码</h3>
          <button class="modal-close" @click="resetPwdUser = null">✕</button>
        </div>
        <div class="modal-body">
          <p class="result-text">已重置 <strong>{{ resetPwdUser.username }}</strong> 的密码</p>
          <div class="new-pwd-box">新密码：{{ resetPwdResult }}</div>
          <p class="muted small">请复制给用户并提醒其登录后修改密码</p>
          <button class="btn primary" @click="resetPwdUser = null">知道了</button>
        </div>
      </div>
    </div>

    <!-- 删除确认 -->
    <div v-if="confirmDelete" class="mask" @click.self="confirmDelete = null">
      <div class="modal">
        <div class="modal-head">
          <h3>确认删除</h3>
          <button class="modal-close" @click="confirmDelete = null">✕</button>
        </div>
        <div class="modal-body">
          <p class="confirm-text">确定要删除用户 <strong>{{ confirmDelete.username }}</strong> 吗？</p>
          <p class="muted small">该用户的所有单词、记录、错题本都会被删除，不可恢复！</p>
          <div class="row">
            <button class="btn danger" @click="doDelete(confirmDelete)">确认删除</button>
            <button class="btn ghost" @click="confirmDelete = null">取消</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.user-table { width: 100%; border-collapse: collapse; margin-top: 16px; }
.user-table th, .user-table td { padding: 10px 8px; text-align: left; border-bottom: 1px solid var(--border-light); font-size: 14px; }
.user-table th { color: var(--text-sub); font-weight: 600; }
.tag-admin { background: #ff4d4f; color: #fff; font-size: 11px; padding: 1px 6px; border-radius: 4px; margin-left: 6px; }
.tag-active { color: #52c41a; font-size: 13px; }
.tag-disabled { color: #ff4d4f; font-size: 13px; }
.actions { display: flex; gap: 4px; flex-wrap: wrap; }

.mask {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 200;
  display: flex;
  align-items: flex-end;
  justify-content: center;
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
  .user-table td:nth-child(5)::before { content: 'IP：'; color: var(--text-faint); }
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
