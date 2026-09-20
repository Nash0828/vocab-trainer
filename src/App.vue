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
  background: var(--bg-page);
}
.app-sidebar {
  width: 220px; flex-shrink: 0; background: #ffffff; border-right: 1px solid var(--border);
  padding: 0; position: sticky; top: 0; height: 100vh; box-sizing: border-box;
  display: flex; flex-direction: column;
}
.brand { display: flex; align-items: center; gap: 8px; padding: 16px 18px; border-bottom: 1px solid var(--border-light); }
.brand-logo { font-size: 24px; }
.brand-name { font-size: 16px; font-weight: 600; color: var(--text-main); }
.side-nav { display: flex; flex-direction: column; flex: 1; padding: 8px 0; }
.side-nav a {
  display: flex; align-items: center; gap: 10px; padding: 12px 18px;
  color: var(--text-main); text-decoration: none; font-size: 15px; transition: all 0.15s;
  border-left: 3px solid transparent;
}
.side-nav a:hover { background: var(--bg-soft); }
.side-nav a.router-link-exact-active { background: var(--primary-light); color: var(--primary); border-left-color: var(--primary); }

.app-body { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.app-main { flex: 1; width: 100%; max-width: 720px; margin: 0 auto; padding: 12px 0 30px; box-sizing: border-box; }
.mobile-nav { display: none; }

@media (max-width: 768px) {
  .app-shell { flex-direction: column; max-width: 100%; }
  .app-sidebar { display: none; }
  .app-main { max-width: 100%; padding: 0 0 calc(60px + env(safe-area-inset-bottom)); }
  .mobile-nav {
    display: flex; position: fixed; bottom: 0; left: 0; right: 0; background: #fff;
    border-top: 0.5px solid var(--border); padding: 4px 0 calc(4px + env(safe-area-inset-bottom));
    z-index: 99; justify-content: space-around;
  }
  .mobile-nav-item {
    display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 2px 4px;
    text-decoration: none; color: #888; font-size: 10px; min-width: 48px;
  }
  .mobile-nav-item .mobile-nav-icon { font-size: 22px; line-height: 1.2; }
  .mobile-nav-item.router-link-exact-active { color: var(--primary); }
}
</style>
