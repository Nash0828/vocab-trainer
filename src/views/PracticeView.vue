<script setup>
import { ref, computed, nextTick, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useWords, weightedPickIndex } from '../composables/useWords'
import { useHistory } from '../composables/useHistory'
import { useWrongBook } from '../composables/useWrongBook'

const router = useRouter()
const { words, settings, incrementCount, isMastered } = useWords()
const { getTodayStats, getTodayRecords, getTodayUniqueStats, addRecord } = useHistory()
const { addWrong, removeWrong, getValidWrongWords } = useWrongBook()

// 出题来源：'all' = 全部未背熟词库；'wrong' = 仅错题本
const sourceMode = ref('all')

const current = ref(null)
const answer = ref('')
const result = ref(null) // null | 'correct' | 'wrong'
const revealed = ref(false) // 是否通过"显示答案"按钮作答
const isRedo = ref(false) // 是否处于重做模式（重做答对不算答对、不移除错题本）
const lastIndex = ref(-1)
const answerInput = ref(null)
let autoTimer = null // 作答后自动切换下一题的定时器

// 今日统计与记录弹窗
const todayStats = ref(getTodayStats())
const todayUnique = ref(getTodayUniqueStats()) // 今日去重单词统计（重复单词只算一次）
const todayRecords = ref([])
const showRecordsModal = ref(false)
const modalTab = ref('correct') // 'correct' | 'wrong'
const todayTick = ref(0) // 用于跨零点时刷新今日统计
let todayInterval = null

const threshold = computed(() => settings.value.masteryThreshold)
const hasWords = computed(() => words.value.length > 0)
// 错题本中仍有效的单词（自动清理词库中已删除的）
const wrongValid = computed(() => getValidWrongWords(words.value))
// 将错题本快照解析为词库中的单词对象
function resolveWord(item) {
  if (!item) return null
  if (item.id) {
    const byId = words.value.find((x) => String(x.id) === String(item.id))
    if (byId) return byId
  }
  return (
    words.value.find((x) => x.english.trim().toLowerCase() === item.english.trim().toLowerCase()) || null
  )
}
// 出题池：全部模式 = 未背熟单词；错题本模式 = 错题本中且未背熟的单词（保持"已背熟不出题"规则）
const available = computed(() => {
  if (sourceMode.value === 'wrong') {
    return wrongValid.value
      .map((item) => resolveWord(item))
      .filter((w) => w && !isMastered(w))
  }
  return words.value.filter((w) => !isMastered(w))
})
const allMastered = computed(() => hasWords.value && available.value.length === 0)
// 错题本模式空状态：'empty'=错题本为空；'all-mastered'=错题本单词已全部背熟；null=正常
const wrongState = computed(() => {
  if (sourceMode.value !== 'wrong') return null
  if (!wrongValid.value.length) return 'empty'
  if (!available.value.length) return 'all-mastered'
  return null
})
const totalMastered = computed(() => words.value.filter((w) => isMastered(w)).length)
// 今日正确率（与"今日背诵"统计条同口径）
const accuracy = computed(() =>
  todayStats.value.total ? Math.round((todayStats.value.correct / todayStats.value.total) * 100) : 0
)
// 今日新背熟：今天答对过、且当前已背熟的去重单词数
const todayNewMastered = computed(() => {
  const seen = new Set()
  let count = 0
  for (const r of getTodayRecords()) {
    if (!r.correct) continue
    const key = r.english.trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const w = words.value.find((x) => x.english.trim().toLowerCase() === key)
    if (w && isMastered(w)) count++
  }
  return count
})

function refreshToday() {
  todayStats.value = getTodayStats()
  todayUnique.value = getTodayUniqueStats()
  todayRecords.value = getTodayRecords()
}

function pickIndex() {
  // 加权随机：熟练程度低的单词（背诵次数少）优先出现，且不立即重复上一题
  return weightedPickIndex(
    available.value.map((w) => w.count || 0),
    threshold.value,
    lastIndex.value
  )
}

function clearAutoTimer() {
  if (autoTimer) {
    clearTimeout(autoTimer)
    autoTimer = null
  }
}

function focusInput() {
  // 多次尝试 focus，兼容手机端浏览器时序
  const tryFocus = (retries = 3) => {
    nextTick(() => {
      const el = answerInput.value
      if (!el) return
      el.focus()
      // 手机上可能需要第二次 focus 才弹出键盘
      if (retries > 0) {
        setTimeout(() => {
          el.focus()
          tryFocus(retries - 1)
        }, 80)
      }
    })
  }
  tryFocus()
}

function next() {
  clearAutoTimer()
  if (!available.value.length) {
    current.value = null
    return
  }
  const idx = pickIndex()
  lastIndex.value = idx
  current.value = available.value[idx]
  answer.value = ''
  result.value = null
  revealed.value = false
  isRedo.value = false
  focusInput()
}

function submit() {
  if (!current.value || result.value || !answer.value.trim()) return
  // 大小写敏感：严格匹配（去除首尾空格）
  const isCorrect = answer.value.trim() === current.value.english.trim()

  if (isRedo.value) {
    // 重做模式：无论对错都不算正式作答，只显示反馈，不更新 count、不移除/加入错题本
    result.value = isCorrect ? 'correct' : 'wrong'
    speak(current.value.english)
    // 重做答对后停在当前题，等用户点"下一题"；答错也停在当前题
    clearAutoTimer()
    return
  }

  if (isCorrect) {
    incrementCount(current.value.id)
    removeWrong(current.value)
  } else {
    addWrong(current.value)
  }
  result.value = isCorrect ? 'correct' : 'wrong'
  revealed.value = false
  speak(current.value.english)

  addRecord({
    chinese: current.value.chinese,
    english: current.value.english,
    pos: current.value.pos || '',
    correct: isCorrect,
    userAnswer: answer.value,
  })
  refreshToday()

  clearAutoTimer()
  if (isCorrect) {
    autoTimer = setTimeout(next, 1000)
  }
}

function skip() {
  clearAutoTimer()
  next()
}

// 播放单词发音（有道词典：type=0 美音 / type=1 英音）
function speak(word, type = 0) {
  if (!word) return
  try {
    const url = `https://dict.youdao.com/dictvoice?type=${type}&audio=${encodeURIComponent(String(word).trim())}`
    const audio = new Audio(url)
    audio.play().catch(() => {})
  } catch (e) {}
}

// ===== 词典查询弹窗（有道词典接口） =====
const dictModal = ref(null) // { word, data, loading, error }
async function lookupWord(word) {
  if (!word) return
  dictModal.value = { word, data: null, loading: true, error: null }
  try {
    const res = await fetch(`/api/dict?word=${encodeURIComponent(word.trim().toLowerCase())}`)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      throw new Error(j.error || '查询失败')
    }
    dictModal.value.data = await res.json()
  } catch (e) {
    dictModal.value.error = e.message || '查询失败，请稍后重试'
  } finally {
    dictModal.value.loading = false
  }
}
function closeDict() {
  dictModal.value = null
}

// 弹窗打开时禁止背景滚动
watch(dictModal, (val) => {
  document.body.style.overflow = val ? 'hidden' : ''
})

// 答错后重做当前题：清空答案与判定，重新聚焦输入框
function redo() {
  if (!current.value) return
  clearAutoTimer()
  answer.value = ''
  result.value = null
  revealed.value = false
  isRedo.value = true
  focusInput()
}

// 显示正确答案：该题按答错处理（计入错题本与当日错误记录、不累计背诵次数）
function revealAnswer() {
  if (!current.value || result.value) return
  result.value = 'wrong'
  revealed.value = true
  addWrong(current.value)
  addRecord({
    chinese: current.value.chinese,
    english: current.value.english,
    pos: current.value.pos || '',
    correct: false,
    userAnswer: '',
  })
  refreshToday()
  speak(current.value.english)
}

// 切换出题来源
function setSource(mode) {
  if (mode === sourceMode.value) return
  sourceMode.value = mode
  lastIndex.value = -1
  clearAutoTimer()
  next()
}

// 打开今日记录弹窗（正确/错误）
function openRecords(tab) {
  refreshToday()
  modalTab.value = tab
  showRecordsModal.value = true
}

function closeRecords() {
  showRecordsModal.value = false
}

const modalRecords = computed(() => {
  const recs = todayRecords.value
  return modalTab.value === 'correct'
    ? recs.filter((r) => r.correct)
    : recs.filter((r) => !r.correct)
})

// 答错后按回车键直接进入下一题（焦点在输入框/页面空白处时生效；聚焦按钮时不拦截，避免与按钮回车激活冲突）
function onGlobalKeydown(e) {
  if (e.key !== 'Enter') return
  if (result.value !== 'wrong') return
  const tag = e.target && e.target.tagName
  if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'TEXTAREA') return
  e.preventDefault()
  next()
}

// 跨零点自动刷新"今日"统计（本地日期维度）
todayInterval = setInterval(() => {
  refreshToday()
  todayTick.value += 1
}, 30000)

onMounted(() => {
  document.addEventListener('keydown', onGlobalKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onGlobalKeydown)
  clearAutoTimer()
  if (todayInterval) clearInterval(todayInterval)
})

// 首次进入时准备第一题并刷新今日统计
refreshToday()
next()
</script>

<template>
  <div class="practice">
    <!-- 空词库 -->
    <div v-if="!hasWords" class="empty-state">
      <div class="empty-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#c8c8c8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
      </div>
      <p class="empty-title">词库还是空的</p>
      <p class="empty-desc">先去录入一些单词，再来这里练习吧</p>
      <button class="empty-btn" @click="router.push('/input')">去录入单词</button>
    </div>

    <!-- 错题本模式：错题本为空 -->
    <div v-else-if="wrongState === 'empty'" class="empty-state">
      <div class="empty-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#c8c8c8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      </div>
      <p class="empty-title">错题本还是空的</p>
      <p class="empty-desc">在背单词中答错的单词会自动记入错题本</p>
      <button class="empty-btn" @click="setSource('all')">切换到全部词库</button>
    </div>

    <!-- 错题本模式：错题本单词已全部背熟 -->
    <div v-else-if="wrongState === 'all-mastered'" class="empty-state">
      <div class="empty-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#c8c8c8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      </div>
      <p class="empty-title">错题本都背熟了</p>
      <p class="empty-desc">错题本里的单词都已达到背熟阈值</p>
      <button class="empty-btn" @click="setSource('all')">切换到全部词库</button>
    </div>

    <!-- 全部背熟 -->
    <div v-else-if="allMastered" class="empty-state">
      <div class="empty-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#c8c8c8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>
      </div>
      <p class="empty-title">全部背熟了</p>
      <p class="empty-desc">词库中所有单词都已达到背熟阈值</p>
      <button class="empty-btn" @click="router.push('/settings')">去设置调整</button>
    </div>

    <!-- 有可练习单词 -->
    <template v-else>
      <!-- 出题来源切换 -->
      <div class="source-tabs">
        <button
          class="source-tab"
          :class="{ active: sourceMode === 'all' }"
          @click="setSource('all')"
        >
          全部未背熟
        </button>
        <button
          class="source-tab"
          :class="{ active: sourceMode === 'wrong' }"
          @click="setSource('wrong')"
        >
          仅错题本
        </button>
      </div>

      <!-- 今日统计 -->
      <div class="today-card">
        <div class="today-stats">
          <button class="stat-item" @click="openRecords('correct')">
            <span class="stat-num ok">{{ todayStats.correct }}</span>
            <span class="stat-label">正确</span>
          </button>
          <button class="stat-item" @click="openRecords('wrong')">
            <span class="stat-num bad">{{ todayStats.wrong }}</span>
            <span class="stat-label">错误</span>
          </button>
          <div class="stat-item">
            <span class="stat-num">{{ todayUnique.totalWords }}</span>
            <span class="stat-label">已背单词</span>
          </div>
          <div class="stat-item">
            <span class="stat-num">{{ accuracy }}%</span>
            <span class="stat-label">正确率</span>
          </div>
        </div>
      </div>

      <!-- 答题区 -->
      <div class="quiz-card">
        <p class="quiz-label">中文释义</p>
        <p class="quiz-word">{{ current.chinese }}</p>
        <p v-if="current.pos" class="quiz-pos">{{ current.pos }}</p>

        <div class="quiz-sound">
          <button class="sound-btn" @click="speak(current.english)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
            发音
          </button>
          <button class="sound-btn" @click="lookupWord(current.english)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
            查词
          </button>
        </div>

        <div class="quiz-progress">
          <span class="progress-text">{{ current.count || 0 }}/{{ threshold }}</span>
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: Math.min(100, Math.round(((current.count || 0) / threshold) * 100)) + '%' }"></div>
          </div>
        </div>

        <div class="quiz-input">
          <input
            ref="answerInput"
            v-model="answer"
            type="text"
            lang="en"
            inputmode="text"
            enterkeyhint="go"
            autocorrect="off"
            placeholder="输入英文单词"
            :disabled="!!result"
            @keyup.enter="submit"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
          />
        </div>

        <!-- 判定反馈 -->
        <div v-if="result" class="feedback" :class="result">
          <template v-if="result === 'correct'">
            <span class="fb-text">回答正确</span>
            <span v-if="current.count >= threshold" class="fb-mastered">已背熟</span>
          </template>
          <template v-else>
            <span class="fb-text">{{ revealed ? '已显示答案' : '回答错误' }}</span>
            <strong class="correct-word">{{ current.english }}</strong>
          </template>
          <button class="speak-btn" @click="speak(current.english)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
            重听
          </button>
        </div>

        <div class="quiz-actions">
          <button v-if="!result" class="btn ghost" @click="skip">换一题</button>
          <button v-if="!result" class="btn ghost" @click="revealAnswer">显示答案</button>
          <button v-if="!result" class="btn primary" :disabled="!answer.trim()" @click="submit">提交</button>
          <button v-else-if="result === 'correct'" class="btn ghost" @click="skip">下一题</button>
          <template v-else>
            <button class="btn primary" @click="redo">重做这一题</button>
            <button class="btn ghost" @click="skip">下一题</button>
          </template>
        </div>
      </div>
    </template>
  </div>

    <!-- 今日记录弹窗 -->
    <div v-if="showRecordsModal" class="modal-mask" @click.self="closeRecords">
      <div class="modal">
        <div class="modal-head">
          <h3>今日背诵记录</h3>
          <button class="modal-close" @click="closeRecords">✕</button>
        </div>
        <div class="modal-tabs">
          <button class="tab-btn" :class="{ active: modalTab === 'correct' }" @click="modalTab = 'correct'">
            正确 ({{ todayStats.correct }})
          </button>
          <button class="tab-btn" :class="{ active: modalTab === 'wrong' }" @click="modalTab = 'wrong'">
            错误 ({{ todayStats.wrong }})
          </button>
        </div>
        <div class="modal-body">
          <p v-if="!modalRecords.length" class="empty-tip">
            今天还没有{{ modalTab === 'correct' ? '答对' : '答错' }}的单词记录
          </p>
          <ul v-else class="modal-list">
            <li v-for="(r, i) in modalRecords" :key="r.id" class="modal-item">
              <div class="m-main">
                <span class="m-en">{{ r.english }}</span>
                <span class="m-pos">{{ r.pos || '—' }}</span>
              </div>
              <div class="m-sub">
                <span class="m-zh">{{ r.chinese }}</span>
                <span v-if="!r.correct && r.userAnswer" class="m-wrong-answer">
                  你答：{{ r.userAnswer }}
                </span>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- 词典查询弹窗 -->
    <div v-if="dictModal" class="dict-mask" @click.self="closeDict">
      <div class="dict-modal">
        <div class="dict-head">
          <h3>{{ dictModal.word }}</h3>
          <button class="dict-close" @click="closeDict">✕</button>
        </div>
        <div class="dict-body">
          <div v-if="dictModal.loading" class="dict-loading">查询中…</div>
          <div v-else-if="dictModal.error" class="dict-error">{{ dictModal.error }}</div>
          <div v-else-if="dictModal.data">
            <div v-if="dictModal.data.usphone || dictModal.data.ukphone" class="dict-phonetic">
              <span v-if="dictModal.data.ukphone" class="phonetic-item">
                英 [{{ dictModal.data.ukphone }}]
                <button class="speak-mini" @click="speak(dictModal.word, 1)" title="英式发音">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                </button>
              </span>
              <span v-if="dictModal.data.usphone" class="phonetic-item" style="margin-left:12px">
                美 [{{ dictModal.data.usphone }}]
                <button class="speak-mini" @click="speak(dictModal.word, 0)" title="美式发音">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                </button>
              </span>
            </div>
            <div v-if="dictModal.data.examType && dictModal.data.examType.length" class="dict-exam">
              考试类型：{{ dictModal.data.examType.join(' / ') }}
            </div>
            <div v-if="dictModal.data.trs && dictModal.data.trs.length" class="dict-meaning">
              <p class="dict-label">释义</p>
              <ul>
                <li v-for="(tr, i) in dictModal.data.trs" :key="i">{{ tr }}</li>
              </ul>
            </div>
            <div v-if="dictModal.data.wfs && dictModal.data.wfs.length" class="dict-meaning">
              <p class="dict-label">词形变化</p>
              <ul>
                <li v-for="(wf, i) in dictModal.data.wfs" :key="i">{{ wf }}</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
</template>

<style scoped>
.practice {
  padding: 8px 0 16px;
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

/* 出题来源切换 */
.source-tabs {
  display: flex;
  background: #fff;
  margin: 0 16px 8px;
  border-radius: 10px;
  padding: 3px;
  gap: 3px;
}

.source-tab {
  flex: 1;
  border: none;
  background: transparent;
  padding: 8px 0;
  font-size: 14px;
  color: var(--text-sub);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.source-tab.active {
  background: var(--primary);
  color: #fff;
  font-weight: 500;
}

/* 今日统计卡片 */
.today-card {
  background: #fff;
  margin: 0 16px 8px;
  border-radius: 12px;
  padding: 16px 0;
}

.today-stats {
  display: flex;
  align-items: center;
}

.stat-item {
  flex: 1;
  text-align: center;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 0;
}

.stat-num {
  display: block;
  font-size: 22px;
  font-weight: 600;
  color: var(--text-main);
}

.stat-num.ok { color: var(--primary); }
.stat-num.bad { color: var(--danger); }

.stat-label {
  display: block;
  font-size: 12px;
  color: var(--text-sub);
  margin-top: 2px;
}

/* 答题卡片 */
.quiz-card {
  background: #fff;
  margin: 0 16px;
  border-radius: 12px;
  padding: 28px 20px;
  text-align: center;
}

.quiz-label {
  font-size: 13px;
  color: var(--text-sub);
  margin-bottom: 8px;
}

.quiz-word {
  font-size: 32px;
  font-weight: 700;
  color: var(--text-main);
  margin: 0 0 4px;
  word-break: break-all;
}

.quiz-pos {
  font-size: 14px;
  color: var(--text-sub);
  margin-bottom: 16px;
}

.quiz-sound {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin-bottom: 16px;
}

.sound-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: none;
  background: #f5f5f5;
  color: var(--text-sub);
  font-size: 13px;
  padding: 7px 14px;
  border-radius: 6px;
  cursor: pointer;
}

.sound-btn:active { background: #e8e8e8; }

.quiz-progress {
  max-width: 300px;
  margin: 0 auto 16px;
}

.progress-text {
  display: block;
  font-size: 12px;
  color: var(--text-sub);
  margin-bottom: 4px;
}

.progress-bar {
  height: 4px;
  border-radius: 999px;
  background: #f0f0f0;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--primary);
  transition: width 0.3s ease;
}

.quiz-input input {
  width: 100%;
  padding: 12px 16px;
  font-size: 18px;
  text-align: center;
  border: 1px solid #e5e5e5;
  border-radius: 8px;
  outline: none;
  box-sizing: border-box;
}

.quiz-input input:focus {
  border-color: var(--primary);
}

.quiz-input input:disabled {
  background: #f5f5f5;
  color: var(--text-sub);
}

.feedback {
  margin: 16px 0 0;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
}

.feedback.correct {
  background: #e8f8ef;
  color: #07c160;
}

.feedback.wrong {
  background: #fdecec;
  color: #fa5151;
}

.fb-mastered {
  font-size: 12px;
  background: rgba(7,193,96,0.15);
  padding: 2px 8px;
  border-radius: 4px;
}

.correct-word {
  font-size: 18px;
  color: var(--danger);
}

.speak-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: rgba(0,0,0,0.05);
  color: inherit;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
}

.quiz-actions {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin-top: 18px;
}

.quiz-actions .btn {
  flex: 1;
  max-width: 140px;
}

/* ===== 记录弹窗 ===== */
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 100;
}

.modal {
  background: #fff;
  border-radius: 16px 16px 0 0;
  width: 100%;
  max-width: 100%;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-head {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  position: relative;
  border-bottom: 0.5px solid #f0f0f0;
}

.modal-head h3 {
  font-size: 18px;
  margin: 0;
  color: var(--text-main);
  font-weight: 600;
}

.modal-close {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  border: none;
  background: #f0f0f0;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  font-size: 14px;
  cursor: pointer;
  color: #888;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-tabs {
  display: flex;
  padding: 12px 16px 0;
  gap: 8px;
}

.tab-btn {
  flex: 1;
  padding: 8px;
  border: none;
  background: #f5f5f5;
  border-radius: 8px;
  font-size: 14px;
  color: var(--text-sub);
  cursor: pointer;
}

.tab-btn.active {
  background: var(--primary);
  color: #fff;
}

.modal-body {
  padding: 12px 16px 16px;
  overflow-y: auto;
}

.empty-tip {
  text-align: center;
  padding: 40px 0;
  color: var(--text-sub);
  font-size: 15px;
}

.modal-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.modal-item {
  padding: 12px 0;
  border-bottom: 0.5px solid #f0f0f0;
}

.modal-item:last-child { border-bottom: none; }

.m-main {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.m-en { font-size: 16px; font-weight: 600; color: var(--text-main); }
.m-pos { font-size: 12px; color: var(--text-sub); background: #f5f5f5; padding: 2px 8px; border-radius: 4px; }
.m-sub { display: flex; flex-direction: column; gap: 2px; }
.m-zh { color: var(--text-sub); font-size: 14px; }
.m-wrong-answer { color: var(--danger); font-size: 13px; }

/* ===== 词典查询弹窗 ===== */
.dict-mask {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 100;
}

.dict-modal {
  background: #fff;
  border-radius: 16px 16px 0 0;
  width: 100%;
  max-width: 100%;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dict-head {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  position: relative;
  border-bottom: 0.5px solid #f0f0f0;
}

.dict-head h3 {
  font-size: 18px;
  margin: 0;
  color: var(--text-main);
  font-weight: 600;
}

.dict-close {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  border: none;
  background: #f0f0f0;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  font-size: 14px;
  cursor: pointer;
  color: #888;
  display: flex;
  align-items: center;
  justify-content: center;
}

.dict-body {
  padding: 16px;
  overflow-y: auto;
}

.dict-loading, .dict-error {
  text-align: center;
  padding: 40px 0;
  color: var(--text-sub);
  font-size: 15px;
}

.dict-error {
  color: var(--danger);
}

.dict-phonetic {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
  font-size: 15px;
  color: var(--text-sub);
}

.phonetic-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.speak-mini {
  border: none;
  background: #f5f5f5;
  border-radius: 50%;
  width: 28px;
  height: 28px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-sub);
  padding: 0;
}

.dict-exam {
  background: #f5f5f5;
  color: var(--text-sub);
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  margin-bottom: 16px;
}

.dict-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-main);
  margin: 0 0 8px 0;
}

.dict-meaning {
  margin-bottom: 16px;
}

.dict-meaning ul {
  padding: 0;
  margin: 0;
  list-style: none;
}

.dict-meaning li {
  padding: 8px 0;
  font-size: 15px;
  color: var(--text-main);
  border-bottom: 0.5px solid #f5f5f5;
  line-height: 1.5;
}

.dict-meaning li:last-child {
  border-bottom: none;
}
</style>
