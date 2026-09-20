<script setup>
import { ref, onMounted } from 'vue'
import { RouterLink, RouterView } from 'vue-router'
import { api } from './api/index.js'

const navItems = [
  { to: '/input', label: '录入', icon: '✍️' },
  { to: '/practice', label: '背单词', icon: '🎯' },
  { to: '/wrongbook', label: '错题本', icon: '📕' },
  { to: '/library', label: '词库', icon: '🗂️' },
  { to: '/history', label: '历史', icon: '📜' },
  { to: '/settings', label: '设置', icon: '⚙️' },
]

const user = ref({ isLoggedIn: false, username: '', isAdmin: false })
const showAuthModal = ref(false)
const authMode = ref('login') // 'login' | 'register'
const authForm = ref({ username: '', password: '' })
const authError = ref('')

onMounted(async () => {
  try {
    const me = await api.me()
    user.value = me
  } catch (e) {}
})

async function doAuth() {
  authError.value = ''
  const { username, password } = authForm.value
  if (!username.trim() || !password) {
    authError.value = '请输入用户名和密码'
    return
  }
  try {
    const fn = authMode.value === 'login' ? api.login : api.register
    const res = await fn(username.trim(), password)
    user.value = res.user
    showAuthModal.value = false
    authForm.value = { username: '', password: '' }
    // 刷新页面加载新用户数据
    window.location.reload()
  } catch (e) {
    authError.value = e.message
  }
}

async function doLogout() {
  await api.logout()
  window.location.reload()
}
</script>

<template>
  <div class="app-shell">
    <aside class="app-sidebar">
      <div class="brand">
        <span class="brand-logo">📚</span>
        <span class="brand-name">背单词助手</span>
      </div>
      <nav class="side-nav">
        <RouterLink v-for="item in navItems" :key="item.to" :to="item.to">
          <span class="nav-icon">{{ item.icon }}</span>
          <span class="nav-label">{{ item.label }}</span>
        </RouterLink>
      </nav>

      <!-- 用户区 -->
      <div class="user-area">
        <template v-if="user.isLoggedIn">
          <div class="user-info">
            <span class="user-name">👤 {{ user.username }}</span>
            <span v-if="user.isAdmin" class="admin-badge">管理员</span>
          </div>
          <button class="btn ghost mini" @click="doLogout">退出登录</button>
        </template>
        <template v-else>
          <div class="anon-tip">未登录（清缓存会丢数据，建议注册）</div>
          <button class="btn primary mini" @click="showAuthModal = true">登录 / 注册</button>
        </template>
      </div>
    </aside>

    <div class="app-body">
      <main class="app-main">
        <RouterView />
      </main>
    </div>

    <nav class="mobile-nav">
      <RouterLink v-for="item in navItems" :key="item.to" :to="item.to" class="mobile-nav-item">
        <span class="mobile-nav-icon">{{ item.icon }}</span>
        <span class="mobile-nav-label">{{ item.label }}</span>
      </RouterLink>
    </nav>

    <!-- 登录/注册弹窗 -->
    <div v-if="showAuthModal" class="auth-mask" @click.self="showAuthModal = false">
      <div class="auth-modal">
        <h3>{{ authMode === 'login' ? '登录' : '注册新账号' }}</h3>
        <div class="auth-tabs">
          <button :class="{ active: authMode === 'login' }" @click="authMode = 'login'; authError = ''">登录</button>
          <button :class="{ active: authMode === 'register' }" @click="authMode = 'register'; authError = ''">注册</button>
        </div>
        <input v-model="authForm.username" placeholder="用户名（2-20位字母数字下划线）" autocomplete="username" />
        <input v-model="authForm.password" type="password" :placeholder="authMode === 'login' ? '密码' : '密码（至少6位）'" autocomplete="current-password" @keyup.enter="doAuth" />
        <div v-if="authError" class="auth-error">{{ authError }}</div>
        <button class="btn primary" @click="doAuth">{{ authMode === 'login' ? '登录' : '注册并登录' }}</button>
        <p v-if="!user.isLoggedIn" class="auth-hint">
          {{ authMode === 'login' ? '还没账号？点上方"注册"' : '注册后当前数据会自动迁移到账号下' }}
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh; display: flex; max-width: 1300px; margin: 0 auto;
  background: #ffffff; box-shadow: 0 4px 34px rgba(43, 58, 74, 0.08);
}
.app-sidebar {
  width: 216px; flex-shrink: 0; background: #ffffff; border-right: 1px solid var(--border);
  padding: 22px 14px; position: sticky; top: 0; height: 100vh; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 18px;
}
.brand { display: flex; align-items: center; gap: 8px; padding: 0 10px; }
.brand-logo { font-size: 26px; }
.brand-name { font-size: 18px; font-weight: 700; color: var(--text-main); }
.side-nav { display: flex; flex-direction: column; gap: 6px; flex: 1; }
.side-nav a {
  display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-radius: 10px;
  color: var(--text-sub); text-decoration: none; font-size: 15px; font-weight: 600; transition: all 0.2s;
}
.side-nav a:hover { background: var(--bg-soft); color: var(--primary); }
.side-nav a.router-link-exact-active { background: var(--primary); color: #ffffff; }

.user-area { border-top: 1px solid var(--border-light); padding-top: 14px; display: flex; flex-direction: column; gap: 8px; }
.user-info { display: flex; align-items: center; gap: 8px; padding: 0 4px; font-size: 14px; }
.user-name { font-weight: 600; color: var(--text-main); }
.admin-badge { background: #ff4d4f; color: #fff; font-size: 11px; padding: 1px 8px; border-radius: 999px; }
.anon-tip { font-size: 12px; color: var(--text-faint); padding: 0 4px; line-height: 1.5; }

.app-body { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.app-main { flex: 1; width: 100%; max-width: 900px; margin: 0 auto; padding: 28px 24px 40px; box-sizing: border-box; }
.mobile-nav { display: none; }

/* 登录弹窗 */
.auth-mask {
  position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 200;
  display: flex; align-items: center; justify-content: center; padding: 16px;
}
.auth-modal {
  background: #fff; border-radius: 16px; padding: 24px; width: 100%; max-width: 360px;
  display: flex; flex-direction: column; gap: 12px;
}
.auth-modal h3 { margin: 0; text-align: center; }
.auth-tabs { display: flex; gap: 8px; }
.auth-tabs button {
  flex: 1; padding: 8px; border: 1px solid var(--border-light); background: #fff;
  border-radius: 8px; cursor: pointer; font-weight: 600; color: var(--text-sub);
}
.auth-tabs button.active { background: var(--primary); color: #fff; border-color: var(--primary); }
.auth-modal input {
  padding: 10px 12px; border: 1px solid var(--border-light); border-radius: 8px; font-size: 15px;
}
.auth-error { color: var(--danger); font-size: 13px; }
.auth-hint { font-size: 12px; color: var(--text-faint); text-align: center; margin: 0; }

@media (max-width: 768px) {
  .app-shell { flex-direction: column; max-width: 100%; box-shadow: none; }
  .app-sidebar { display: none; }
  .app-main { max-width: 100%; padding: 16px 14px 90px; }
  .mobile-nav {
    display: flex; position: fixed; bottom: 0; left: 0; right: 0; background: #fff;
    border-top: 1px solid var(--border); padding: 6px 4px calc(6px + env(safe-area-inset-bottom));
    z-index: 99; justify-content: space-around;
  }
  .mobile-nav-item {
    display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 4px 6px;
    text-decoration: none; color: var(--text-faint); font-size: 11px; font-weight: 600; min-width: 48px;
  }
  .mobile-nav-item .mobile-nav-icon { font-size: 20px; line-height: 1; }
  .mobile-nav-item.router-link-exact-active { color: var(--primary); }
}
</style>
