<script setup>
import { ref, computed } from 'vue'
import { useHistory } from '../composables/useHistory'

const { getHistoryByDay, clearDay, clearAll } = useHistory()

const expanded = ref(null) // 展开的日期
const confirmClearDay = ref(null) // 待清空的天
const confirmClearAll = ref(false)
const tip = ref(null) // { text, kind }
let tipTimer = null

const days = computed(() => getHistoryByDay())

const totals = computed(() => {
  let correct = 0
  let wrong = 0
  const allCorrect = new Set()
  const allWrong = new Set()
  for (const d of days.value) {
    correct += d.correct
    wrong += d.wrong
    for (const r of d.records) {
      const key = r.english.trim().toLowerCase()
      if (!key) continue
      if (r.correct) allCorrect.add(key)
      else allWrong.add(key)
    }
  }
  return {
    days: days.value.length,
    correct,
    wrong,
    total: correct + wrong,
    correctWords: allCorrect.size,
    wrongWords: allWrong.size,
    totalWords: new Set([...allCorrect, ...allWrong]).size,
  }
})

function showTip(text, kind = 'ok') {
  tip.value = { text, kind }
  clearTimeout(tipTimer)
  tipTimer = setTimeout(() => (tip.value = ''), 2600)
}

function toggle(date) {
  expanded.value = expanded.value === date ? null : date
}

function askClearDay(date) {
  confirmClearDay.value = date
}

function cancelClearDay() {
  confirmClearDay.value = null
}

function doClearDay(date) {
  clearDay(date)
  confirmClearDay.value = null
  if (expanded.value === date) expanded.value = null
  showTip(`🗑️ 已清空 ${date} 的记录`)
}

function askClearAll() {
  confirmClearAll.value = true
}

function cancelClearAll() {
  confirmClearAll.value = false
}

function doClearAll() {
  clearAll()
  confirmClearAll.value = false
  expanded.value = null
  showTip('🗑️ 已清空全部历史记录')
}

function formatDate(dateStr) {
  return dateStr // 已是 YYYY-MM-DD
}
</script>

<template>
  <section class="card">
    <div class="card-head">
      <h2>📜 背诵历史</h2>
      <p class="muted">按天查看每天背诵过的单词与对错情况</p>
    </div>

    <transition name="fade">
      <p v-if="tip" class="tip" :class="tip.kind">{{ tip.text }}</p>
    </transition>

    <!-- 空状态 -->
    <div v-if="!days.length" class="empty">
      <div class="empty-icon">🗓️</div>
      <h3>暂无背诵记录</h3>
      <p class="muted">去「背单词」练习后，这里会按天记录你的背诵情况</p>
    </div>

    <template v-else>
      <!-- 汇总 -->
      <div class="summary-row">
        <div class="summary-item">
          <span class="sum-num">{{ totals.days }}</span>
          <span class="sum-label">背诵天数</span>
        </div>
        <div class="summary-item">
          <span class="sum-num">{{ totals.correct }}</span>
          <span class="sum-label">累计正确（{{ totals.correctWords }} 个单词）</span>
        </div>
        <div class="summary-item">
          <span class="sum-num wrong">{{ totals.wrong }}</span>
          <span class="sum-label">累计错误（{{ totals.wrongWords }} 个单词）</span>
        </div>
        <div class="summary-item">
          <span class="sum-num">{{ totals.total }}</span>
          <span class="sum-label">累计作答（已背 {{ totals.totalWords }} 词）</span>
        </div>
      </div>

      <!-- 全部清空（两步确认） -->
      <div class="clear-all-row">
        <template v-if="confirmClearAll">
          <span class="confirm-hint">确定清空全部历史记录吗？不可恢复。</span>
          <button class="btn danger mini" @click="doClearAll">是，全部清空</button>
          <button class="btn ghost mini" @click="cancelClearAll">取消</button>
        </template>
        <button v-else class="btn danger-ghost mini" @click="askClearAll">清空全部历史</button>
      </div>

      <!-- 按天列表 -->
      <div class="day-list">
        <div v-for="day in days" :key="day.date" class="day-item">
          <div class="day-head" @click="toggle(day.date)">
            <span class="day-date">📅 {{ formatDate(day.date) }}</span>
            <span class="day-badges">
              <span class="badge ok">✅ 正确 {{ day.correct }} 次 · {{ day.correctWords }} 词</span>
              <span class="badge bad">❌ 错误 {{ day.wrong }} 次 · {{ day.wrongWords }} 词</span>
              <span class="badge total">已背 {{ day.totalWords }} 词</span>
            </span>
            <span class="expand-icon">{{ expanded === day.date ? '▲' : '▼' }}</span>
          </div>

          <transition name="fade">
            <div v-if="expanded === day.date" class="day-detail">
              <div class="detail-tools">
                <span class="muted small">点击可查看当天每题的作答情况</span>
                <template v-if="confirmClearDay === day.date">
                  <span class="confirm-hint">确定清空当天记录？</span>
                  <button class="btn danger mini" @click="doClearDay(day.date)">是，清空</button>
                  <button class="btn ghost mini" @click="cancelClearDay">取消</button>
                </template>
                <button v-else class="btn danger-ghost mini" @click="askClearDay(day.date)">清空当天</button>
              </div>

              <ul class="record-list">
                <li
                  v-for="(r, i) in day.records"
                  :key="r.id"
                  class="record-item"
                  :class="r.correct ? 'rec-ok' : 'rec-bad'"
                >
                  <span class="rec-mark">{{ r.correct ? '✅' : '❌' }}</span>
                  <span class="rec-en">{{ r.english }}</span>
                  <span class="rec-pos">{{ r.pos || '—' }}</span>
                  <span class="rec-zh">{{ r.chinese }}</span>
                  <span class="rec-time small muted">{{ new Date(r.ts).toTimeString().slice(0, 5) }}</span>
                </li>
              </ul>
            </div>
          </transition>
        </div>
      </div>
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

.summary-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-top: 20px;
}

.summary-item {
  background: var(--bg-soft);
  border-radius: 12px;
  padding: 16px 10px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sum-num {
  font-size: 26px;
  font-weight: 800;
  color: var(--text-main);
}

.sum-num.wrong {
  color: var(--danger);
}

.sum-label {
  font-size: 13px;
  color: var(--text-sub);
}

.clear-all-row {
  margin-top: 20px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.day-list {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.day-item {
  background: var(--bg-soft);
  border-radius: 12px;
  border: 1px solid var(--border-light);
  overflow: hidden;
}

.day-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  cursor: pointer;
  flex-wrap: wrap;
}

.day-head:hover {
  background: #e9f0f8;
}

.day-date {
  font-weight: 700;
  color: var(--text-main);
}

.day-badges {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.badge {
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
}

.badge.ok {
  background: #e8f7ee;
  color: var(--success);
}

.badge.bad {
  background: #fdecea;
  color: var(--danger);
}

.badge.total {
  background: #eef3fb;
  color: var(--primary);
}

.expand-icon {
  margin-left: auto;
  color: var(--text-faint);
  font-size: 12px;
}

.day-detail {
  padding: 0 16px 14px;
}

.detail-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 0 10px;
  border-top: 1px dashed var(--border);
  flex-wrap: wrap;
}

.record-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.record-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 10px;
  font-size: 15px;
  flex-wrap: wrap;
}

.record-item.rec-ok {
  background: #eefaf3;
}

.record-item.rec-bad {
  background: #fdf1ef;
}

.rec-mark {
  font-size: 15px;
}

.rec-en {
  font-weight: 700;
  color: var(--primary);
  min-width: 90px;
}

.rec-pos {
  color: var(--text-sub);
  font-size: 13px;
  min-width: 40px;
}

.rec-zh {
  flex: 1;
  color: var(--text-main);
}

.rec-time {
  color: var(--text-faint);
}

.confirm-hint {
  font-size: 13px;
  color: var(--danger);
  font-weight: 600;
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
  .summary-row {
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }

  .summary-item {
    padding: 12px 6px;
  }

  .sum-num {
    font-size: 22px;
  }

  .sum-label {
    font-size: 12px;
  }

  .day-head {
    padding: 12px 12px;
    gap: 8px;
  }

  .day-badges .badge {
    font-size: 12px;
    padding: 2px 8px;
  }

  .record-item {
    gap: 8px;
    font-size: 14px;
  }

  .rec-en {
    min-width: 70px;
  }

  .rec-time {
    width: 100%;
  }
}
</style>
