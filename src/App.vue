<script setup>
import { onMounted, ref } from 'vue'
import { RouterLink, RouterView } from 'vue-router'
import { api } from './api/index.js'

const allNavItems = [
  { to: '/input', label: '录入', icon: '✍️' },
  { to: '/practice', label: '背单词', icon: '🎯' },
  { to: '/wrongbook', label: '错题本', icon: '📕' },
  { to: '/library', label: '词库', icon: '🗂️' },
  { to: '/history', label: '历史', icon: '📜' },
  { to: '/profile', label: '我的', icon: '👤' },
]

const navItems = allNavItems

onMounted(async () => {
  // 预加载用户信息（ProfileView 自己也会加载）
  try { await api.me() } catch (e) {}
})
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

.app-body { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.app-main { flex: 1; width: 100%; max-width: 900px; margin: 0 auto; padding: 28px 24px 40px; box-sizing: border-box; }
.mobile-nav { display: none; }

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
