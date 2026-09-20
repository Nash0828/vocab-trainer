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
  <section class="card">
    <div class="card-head">
      <h2>错题本</h2>
    </div>

    <transition name="fade">
      <p v-if="tip" class="tip" :class="tip.kind">{{ tip.text }}</p>
    </transition>

    <div v-if="!wrongList.length" class="empty">
      <div class="empty-icon">📕</div>
      <h3>错题本是空的</h3>
      <p class="muted">去背单词练习，答错的单词会自动记入这里</p>
      <div class="empty-actions">
        <button class="btn primary" @click="router.push('/practice')">去背单词</button>
        <button class="btn ghost" @click="router.push('/input')">去录入单词</button>
      </div>
    </div>

    <template v-else>
      <div class="toolbar">
        <span class="count-badge">共 {{ wrongList.length }} 个错题</span>
        <div class="tool-actions">
          <template v-if="confirmClearAll">
            <span class="confirm-hint">确定清空全部？</span>
            <button class="btn danger mini" @click="doClearAll">是</button>
            <button class="btn ghost mini" @click="cancelClearAll">取消</button>
          </template>
          <button v-else class="btn ghost mini" @click="askClearAll">清空全部</button>
        </div>
      </div>

      <ul class="wrong-list">
        <li v-for="w in wrongList" :key="w.id || w.english" class="wrong-item">
          <div class="w-main">
            <div class="w-line1">
              <span class="w-en">{{ w.english }}</span>
              <span class="w-pos">{{ w.pos || '' }}</span>
              <button
                v-if="confirmRemoveId !== (w.id || w.english)"
                class="w-remove"
                title="移除"
                @click="askRemove(w.id || w.english)"
              >✕</button>
            </div>
            <div class="w-zh">{{ w.chinese }}</div>
            <div v-if="lastWrongAnswer(w.english)" class="w-wrong">
              你答：{{ lastWrongAnswer(w.english) }}
            </div>
            <div class="w-time">{{ formatTime(w.addedAt) }}</div>
          </div>
          <div v-if="confirmRemoveId === (w.id || w.english)" class="w-confirm">
            <button class="btn danger mini" @click="doRemove(w.id || w.english)">移除</button>
            <button class="btn ghost mini" @click="cancelRemove">取消</button>
          </div>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.tip {
  margin: 0 14px 10px;
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
  padding: 10px 14px;
}

.count-badge {
  color: var(--text-sub);
  font-size: 14px;
}

.tool-actions { display: flex; align-items: center; gap: 8px; }
.confirm-hint { font-size: 13px; color: var(--danger); }

.wrong-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.wrong-item {
  background: #fff;
  border-bottom: 0.5px solid #e5e5e5;
  padding: 12px 14px;
}

.w-line1 {
  display: flex;
  align-items: center;
  gap: 8px;
}

.w-en {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-main);
}

.w-pos {
  font-size: 12px;
  color: var(--text-faint);
}

.w-remove {
  margin-left: auto;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: #c8c8c8;
  font-size: 16px;
  cursor: pointer;
  border-radius: 4px;
}
.w-remove:active { background: #f5f5f5; color: var(--danger); }

.w-zh {
  font-size: 14px;
  color: var(--text-sub);
  margin-top: 3px;
}

.w-wrong {
  font-size: 13px;
  color: var(--danger);
  margin-top: 3px;
}

.w-time {
  font-size: 12px;
  color: var(--text-faint);
  margin-top: 4px;
}

.w-confirm {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.empty {
  text-align: center;
  padding: 60px 20px;
}
.empty-icon { font-size: 56px; margin-bottom: 16px; }
.empty h3 { font-size: 18px; margin-bottom: 8px; }
.empty .muted { margin-bottom: 24px; }
.empty-actions { display: flex; justify-content: center; gap: 12px; flex-wrap: wrap; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.25s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

@media (min-width: 769px) {
  .card { padding: 0; }
  .card-head { padding: 16px; }
  .wrong-item { border-radius: 0; }
}
</style>
