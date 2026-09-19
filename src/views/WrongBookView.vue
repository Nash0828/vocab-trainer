<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useWords } from '../composables/useWords'
import { useWrongBook } from '../composables/useWrongBook'

const router = useRouter()
const { words } = useWords()
const { removeWrong, clearWrong, getValidWrongWords } = useWrongBook()

const confirmRemoveId = ref(null) // 待移除的错题记录
const confirmClearAll = ref(false)
const tip = ref(null) // { text, kind }
let tipTimer = null

const wrongList = computed(() => getValidWrongWords(words.value))

function showTip(text, kind = 'ok') {
  tip.value = { text, kind }
  clearTimeout(tipTimer)
  tipTimer = setTimeout(() => (tip.value = ''), 2600)
}

function askRemove(id) {
  confirmRemoveId.value = id
}

function cancelRemove() {
  confirmRemoveId.value = null
}

function doRemove(id) {
  removeWrong(id)
  confirmRemoveId.value = null
  showTip('🗑️ 已从错题本移除')
}

function askClearAll() {
  confirmClearAll.value = true
}

function cancelClearAll() {
  confirmClearAll.value = false
}

function doClearAll() {
  clearWrong()
  confirmClearAll.value = false
  showTip('🗑️ 已清空错题本')
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
      <h2>📕 错题本</h2>
      <p class="muted">答错的单词会自动记入这里，答对后自动移出；可单独移除或一键清空</p>
    </div>

    <transition name="fade">
      <p v-if="tip" class="tip" :class="tip.kind">{{ tip.text }}</p>
    </transition>

    <!-- 空状态 -->
    <div v-if="!wrongList.length" class="empty">
      <div class="empty-icon">📕</div>
      <h3>错题本是空的</h3>
      <p class="muted">去「背单词」练习，答错的单词会自动记入错题本</p>
      <div class="empty-actions">
        <button class="btn primary" @click="router.push('/practice')">去背单词</button>
        <button class="btn ghost" @click="router.push('/')">去录入单词</button>
      </div>
    </div>

    <template v-else>
      <!-- 汇总与操作 -->
      <div class="toolbar">
        <span class="count-badge">共 {{ wrongList.length }} 个错题</span>
        <div class="tool-actions">
          <template v-if="confirmClearAll">
            <span class="confirm-hint">确定清空全部错题吗？不可恢复。</span>
            <button class="btn danger mini" @click="doClearAll">是，全部清空</button>
            <button class="btn ghost mini" @click="cancelClearAll">取消</button>
          </template>
          <button v-else class="btn danger-ghost mini" @click="askClearAll">清空全部</button>
        </div>
      </div>

      <!-- 错题列表 -->
      <ul class="wrong-list">
        <li
          v-for="w in wrongList"
          :key="w.id || w.english"
          class="wrong-item"
        >
          <span class="w-en">{{ w.english }}</span>
          <span class="w-pos">{{ w.pos || '—' }}</span>
          <span class="w-zh">{{ w.chinese }}</span>
          <span class="w-time small muted">{{ formatTime(w.addedAt) }}</span>

          <div class="w-actions">
            <template v-if="confirmRemoveId === (w.id || w.english)">
              <span class="confirm-hint">移除？</span>
              <button class="btn danger mini" @click="doRemove(w.id || w.english)">是，移除</button>
              <button class="btn ghost mini" @click="cancelRemove">取消</button>
            </template>
            <button
              v-else
              class="btn danger-ghost mini"
              title="从错题本移除"
              @click="askRemove(w.id || w.english)"
            >
              🗑️ 移除
            </button>
          </div>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.tip {
  margin-top: 14px;
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 14px;
}

.tip.ok {
  background: #e8f7ee;
  border: 1px solid #a8dcc0;
  color: #1f7a4d;
}

.tip.warn {
  background: #fff7e6;
  border: 1px solid #ffd591;
  color: #ad6800;
}

.tip.err {
  background: #fdecea;
  border: 1px solid #f2b8b1;
  color: #b3402f;
  font-weight: 600;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 20px;
}

.count-badge {
  background: var(--primary-light);
  color: var(--primary);
  font-weight: 700;
  font-size: 14px;
  padding: 6px 14px;
  border-radius: 999px;
}

.tool-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.confirm-hint {
  font-size: 13px;
  color: var(--danger);
  font-weight: 600;
}

.wrong-list {
  list-style: none;
  margin: 14px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.wrong-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--bg-soft);
  border: 1px solid var(--border-light);
  flex-wrap: wrap;
}

.wrong-item:hover {
  border-color: #f2b8b1;
  background: #fdf8f7;
}

.w-en {
  font-weight: 700;
  color: var(--danger);
  font-size: 16px;
  min-width: 110px;
}

.w-pos {
  color: var(--text-sub);
  font-size: 13px;
  min-width: 42px;
}

.w-zh {
  flex: 1;
  color: var(--text-main);
  min-width: 80px;
}

.w-time {
  color: var(--text-faint);
}

.w-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.empty-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
  flex-wrap: wrap;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (max-width: 768px) {
  .wrong-item {
    gap: 8px;
    padding: 10px 12px;
  }

  .w-en {
    min-width: auto;
    font-size: 15px;
  }

  .w-pos {
    min-width: auto;
  }

  .w-time {
    width: 100%;
    font-size: 12px;
  }
}
</style>
