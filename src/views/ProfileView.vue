<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api/index.js'

const router = useRouter()
const user = ref({ isLoggedIn: false, username: '', isAdmin: false })

// 修改密码
const showPwdModal = ref(false)
const pwdForm = ref({ oldPwd: '', newPwd: '', confirmPwd: '' })
const pwdError = ref('')
const showAuthModal = ref(false)
const authMode = ref('login')
const authForm = ref({ username: '', password: '' })
const authError = ref('')

onMounted(async () => {
  try {
    user.value = await api.me()
  } catch (e) {}
})

async function changePwd() {
  pwdError.value = ''
  if (!pwdForm.value.oldPwd || !pwdForm.value.newPwd) { pwdError.value = '请填写完整'; return }
  if (pwdForm.value.newPwd.length < 6) { pwdError.value = '新密码至少 6 位'; return }
  if (pwdForm.value.newPwd !== pwdForm.value.confirmPwd) { pwdError.value = '两次新密码不一致'; return }
  try {
    await api.changePassword(pwdForm.value.oldPwd, pwdForm.value.newPwd)
    showPwdModal.value = false
    pwdForm.value = { oldPwd: '', newPwd: '', confirmPwd: '' }
    alert('✅ 密码修改成功')
  } catch (e) { pwdError.value = e.message }
}

async function doAuth() {
  authError.value = ''
  const { username, password } = authForm.value
  if (!username.trim() || !password) { authError.value = '请输入用户名和密码'; return }
  try {
    const fn = authMode.value === 'login' ? api.login : api.register
    await fn(username.trim(), password)
    showAuthModal.value = false
    window.location.reload()
  } catch (e) { authError.value = e.message }
}

async function doLogout() {
  await api.logout()
  window.location.reload()
}
</script>

<template>
  <div class="profile-page">
    <!-- 用户头部卡片 -->
    <div class="profile-header" @click="!user.isLoggedIn && (showAuthModal = true)">
      <div v-if="user.isLoggedIn" class="avatar">{{ user.username[0].toUpperCase() }}</div>
      <div class="header-info">
        <div class="username">{{ user.isLoggedIn ? user.username : '登录 / 注册' }}</div>
        <div v-if="user.isAdmin" class="admin-tag">管理员</div>
      </div>
      <span v-if="!user.isLoggedIn" class="chevron">›</span>
    </div>

    <!-- 菜单列表 -->
    <div class="menu-group">
      <div class="menu-item" @click="router.push('/settings')">
        <span class="menu-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </span>
        <span class="menu-label">设置</span>
        <span class="menu-arrow">›</span>
      </div>
      <div v-if="user.isAdmin" class="menu-item" @click="router.push('/admin')">
        <span class="menu-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </span>
        <span class="menu-label">用户管理</span>
        <span class="menu-arrow">›</span>
      </div>
    </div>

    <div class="menu-group">
      <div v-if="user.isLoggedIn" class="menu-item" @click="showPwdModal = true">
        <span class="menu-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </span>
        <span class="menu-label">修改密码</span>
        <span class="menu-arrow">›</span>
      </div>
      <div v-if="user.isLoggedIn" class="menu-item" @click="doLogout">
        <span class="menu-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        </span>
        <span class="menu-label">退出登录</span>
        <span class="menu-arrow">›</span>
      </div>
    </div>

    <div class="version">背单词助手 v2.0</div>

    <!-- 登录/注册弹窗 -->
    <div v-if="showAuthModal" class="mask" @click.self="showAuthModal = false">
      <div class="modal">
        <div class="modal-head">
          <h3>{{ authMode === 'login' ? '登录' : '注册新账号' }}</h3>
          <button class="modal-close" @click="showAuthModal = false">✕</button>
        </div>
        <div class="modal-body">
          <div class="auth-tabs">
            <button :class="{ active: authMode === 'login' }" @click="authMode = 'login'; authError = ''">登录</button>
            <button :class="{ active: authMode === 'register' }" @click="authMode = 'register'; authError = ''">注册</button>
          </div>
          <input v-model="authForm.username" placeholder="用户名（2-20位字母数字下划线）" autocomplete="username" />
          <input v-model="authForm.password" type="password" :placeholder="authMode === 'login' ? '密码' : '密码（至少6位）'" @keyup.enter="doAuth" />
          <div v-if="authError" class="err">{{ authError }}</div>
          <button class="btn primary" @click="doAuth">{{ authMode === 'login' ? '登录' : '注册并登录' }}</button>
        </div>
      </div>
    </div>

    <!-- 修改密码弹窗 -->
    <div v-if="showPwdModal" class="mask" @click.self="showPwdModal = false">
      <div class="modal">
        <div class="modal-head">
          <h3>修改密码</h3>
          <button class="modal-close" @click="showPwdModal = false">✕</button>
        </div>
        <div class="modal-body">
          <input v-model="pwdForm.oldPwd" type="password" placeholder="原密码" />
          <input v-model="pwdForm.newPwd" type="password" placeholder="新密码（至少6位）" />
          <input v-model="pwdForm.confirmPwd" type="password" placeholder="确认新密码" @keyup.enter="changePwd" />
          <div v-if="pwdError" class="err">{{ pwdError }}</div>
          <div class="row">
            <button class="btn ghost" @click="showPwdModal = false">取消</button>
            <button class="btn primary" @click="changePwd">确认修改</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.profile-page { padding-bottom: 20px; }

/* 头部卡片 */
.profile-header {
  background: #fff;
  padding: 20px 16px;
  display: flex;
  align-items: center;
  gap: 14px;
  cursor: pointer;
  margin-bottom: 8px;
}
.avatar {
  width: 56px;
  height: 56px;
  border-radius: 8px;
  background: var(--primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  font-weight: 600;
  color: #fff;
}
.header-info { flex: 1; display: flex; flex-direction: column; gap: 4px; }
.username { font-size: 17px; font-weight: 500; color: var(--text-main); }
.admin-tag {
  background: #f5f5f5;
  color: var(--text-sub);
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  width: fit-content;
}

/* 菜单组 */
.menu-group {
  background: #fff;
  margin-bottom: 8px;
  overflow: hidden;
}
.menu-item {
  display: flex;
  align-items: center;
  padding: 14px 16px;
  cursor: pointer;
  border-bottom: 0.5px solid #f0f0f0;
  transition: background 0.15s;
}
.menu-item:last-child { border-bottom: none; }
.menu-item:active { background: #f5f5f5; }
.menu-icon {
  width: 24px;
  margin-right: 12px;
  color: var(--text-sub);
  display: flex;
  align-items: center;
  justify-content: center;
}
.menu-label { flex: 1; font-size: 16px; color: var(--text-main); }
.danger-text { color: #fa5151; }
.menu-arrow { color: #c8c8c8; font-size: 18px; }

.version { text-align: center; color: var(--text-faint); font-size: 12px; margin-top: 24px; }

/* 弹窗 */
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
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.auth-tabs {
  display: flex;
  background: #f5f5f5;
  border-radius: 8px;
  padding: 3px;
  gap: 3px;
}
.auth-tabs button {
  flex: 1;
  padding: 8px;
  border: none;
  background: transparent;
  border-radius: 6px;
  font-size: 14px;
  color: var(--text-sub);
  cursor: pointer;
}
.auth-tabs button.active {
  background: #fff;
  color: var(--text-main);
  font-weight: 500;
}
.modal-body input {
  padding: 12px;
  border: none;
  background: #f5f5f5;
  border-radius: 8px;
  font-size: 15px;
  outline: none;
}
.err { color: var(--danger); font-size: 13px; }
.row { display: flex; gap: 8px; }
.row .btn { flex: 1; }

@media (min-width: 769px) {
  .profile-page { max-width: 500px; margin: 0 auto; }
}
</style>
