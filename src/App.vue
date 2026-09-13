<script setup>
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <div class="app-shell">
    <!-- 左侧边栏导航 -->
    <aside class="app-sidebar">
      <div class="brand">
        <span class="brand-logo">📚</span>
        <span class="brand-name">背单词助手</span>
      </div>
      <nav class="side-nav">
        <RouterLink to="/">✍️ 单词录入</RouterLink>
        <RouterLink to="/practice">🎯 背单词</RouterLink>
        <RouterLink to="/wrongbook">📕 错题本</RouterLink>
        <RouterLink to="/library">🗂️ 词库管理</RouterLink>
        <RouterLink to="/history">📜 历史</RouterLink>
        <RouterLink to="/settings">⚙️ 设置</RouterLink>
      </nav>
    </aside>

    <!-- 右侧主区域 -->
    <div class="app-body">
      <main class="app-main">
        <RouterView />
      </main>
      <footer class="app-footer">
        <p>数据保存在本浏览器中（localStorage），刷新页面不丢失</p>
      </footer>
    </div>
  </div>
</template>

<style scoped>
/* 整体居中容器：侧边栏紧挨主体内容，两侧留白 */
.app-shell {
  min-height: 100vh;
  display: flex;
  max-width: 1300px;
  margin: 0 auto;
  background: #ffffff;
  box-shadow: 0 4px 34px rgba(43, 58, 74, 0.08);
}

/* 左侧边栏 */
.app-sidebar {
  width: 216px;
  flex-shrink: 0;
  background: #ffffff;
  border-right: 1px solid var(--border);
  padding: 22px 14px;
  position: sticky;
  top: 0;
  height: 100vh;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
}

.brand-logo {
  font-size: 26px;
}

.brand-name {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-main);
}

.side-nav {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.side-nav a {
  display: block;
  padding: 12px 16px;
  border-radius: 10px;
  color: var(--text-sub);
  text-decoration: none;
  font-size: 15px;
  font-weight: 600;
  transition: all 0.2s ease;
}

.side-nav a:hover {
  background: var(--bg-soft);
  color: var(--primary);
}

.side-nav a.router-link-exact-active {
  background: var(--primary);
  color: #ffffff;
}

/* 右侧主区域 */
.app-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.app-main {
  flex: 1;
  width: 100%;
  max-width: 900px;
  margin: 0 auto;
  padding: 28px 24px 40px;
  box-sizing: border-box;
}

.app-footer {
  text-align: center;
  padding: 16px;
  color: var(--text-faint);
  font-size: 13px;
  background: #ffffff;
  border-top: 1px solid var(--border);
}

/* 窄屏：侧边栏改为顶部横排，容器全宽 */
@media (max-width: 720px) {
  .app-shell {
    flex-direction: column;
    max-width: 100%;
    box-shadow: none;
  }
  .app-sidebar {
    width: 100%;
    height: auto;
    position: static;
    border-right: none;
    border-bottom: 1px solid var(--border);
    padding: 12px 14px;
    gap: 10px;
  }
  .brand {
    padding: 0;
  }
  .side-nav {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 6px;
  }
  .side-nav a {
    padding: 8px 12px;
    font-size: 14px;
  }
}
</style>
