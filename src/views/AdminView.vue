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
  <section class="card">
    <div class="card-head">
      <h2>用户管理</h2>
      <p class="muted">查看和管理所有注册用户</p>
    </div>

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
        <h3>📋 {{ selectedLogs.user.username }} 登录日志</h3>
        <div v-if="!selectedLogs.logs.length" class="muted">暂无记录</div>
        <ul v-else class="log-list">
          <li v-for="l in selectedLogs.logs" :key="l.id">
            <span class="log-time">{{ fmtTime(l.ts) }}</span>
            <span class="log-action">{{ l.action }}</span>
            <span class="log-ip">{{ l.ip }}</span>
            <span v-if="l.detail" class="log-detail">{{ l.detail }}</span>
          </li>
        </ul>
        <button class="btn ghost" @click="selectedLogs = null">关闭</button>
      </div>
    </div>

    <!-- 重置密码结果弹窗 -->
    <div v-if="resetPwdUser" class="mask" @click.self="resetPwdUser = null">
      <div class="modal">
        <h3>🔑 已重置 {{ resetPwdUser.username }} 的密码</h3>
        <p>新密码：<code class="new-pwd">{{ resetPwdResult }}</code></p>
        <p class="muted small">请复制给用户并提醒其登录后修改密码</p>
        <button class="btn primary" @click="resetPwdUser = null">知道了</button>
      </div>
    </div>

    <!-- 删除确认 -->
    <div v-if="confirmDelete" class="mask" @click.self="confirmDelete = null">
      <div class="modal">
        <h3>⚠️ 确认删除 {{ confirmDelete.username }}？</h3>
        <p class="muted">该用户的所有单词、记录、错题本都会被删除，不可恢复！</p>
        <div class="row">
          <button class="btn danger" @click="doDelete(confirmDelete)">确认删除</button>
          <button class="btn ghost" @click="confirmDelete = null">取消</button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.user-table { width: 100%; border-collapse: collapse; margin-top: 16px; }
.user-table th, .user-table td { padding: 10px 8px; text-align: left; border-bottom: 1px solid var(--border-light); font-size: 14px; }
.user-table th { color: var(--text-sub); font-weight: 600; }
.tag-admin { background: #ff4d4f; color: #fff; font-size: 11px; padding: 1px 6px; border-radius: 4px; margin-left: 6px; }
.tag-active { color: #52c41a; font-size: 13px; }
.tag-disabled { color: #ff4d4f; font-size: 13px; }
.actions { display: flex; gap: 4px; flex-wrap: wrap; }

.mask { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 200; display: flex; align-items: center; justify-content: center; padding: 16px; }
.modal { background: #fff; border-radius: 16px; padding: 20px; width: 100%; max-width: 480px; max-height: 80vh; overflow-y: auto; }
.modal h3 { margin: 0 0 12px; }
.log-list { list-style: none; padding: 0; margin: 0 0 12px; }
.log-list li { padding: 8px 0; border-bottom: 1px solid var(--border-light); font-size: 13px; display: flex; gap: 8px; flex-wrap: wrap; }
.log-time { color: var(--text-sub); min-width: 130px; }
.log-action { font-weight: 600; color: var(--primary); }
.log-ip { color: var(--text-faint); }
.log-detail { color: var(--text-sub); width: 100%; }
.new-pwd { background: var(--bg-soft); padding: 4px 12px; border-radius: 6px; font-size: 18px; color: var(--primary); }
.row { display: flex; gap: 8px; margin-top: 12px; }
.error { color: var(--danger); padding: 20px; }

@media (max-width: 768px) {
  .card {
    padding: 0;
  }
  .card-head {
    padding: 14px 15px 0;
  }
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
  .modal { max-width: 100%; border-radius: 12px; }
  .log-time { min-width: auto; width: 100%; }
}
</style>
