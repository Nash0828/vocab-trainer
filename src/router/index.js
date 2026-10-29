import { createRouter, createWebHistory } from 'vue-router'
import InputView from '../views/InputView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  scrollBehavior(to, from, savedPosition) {
    // KeepAlive 缓存的页面（录入/背诵/词句库）不强制滚顶，由页面自身在 onActivated 恢复滚动位置（切回保留现场）
    if (['input', 'input-page', 'practice', 'library'].includes(to.name)) {
      if (savedPosition) return savedPosition
      return {}
    }
    return { top: 0 }
  },
  routes: [
    {
      path: '/',
      name: 'input',
      component: InputView,
      meta: { title: '录入' },
    },
    {
      path: '/input',
      name: 'input-page',
      component: InputView,
      meta: { title: '录入' },
    },
    {
      path: '/practice',
      name: 'practice',
      component: () => import('../views/PracticeView.vue'),
      meta: { title: '背诵' },
    },
    {
      path: '/wrongbook',
      name: 'wrongbook',
      component: () => import('../views/WrongBookView.vue'),
      meta: { title: '错题本' },
    },
    {
      path: '/library',
      name: 'library',
      component: () => import('../views/LibraryView.vue'),
      meta: { title: '词句库管理' },
    },
    {
      path: '/history',
      name: 'history',
      component: () => import('../views/HistoryView.vue'),
      meta: { title: '历史' },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../views/SettingsView.vue'),
      meta: { title: '设置' },
    },
    {
      path: '/admin',
      name: 'admin',
      component: () => import('../views/AdminView.vue'),
      meta: { title: '用户管理' },
    },
    {
      path: '/profile',
      name: 'profile',
      component: () => import('../views/ProfileView.vue'),
      meta: { title: '我的' },
    },
    {
      path: '/feedbacks',
      name: 'feedbacks',
      component: () => import('../views/FeedbackView.vue'),
      meta: { title: '用户反馈' },
    },
  ],
})

// 手机端访问首页时默认跳到背单词页
function isMobile() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth <= 768
}

router.beforeEach((to) => {
  if (to.path === '/' && isMobile()) {
    return '/practice'
  }
})

router.afterEach((to) => {
  const base = '词句助手'
  document.title = to.meta?.title ? `${to.meta.title} - ${base}` : base
})

// 分包懒加载失败自动恢复：部署/重启等瞬态窗口导致 JS 分包加载失败时，自动重载页面恢复
//（避免停留在灰色空白页；网络恢复后重载即正常）
let _retryingChunk = false
router.onError((err) => {
  const msg = (err && err.message) || ''
  const isChunkLoad =
    /Loading chunk|dynamically imported module|Importing a module script failed|Failed to fetch/.test(msg)
  if (isChunkLoad && !_retryingChunk) {
    _retryingChunk = true
    setTimeout(() => {
      window.location.reload()
    }, 300)
    return
  }
  console.error('[router]', err)
})

export default router
