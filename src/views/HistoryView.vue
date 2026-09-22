<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useHistory } from '../composables/useHistory'

const router = useRouter()
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
  showTip(`已清空 ${date} 的记录`)
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
  showTip('已清空全部历史记录')
}

function formatDate(dateStr) {
  return dateStr // 已是 YYYY-MM-DD
}
</script>

<template>
  <div class="history">
    <transition name="fade">
      <p v-if="tip" class="tip" :class="tip.kind">{{ tip.text }}</p>
    </transition>

    <!-- 空状态 -->
    <div v-if="!days.length" class="empty-state">
      <div class="empty-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#c8c8c8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      </div>
      <p class="empty-title">暂无背诵记录</p>
      <p class="empty-desc">去背单词练习后，这里会按天记录你的背诵情况</p>
      <button class="empty-btn" @click="router.push('/practice')">去背单词</button>
    </div>

    <template v-else>
      <!-- 汇总卡片 -->
      <div class="summary-card">
        <div class="sum-item">
          <span class="sum-num">{{ totals.days }}</span>
          <span class="sum-label">天数</span>
        </div>
        <div class="sum-divider"></div>
        <div class="sum-item">
          <span class="sum-num">{{ totals.correct }}</span>
          <span class="sum-label">正确</span>
        </div>
        <div class="sum-divider"></div>
        <div class="sum-item">
          <span class="sum-num wrong">{{ totals.wrong }}</span>
          <span class="sum-label">错误</span>
        </div>
        <div class="sum-divider"></div>
        <div class="sum-item">
          <span class="sum-num">{{ totals.totalWords }}</span>
          <span class="sum-label">已背单词</span>
        </div>
      </div>

      <!-- 清空按钮 -->
      <div class="clear-bar">
        <button v-if="!confirmClearAll" class="clear-btn" @click="askClearAll">清空全部历史</button>
        <span v-else class="clear-confirm">
          <button class="clear-yes" @click="doClearAll">确认清空</button>
          <button class="clear-no" @click="cancelClearAll">取消</button>
        </span>
      </div>

      <!-- 按天列表 -->
      <div class="day-list">
        <div v-for="day in days" :key="day.date" class="day-item" @click="toggle(day.date)">
          <div class="day-head">
            <div class="day-info">
              <span class="day-date">{{ formatDate(day.date) }}</span>
              <span class="day-stats">
                <span class="stat-ok">对 {{ day.correct }}</span>
                <span class="stat-bad">错 {{ day.wrong }}</span>
                <span class="stat-total">{{ day.totalWords }} 词</span>
              </span>
            </div>
            <span class="expand-icon">{{ expanded === day.date ? '⌄' : '›' }}</span>
          </div>

          <transition name="fade">
            <div v-if="expanded === day.date" class="day-detail" @click.stop>
              <div class="detail-head">
                <span class="muted small">当天作答明细</span>
                <button v-if="confirmClearDay !== day.date" class="mini-clear" @click="askClearDay(day.date)">清空</button>
                <span v-else class="mini-confirm">
                  <button class="mini-yes" @click="doClearDay(day.date)">是</button>
                  <button class="mini-no" @click="cancelClearDay">否</button>
                </span>
              </div>
              <div class="record-list">
                <div
                  v-for="(r, i) in day.records"
                  :key="r.id"
                  class="record-item"
                >
                  <span class="rec-mark" :class="r.correct ? 'mark-ok' : 'mark-bad'">{{ r.correct ? '✓' : '✗' }}</span>
                  <div class="rec-body">
                    <div class="rec-line1">
                      <span class="rec-en">{{ r.english }}</span>
                      <span v-if="r.pos" class="rec-pos">{{ r.pos }}</span>
                    </div>
                    <div class="rec-line2">
                      <span class="rec-zh">{{ r.chinese }}</span>
                      <span class="rec-time">{{ new Date(r.ts).toTimeString().slice(0, 5) }}</span>
                    </div>
                    <div v-if="!r.correct && r.userAnswer" class="rec-wrong">你答：{{ r.userAnswer }}</div>
                  </div>
                </div>
              </div>
            </div>
          </transition>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.history {
  padding: 8px 0 16px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 24px;
  text-align: center;
}
.empty-icon {
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

/* 汇总卡片 */
.summary-card {
  display: flex;
  align-items: center;
  background: #fff;
  margin: 0 16px 8px;
  border-radius: 12px;
  padding: 16px 0;
}

.sum-item {
  flex: 1;
  text-align: center;
}

.sum-num {
  display: block;
  font-size: 22px;
  font-weight: 600;
  color: var(--text-main);
}

.sum-num.wrong {
  color: var(--danger);
}

.sum-label {
  display: block;
  font-size: 12px;
  color: var(--text-sub);
  margin-top: 2px;
}

.sum-divider {
  width: 0.5px;
  height: 30px;
  background: #e5e5e5;
}

/* 清空按钮 */
.clear-bar {
  padding: 0 16px 10px;
  text-align: center;
}

.clear-btn {
  border: none;
  background: #fff;
  color: var(--danger);
  font-size: 14px;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
}

.clear-confirm {
  display: flex;
  gap: 8px;
  justify-content: center;
}

.clear-yes {
  border: none;
  background: var(--danger);
  color: #fff;
  font-size: 13px;
  padding: 7px 14px;
  border-radius: 6px;
  cursor: pointer;
}

.clear-no {
  border: none;
  background: #fff;
  color: var(--text-sub);
  font-size: 13px;
  padding: 7px 14px;
  border-radius: 6px;
  cursor: pointer;
}

/* 按天列表 */
.day-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 16px;
}

.day-item {
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
}

.day-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  cursor: pointer;
}

.day-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.day-date {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-main);
}

.day-stats {
  display: flex;
  gap: 8px;
  font-size: 12px;
}

.stat-ok { color: var(--primary); }
.stat-bad { color: var(--danger); }
.stat-total { color: var(--text-sub); }

.expand-icon {
  font-size: 18px;
  color: #c8c8c8;
}

.day-detail {
  border-top: 0.5px solid #f2f2f2;
  padding: 0 16px 12px;
}

.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
}

.mini-clear {
  border: none;
  background: transparent;
  color: var(--danger);
  font-size: 12px;
  cursor: pointer;
}

.mini-confirm {
  display: flex;
  gap: 6px;
}

.mini-yes {
  border: none;
  background: var(--danger);
  color: #fff;
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 4px;
  cursor: pointer;
}

.mini-no {
  border: none;
  background: #f2f2f2;
  color: var(--text-sub);
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 4px;
  cursor: pointer;
}

.record-list {
  display: flex;
  flex-direction: column;
}

.record-item {
  display: flex;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 0.5px solid #f5f5f5;
}

.record-item:last-child {
  border-bottom: none;
}

.rec-mark {
  font-size: 14px;
  font-weight: 700;
  width: 18px;
  flex-shrink: 0;
}
.rec-mark.mark-ok { color: #07c160; }
.rec-mark.mark-bad { color: #fa5151; }

.rec-body {
  flex: 1;
  min-width: 0;
}

.rec-line1 {
  display: flex;
  align-items: center;
  gap: 6px;
}

.rec-en {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-main);
}

.rec-pos {
  font-size: 11px;
  color: var(--text-sub);
  background: #f2f2f2;
  padding: 1px 6px;
  border-radius: 3px;
}

.rec-line2 {
  display: flex;
  justify-content: space-between;
  margin-top: 2px;
}

.rec-zh {
  font-size: 13px;
  color: var(--text-sub);
}

.rec-time {
  font-size: 11px;
  color: #b2b2b2;
}

.rec-wrong {
  font-size: 12px;
  color: var(--danger);
  margin-top: 2px;
}

.fade-enter-active, .fade-leave-active { transition: opacity 0.25s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
