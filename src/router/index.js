import { createRouter, createWebHistory } from 'vue-router'
import InputView from '../views/InputView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'input',
      component: InputView,
      meta: { title: '单词录入' },
    },
    {
      path: '/input',
      name: 'input-page',
      component: InputView,
      meta: { title: '单词录入' },
    },
    {
      path: '/practice',
      name: 'practice',
      component: () => import('../views/PracticeView.vue'),
      meta: { title: '背单词' },
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
      meta: { title: '词库管理' },
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
  const base = '背单词助手'
  document.title = to.meta?.title ? `${to.meta.title} - ${base}` : base
})

export default router
