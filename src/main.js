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

  // iOS 页面冻结恢复：回到前台且数据为空时，自动重新加载（无需手动刷新）。
  // 多路兜底：visibilitychange / window focus / 挂载后立即及多档延迟检查 / 可见时定时检查，
  // 覆盖 iOS 冻结恢复时事件不触发、网络恢复慢或 bootstrap 重试全失败的数据为空场景。
  const { words } = useWords()
  let recovering = false
  async function recoverIfEmpty() {
    if (recovering || document.visibilityState !== 'visible') return
    if (words.value.length > 0) return // 数据还在，无需补
    recovering = true
    let ok = false
    for (let i = 0; i < 4; i++) {
      try {
        await loadAll()
        ok = true
        break
      } catch (err) {
        console.error(`回到前台补数据失败（第 ${i + 1} 次）`, err)
        if (i < 3) await new Promise((r) => setTimeout(r, 400 * (i + 1)))
      }
    }
    recovering = false
    if (ok) console.log('已自动补全数据')
  }
  document.addEventListener('visibilitychange', recoverIfEmpty)
  window.addEventListener('focus', recoverIfEmpty)
  // 挂载后立即补 + 多档延迟兜底：首包网络恢复通常 1~3 秒内完成，尽量让数据尽快出现
  recoverIfEmpty()
  setTimeout(recoverIfEmpty, 800)
  setTimeout(recoverIfEmpty, 2000)
  setTimeout(recoverIfEmpty, 5000)
  // 可见时周期性兜底：冻结恢复后定时器会自动续跑，最多 30 秒内补上
  setInterval(recoverIfEmpty, 30000)
}

bootstrap()
