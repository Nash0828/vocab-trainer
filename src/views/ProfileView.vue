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
      <div class="avatar">{{ user.isLoggedIn ? user.username[0].toUpperCase() : '👤' }}</div>
      <div class="header-info">
        <div class="username">{{ user.isLoggedIn ? user.username : '点击登录 / 注册' }}</div>
        <div v-if="user.isAdmin" class="admin-tag">管理员</div>
      </div>
      <div class="chevron">›</div>
    </div>

    <!-- 菜单列表 -->
    <div class="menu-group">
      <div class="menu-item" @click="router.push('/settings')">
        <span class="menu-icon">⚙️</span>
        <span class="menu-label">设置</span>
        <span class="menu-arrow">›</span>
      </div>
      <div v-if="user.isAdmin" class="menu-item" @click="router.push('/admin')">
        <span class="menu-icon">👥</span>
        <span class="menu-label">用户管理</span>
        <span class="menu-arrow">›</span>
      </div>
    </div>

    <div class="menu-group">
      <div v-if="user.isLoggedIn" class="menu-item" @click="showPwdModal = true">
        <span class="menu-icon">🔑</span>
        <span class="menu-label">修改密码</span>
        <span class="menu-arrow">›</span>
      </div>
      <div v-if="user.isLoggedIn" class="menu-item" @click="doLogout">
        <span class="menu-icon">🚪</span>
        <span class="menu-label danger-text">退出登录</span>
        <span class="menu-arrow">›</span>
      </div>
      <div v-if="!user.isLoggedIn" class="menu-item" @click="showAuthModal = true">
        <span class="menu-icon">🔓</span>
        <span class="menu-label">登录 / 注册</span>
        <span class="menu-arrow">›</span>
      </div>
    </div>

    <div class="version">背单词助手 v2.0</div>

    <!-- 登录/注册弹窗 -->
    <div v-if="showAuthModal" class="mask" @click.self="showAuthModal = false">
      <div class="modal">
        <h3>{{ authMode === 'login' ? '登录' : '注册新账号' }}</h3>
        <div class="tabs">
          <button :class="{ active: authMode === 'login' }" @click="authMode = 'login'; authError = ''">登录</button>
          <button :class="{ active: authMode === 'register' }" @click="authMode = 'register'; authError = ''">注册</button>
        </div>
        <input v-model="authForm.username" placeholder="用户名（2-20位字母数字下划线）" autocomplete="username" />
        <input v-model="authForm.password" type="password" :placeholder="authMode === 'login' ? '密码' : '密码（至少6位）'" @keyup.enter="doAuth" />
        <div v-if="authError" class="err">{{ authError }}</div>
        <button class="btn primary" @click="doAuth">{{ authMode === 'login' ? '登录' : '注册并登录' }}</button>
      </div>
    </div>

    <!-- 修改密码弹窗 -->
    <div v-if="showPwdModal" class="mask" @click.self="showPwdModal = false">
      <div class="modal">
        <h3>修改密码</h3>
        <input v-model="pwdForm.oldPwd" type="password" placeholder="原密码" />
        <input v-model="pwdForm.newPwd" type="password" placeholder="新密码（至少6位）" />
        <input v-model="pwdForm.confirmPwd" type="password" placeholder="确认新密码" @keyup.enter="changePwd" />
        <div v-if="pwdError" class="err">{{ pwdError }}</div>
        <div style="display:flex;gap:8px">
          <button class="btn primary" style="flex:1" @click="changePwd">确认修改</button>
          <button class="btn ghost" @click="showPwdModal = false">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.profile-page { padding-bottom: 20px; }

/* 头部卡片 */
.profile-header {
  background: linear-gradient(135deg, #4a90d9, #3a76b8);
  border-radius: 16px; padding: 24px 20px; display: flex; align-items: center; gap: 16px;
  color: #fff; cursor: pointer; margin-bottom: 16px;
}
.avatar {
  width: 56px; height: 56px; border-radius: 50%; background: rgba(255,255,255,0.25);
  display: flex; align-items: center; justify-content: center; font-size: 26px; font-weight: 700;
}
.header-info { flex: 1; display: flex; flex-direction: column; gap: 4px; }
.username { font-size: 18px; font-weight: 700; }
.admin-tag { background: rgba(255,255,255,0.25); font-size: 11px; padding: 2px 8px; border-radius: 999px; width: fit-content; }
.chevron { font-size: 24px; opacity: 0.6; }

/* 菜单组 */
.menu-group {
  background: #fff; border-radius: 12px; margin-bottom: 12px; overflow: hidden;
}
.menu-item {
  display: flex; align-items: center; padding: 14px 16px; cursor: pointer;
  border-bottom: 1px solid #f0f0f0; transition: background 0.15s;
}
.menu-item:last-child { border-bottom: none; }
.menu-item:active { background: #f5f5f5; }
.menu-icon { font-size: 20px; margin-right: 12px; }
.menu-label { flex: 1; font-size: 15px; color: var(--text-main); }
.danger-text { color: #ff4d4f; }
.menu-arrow { color: #c8c8c8; font-size: 20px; }

.version { text-align: center; color: var(--text-faint); font-size: 12px; margin-top: 24px; }

/* 弹窗 */
.mask { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 200; display: flex; align-items: center; justify-content: center; padding: 16px; }
.modal { background: #fff; border-radius: 16px; padding: 24px; width: 100%; max-width: 360px; display: flex; flex-direction: column; gap: 12px; }
.modal h3 { margin: 0; text-align: center; }
.tabs { display: flex; gap: 8px; }
.tabs button { flex: 1; padding: 8px; border: 1px solid var(--border-light); background: #fff; border-radius: 8px; cursor: pointer; font-weight: 600; color: var(--text-sub); }
.tabs button.active { background: var(--primary); color: #fff; border-color: var(--primary); }
.modal input { padding: 10px 12px; border: 1px solid var(--border-light); border-radius: 8px; font-size: 15px; }
.err { color: var(--danger); font-size: 13px; }

@media (min-width: 769px) {
  .profile-page { max-width: 500px; margin: 0 auto; }
}
</style>
