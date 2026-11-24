<script setup>
import { computed, ref } from 'vue'
import { useHistory } from '../composables/useHistory'

/** 答题历史底部弹层（微信风格），背诵页与词句库共用 */
const props = defineProps({
  show: { type: Boolean, default: false },
  chinese: { type: String, default: '' },
  english: { type: String, default: '' },
})
const emit = defineEmits(['close'])

const { history } = useHistory()

const list = computed(() => {
  const en = String(props.english || '').trim().toLowerCase()
  const cn = String(props.chinese || '').trim()
  return (history.value || [])
    .filter((r) => {
      const re = String(r.english || '').trim().toLowerCase()
      if (en) return re === en
      return String(r.chinese || '').trim() === cn
    })
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
})
const stats = computed(() => ({ total: list.value.length, correct: list.value.filter((r) => r.correct).length }))

function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  const now = new Date()
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) return `今天 ${hm}`
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (d.getFullYear() === y.getFullYear() && d.getMonth() === y.getMonth() && d.getDate() === y.getDate()) return `昨天 ${hm}`
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

// 遮罩上的手势处理：内部列表可正常滚动，滚到边界时阻止背景页面跟着滚（iOS 兼容）
const layerTouchY = ref(null)
function onTouchStart(e) {
  layerTouchY.value = e.touches && e.touches[0] ? e.touches[0].clientY : null
}
function onMaskTouchmove(e) {
  const t = e.touches && e.touches[0]
  if (!t) return
  const sel = window.getSelection && window.getSelection()
  if (sel && !sel.isCollapsed) return
  const y = t.clientY
  const delta = layerTouchY.value === null ? 0 : y - layerTouchY.value
  layerTouchY.value = y
  let scroller = null
  let node = e.target
  while (node && node !== document.body) {
    const cs = getComputedStyle(node)
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1) { scroller = node; break }
    node = node.parentElement
  }
  if (scroller) {
    const atTop = scroller.scrollTop <= 0
    const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1
    if ((delta > 0 && !atTop) || (delta < 0 && !atBottom)) return
  }
  e.preventDefault()
}
</script>

<template>
  <transition name="sheet">
    <div v-if="show" class="sheet-mask" @click.self="emit('close')" @touchstart="onTouchStart" @touchmove="onMaskTouchmove">
      <div class="sheet">
        <div class="sheet-title">
          <span>答题历史</span>
          <button class="sheet-close" type="button" aria-label="关闭答题历史" @mousedown.prevent @click="emit('close')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="history-summary">
          <div class="history-question">{{ chinese }}</div>
          <div class="history-count">共 {{ stats.total }} 次 · 答对 {{ stats.correct }} 次</div>
        </div>
        <div class="history-body">
          <div v-if="list.length" class="history-list">
            <div v-for="(r, i) in list" :key="r.id || i" class="history-item">
              <div class="history-top">
                <span class="history-time">{{ fmtTime(r.ts) }}</span>
                <span class="history-badge" :class="r.correct ? 'ok' : 'bad'">{{ r.correct ? '正确' : '错误' }}</span>
              </div>
              <div class="history-answer">{{ r.userAnswer || (r.correct ? '（显示答案）' : '（未记录作答）') }}</div>
              <div v-if="!r.correct && english" class="history-correct">正确：{{ english }}</div>
            </div>
          </div>
          <div v-else class="history-empty">
            <div class="history-empty-title">暂无答题记录</div>
            <div class="history-empty-sub">答完这一题后，记录会出现在这里</div>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.sheet-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 200;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  touch-action: none;
}
.sheet {
  width: 100%;
  max-width: 480px;
  background: #f7f7f7;
  border-radius: 12px 12px 0 0;
  padding-bottom: env(safe-area-inset-bottom);
  overscroll-behavior: contain;
  touch-action: pan-y;
}
.sheet-title {
  position: relative;
  text-align: center;
  padding: 14px 44px;
  font-size: 16px;
  font-weight: 500;
  background: #fff;
  border-bottom: 1px solid #e5e5e5;
}
.sheet-close {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: #f2f2f2;
  color: #999;
  display: flex;
  align-items: center;
  justify-content: center;
  -webkit-tap-highlight-color: transparent;
}
.sheet-close:active { background: #e5e5e5; }
.history-summary {
  background: #fff;
  padding: 12px 16px 10px;
  border-bottom: 1px solid #f2f2f2;
  text-align: left;
}
.history-question {
  font-size: 14px;
  font-weight: 500;
  color: #333;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.history-count {
  margin-top: 4px;
  font-size: 12px;
  color: #999;
}
.history-body {
  background: #fff;
  max-height: 56vh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}
.history-list { padding: 0 16px; }
.history-item {
  padding: 12px 0;
  border-bottom: 1px solid #f2f2f2;
  text-align: left;
}
.history-item:last-child { border-bottom: none; }
.history-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.history-time {
  font-size: 12px;
  color: #999;
}
.history-badge {
  font-size: 11px;
  line-height: 1.4;
  padding: 2px 7px;
  border-radius: 4px;
}
.history-badge.ok {
  color: var(--primary);
  background: rgba(7, 193, 96, 0.1);
}
.history-badge.bad {
  color: #fa5151;
  background: rgba(250, 81, 81, 0.1);
}
.history-answer {
  margin-top: 6px;
  font-size: 14px;
  color: #333;
  line-height: 1.5;
  word-break: break-word;
  white-space: pre-wrap;
}
.history-correct {
  margin-top: 4px;
  font-size: 12px;
  color: #999;
  line-height: 1.5;
  word-break: break-word;
}
.history-empty {
  padding: 48px 16px 56px;
  text-align: center;
}
.history-empty-title {
  font-size: 14px;
  color: #999;
}
.history-empty-sub {
  margin-top: 6px;
  font-size: 12px;
  color: #bfbfbf;
}
.sheet-enter-active, .sheet-leave-active { transition: opacity 0.22s ease; }
.sheet-enter-active .sheet, .sheet-leave-active .sheet { transition: transform 0.22s ease; }
.sheet-enter-from, .sheet-leave-to { opacity: 0; }
.sheet-enter-from .sheet, .sheet-leave-to .sheet { transform: translateY(100%); }
</style>
