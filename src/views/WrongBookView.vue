<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useWords } from '../composables/useWords'
import { useWrongBook } from '../composables/useWrongBook'
import { useHistory } from '../composables/useHistory'

const router = useRouter()
const { words } = useWords()
const { removeWrong, clearWrong, getValidWrongWords } = useWrongBook()
const { history } = useHistory()

function lastWrongAnswer(english) {
  if (!english) return ''
  const key = english.trim().toLowerCase()
  let latest = ''
  let latestTs = 0
  for (const r of history.value) {
    if (!r.correct && r.english && r.english.trim().toLowerCase() === key && r.userAnswer) {
      if (r.ts > latestTs) {
        latestTs = r.ts
        latest = r.userAnswer
      }
    }
  }
  return latest
}

const confirmRemoveId = ref(null)
const confirmClearAll = ref(false)
const tip = ref(null)
let tipTimer = null

const wrongList = computed(() => getValidWrongWords(words.value))

function showTip(text, kind = 'ok') {
  tip.value = { text, kind }
  clearTimeout(tipTimer)
  tipTimer = setTimeout(() => (tip.value = ''), 2600)
}

function askRemove(id) { confirmRemoveId.value = id }
function cancelRemove() { confirmRemoveId.value = null }
function doRemove(id) {
  removeWrong(id)
  confirmRemoveId.value = null
  showTip('已移除')
}
function askClearAll() { confirmClearAll.value = true }
function cancelClearAll() { confirmClearAll.value = false }
function doClearAll() {
  clearWrong()
  confirmClearAll.value = false
  showTip('已清空错题本')
}

function formatTime(ts) {
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
</script>

<template>
  <div class="wrongbook">
    <transition name="fade">
      <p v-if="tip" class="tip" :class="tip.kind">{{ tip.text }}</p>
    </transition>

    <div v-if="!wrongList.length" class="empty-state">
      <div class="empty-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#c8c8c8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      </div>
      <p class="empty-title">错题本是空的</p>
      <p class="empty-desc">去背单词练习，答错的单词会自动记入这里</p>
      <button class="empty-btn" @click="router.push('/practice')">去背单词</button>
    </div>

    <template v-else>
      <div class="toolbar">
        <span class="count-badge">共 {{ wrongList.length }} 个错题</span>
        <button v-if="!confirmClearAll" class="clear-btn" @click="askClearAll">清空</button>
        <span v-else class="clear-confirm">
          <button class="clear-yes" @click="doClearAll">确认清空</button>
          <button class="clear-no" @click="cancelClearAll">取消</button>
        </span>
      </div>

      <div class="wrong-list">
        <div v-for="w in wrongList" :key="w.id || w.english" class="wrong-item">
          <div class="w-main">
            <div class="w-line1">
              <span class="w-en">{{ w.english }}</span>
              <span v-if="w.pos" class="w-pos">{{ w.pos }}</span>
              <button
                v-if="confirmRemoveId !== (w.id || w.english)"
                class="w-remove"
                @click="askRemove(w.id || w.english)"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div class="w-zh">{{ w.chinese }}</div>
            <div v-if="lastWrongAnswer(w.english)" class="w-wrong">
              你答：{{ lastWrongAnswer(w.english) }}
            </div>
          </div>
          <div v-if="confirmRemoveId === (w.id || w.english)" class="w-confirm">
            <button class="w-confirm-yes" @click="doRemove(w.id || w.english)">移除</button>
            <button class="w-confirm-no" @click="cancelRemove">取消</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.wrongbook {
  padding: 8px 0;
}

.tip {
  margin: 0 16px 10px;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 14px;
}
.tip.ok { background: #e8f8ef; color: #07c160; }
.tip.warn { background: #fff7e6; color: #fa9d3b; }
.tip.err { background: #fdecec; color: #fa5151; }

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px 10px;
}

.count-badge {
  font-size: 14px;
  color: var(--text-sub);
}

.clear-btn {
  border: none;
  background: #fff;
  color: var(--danger);
  font-size: 14px;
  padding: 6px 14px;
  border-radius: 6px;
  cursor: pointer;
}

.clear-confirm {
  display: flex;
  gap: 8px;
}

.clear-yes {
  border: none;
  background: var(--danger);
  color: #fff;
  font-size: 13px;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
}

.clear-no {
  border: none;
  background: #fff;
  color: var(--text-sub);
  font-size: 13px;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
}

.wrong-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 16px;
}

.wrong-item {
  background: #fff;
  padding: 12px 16px;
  position: relative;
}

.w-line1 {
  display: flex;
  align-items: center;
  gap: 8px;
}

.w-en {
  font-size: 17px;
  font-weight: 600;
  color: var(--text-main);
}

.w-pos {
  font-size: 12px;
  color: var(--text-sub);
  background: #f2f2f2;
  padding: 1px 8px;
  border-radius: 4px;
}

.w-remove {
  margin-left: auto;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: #c8c8c8;
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.w-remove:active { color: var(--danger); }

.w-zh {
  font-size: 14px;
  color: var(--text-sub);
  margin-top: 4px;
}

.w-wrong {
  font-size: 13px;
  color: var(--danger);
  margin-top: 4px;
}

.w-confirm {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 0.5px solid #f2f2f2;
}

.w-confirm-yes {
  border: none;
  background: var(--danger);
  color: #fff;
  font-size: 13px;
  padding: 6px 14px;
  border-radius: 6px;
  cursor: pointer;
}

.w-confirm-no {
  border: none;
  background: #f2f2f2;
  color: var(--text-main);
  font-size: 13px;
  padding: 6px 14px;
  border-radius: 6px;
  cursor: pointer;
}

.empty-state {
  background: #fff;
  margin: 8px 16px;
  border-radius: 12px;
  padding: 48px 20px;
  text-align: center;
}
.empty-icon {
  display: flex;
  justify-content: center;
  margin-bottom: 16px;
}
.empty-title {
  font-size: 16px;
  color: var(--text-main);
  margin: 0 0 8px 0;
  font-weight: 500;
}
.empty-desc {
  font-size: 14px;
  color: var(--text-sub);
  margin: 0 0 24px 0;
}
.empty-btn {
  background: var(--primary);
  color: #fff;
  border: none;
  padding: 10px 32px;
  border-radius: 8px;
  font-size: 15px;
  cursor: pointer;
}

.fade-enter-active, .fade-leave-active { transition: opacity 0.25s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
