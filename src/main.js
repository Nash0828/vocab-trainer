import './assets/main.css'

import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { api } from './api/index.js'
import { loadState, useWords } from './composables/useWords.js'
import { initRecords } from './composables/useHistory.js'
import { initWrongbook } from './composables/useWrongBook.js'

/** 全量加载：词库 / 背诵记录 / 错题本 */
async function loadAll() {
  const state = await api.getState()
  loadState(state)
  initRecords(state.records)
  initWrongbook(state.wrongbook)
}

// 启动时先从后端加载全量数据，再挂载 Vue；失败自动重试（iOS 首包网络不稳/后台冻结常见）
async function bootstrap() {
  let ok = false
  for (let i = 0; i < 3; i++) {
    try {
      await loadAll()
      ok = true
      break
    } catch (err) {
      console.error(`加载初始数据失败（第 ${i + 1} 次）`, err)
      if (i < 2) await new Promise((r) => setTimeout(r, 800 * (i + 1)))
    }
  }
  const app = createApp(App)

  // 移动端禁用 Vue DevTools 集成，减少不必要开销
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  if (isMobile) {
    app.config.devtools = false
  }

  app.use(router)
  app.mount('#app')

  // iOS 页面冻结恢复：从后台回到前台且数据为空时，自动重新加载（无需手动刷新）
  const { words } = useWords()
  let recovering = false
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || recovering) return
    if (words.value.length > 0) return // 数据还在，无需补
    recovering = true
    try {
      await loadAll()
      console.log('回到前台，已自动补全数据')
    } catch (err) {
      console.error('回到前台补数据失败', err)
    }
    recovering = false
  })
}

bootstrap()
