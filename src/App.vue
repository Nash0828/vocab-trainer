<script setup>
import { onMounted, ref } from 'vue'
import { RouterLink, RouterView } from 'vue-router'
import { api } from './api/index.js'

const icons = {
  input: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  practice: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
  wrongbook: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  library: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
  history: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  profile: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
}

const allNavItems = [
  { to: '/input', label: '录入', icon: 'input' },
  { to: '/practice', label: '背单词', icon: 'practice' },
  { to: '/wrongbook', label: '错题本', icon: 'wrongbook' },
  { to: '/library', label: '词库', icon: 'library' },
  { to: '/history', label: '历史', icon: 'history' },
  { to: '/profile', label: '我的', icon: 'profile' },
]

const navItems = allNavItems

onMounted(async () => {
  try { await api.me() } catch (e) {}
})
</script>

<template>
  <div class="app-shell">
    <aside class="app-sidebar">
      <div class="brand">
        <span class="brand-logo">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
        </span>
        <span class="brand-name">背单词助手</span>
      </div>
      <nav class="side-nav">
        <RouterLink v-for="item in navItems" :key="item.to" :to="item.to">
          <span class="nav-icon" v-html="icons[item.icon]"></span>
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
        <span class="mobile-nav-icon" v-html="icons[item.icon]"></span>
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
.brand { display: flex; align-items: center; gap: 8px; padding: 16px 18px; border-bottom: 1px solid var(--border-light); color: var(--primary); }
.brand-logo { display: flex; }
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
  .mobile-nav-item .mobile-nav-icon { display: flex; }
  .mobile-nav-item.router-link-exact-active { color: var(--primary); }
}
</style>
