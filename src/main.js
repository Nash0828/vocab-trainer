import './assets/main.css'

import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { api } from './api/index.js'
import { loadState } from './composables/useWords.js'
import { initRecords } from './composables/useHistory.js'
import { initWrongbook } from './composables/useWrongBook.js'

// 启动时先从后端加载全量数据，再挂载 Vue
async function bootstrap() {
  try {
    const state = await api.getState()
    loadState(state)
    initRecords(state.records)
    initWrongbook(state.wrongbook)
  } catch (err) {
    console.error('加载初始数据失败', err)
  }
  const app = createApp(App)

  // 移动端禁用 Vue DevTools 集成，减少不必要开销
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  if (isMobile) {
    app.config.devtools = false
  }

  app.use(router)
  app.mount('#app')
}

bootstrap()
