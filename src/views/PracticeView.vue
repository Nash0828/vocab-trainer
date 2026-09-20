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
  <section class="card">
    <!-- 空词库 -->
    <div v-if="!hasWords" class="empty">
      <div class="empty-icon">📭</div>
      <h2>词库还是空的</h2>
      <p class="muted">先去「单词录入」添加一些单词，再来这里练习吧！</p>
      <button class="btn primary" @click="router.push('/input')">去录入单词 →</button>
    </div>

    <!-- 错题本模式：错题本为空 -->
    <div v-else-if="wrongState === 'empty'" class="empty">
      <div class="empty-icon">📕</div>
      <h2>错题本还是空的</h2>
      <p class="muted">在「背单词」中答错的单词会自动记入错题本，答对后自动移出</p>
      <div class="empty-actions">
        <button class="btn primary" @click="setSource('all')">切换到全部词库练习</button>
        <button class="btn ghost" @click="router.push('/wrongbook')">查看错题本</button>
      </div>
    </div>

    <!-- 错题本模式：错题本单词已全部背熟 -->
    <div v-else-if="wrongState === 'all-mastered'" class="empty">
      <div class="empty-icon">🎉</div>
      <h2>错题本中的单词都已背熟！</h2>
      <p class="muted">
        错题本里的 {{ wrongValid.length }} 个单词都已达到背熟阈值（{{ threshold }} 次），不再出现在出题中
      </p>
      <div class="empty-actions">
        <button class="btn primary" @click="setSource('all')">切换到全部词库</button>
        <button class="btn ghost" @click="router.push('/wrongbook')">查看错题本</button>
      </div>
    </div>

    <!-- 全部背熟 -->
    <div v-else-if="allMastered" class="empty">
      <div class="empty-icon">🏆</div>
      <h2>太棒了，全部背熟！</h2>
      <p class="muted">
        词库中 {{ totalMastered }} 个单词都已达到背熟阈值（{{ threshold }} 次），不再出现在随机出题中。
      </p>
      <div class="empty-actions">
        <button class="btn primary" @click="router.push('/settings')">去设置调整阈值 / 重置</button>
        <button class="btn ghost" @click="router.push('/library')">去词库看看</button>
      </div>
    </div>

    <!-- 有可练习单词 -->
    <template v-else>
      <div class="card-head">
        <h2>背单词</h2>
        <p class="muted">根据中文释义输入英文；答对 {{ threshold }} 次视为背熟，作答后自动切下一题</p>
      </div>

      <!-- 出题来源切换 -->
      <div class="source-bar">
        <span class="source-label">出题来源</span>
        <button
          class="source-btn"
          :class="{ active: sourceMode === 'all' }"
          @click="setSource('all')"
        >
          📚 全部未背熟
        </button>
        <button
          class="source-btn"
          :class="{ active: sourceMode === 'wrong' }"
          @click="setSource('wrong')"
        >
          📕 仅错题本
        </button>
        <span v-if="sourceMode === 'wrong'" class="muted small">错题本 {{ wrongValid.length }} 词</span>
      </div>

      <!-- 今日统计（可点击查看记录） -->
      <div class="today-bar">
        <span class="today-label">📅 今日背诵</span>
        <button class="today-stat today-correct" @click="openRecords('correct')">
          ✅ 正确 <strong>{{ todayStats.correct }}</strong> 次
        </button>
        <button class="today-stat today-wrong" @click="openRecords('wrong')">
          ❌ 错误 <strong>{{ todayStats.wrong }}</strong> 次
        </button>
        <span class="today-unique">
          已背 <strong>{{ todayUnique.totalWords }}</strong> 个单词
          <span class="unique-sub">（✅ {{ todayUnique.correctWords }} · ❌ {{ todayUnique.wrongWords }}，去重）</span>
        </span>
        <span class="muted small">点击数字查看当天记录</span>
      </div>

      <!-- 答题区 -->
      <div class="quiz-area">
        <div class="quiz-stats">
          <span v-if="sourceMode === 'wrong'">错题本共 {{ wrongValid.length }} 词</span>
          <span v-else>词库共 {{ words.length }} 词</span>
          <span>已背熟 {{ totalMastered }}/{{ words.length }}</span>
          <span>今日已答 {{ todayStats.total }} 题</span>
          <span class="stat-acc">正确率 {{ accuracy }}%</span>
          <span v-if="todayNewMastered" class="stat-mastered">今日新背熟 {{ todayNewMastered }} 个 🎉</span>
        </div>

        <div v-if="current" class="quiz-card" :class="result || ''">
          <p class="quiz-label">中文释义</p>
          <p class="quiz-word">{{ current.chinese }}</p>
          <p v-if="current.pos" class="quiz-pos">词性：{{ current.pos }}</p>

          <!-- 手动播放发音 + 查词典按钮 -->
          <div class="quiz-sound">
            <button class="btn ghost mini" title="播放当前单词发音" @click="speak(current.english)">
              🔊 播放发音
            </button>
            <button class="btn ghost mini" title="查询词典释义" @click="lookupWord(current.english)">
              📖 查词典
            </button>
          </div>

          <div class="quiz-progress">
            <span class="progress-text">背诵进度 {{ current.count }}/{{ threshold }}</span>
            <div class="progress-bar">
              <div
                class="progress-fill"
                :style="{ width: Math.min(100, Math.round(((current.count || 0) / threshold) * 100)) + '%' }"
              ></div>
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
              :placeholder="result ? '看结果了，即将自动切下一题…' : '请输入英文单词…'"
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
              <span class="fb-icon">🎉</span> 回答正确！很棒！
              <span v-if="current.count >= threshold" class="fb-mastered">（达成阈值，已背熟 🏆）</span>
              <button class="speak-btn" title="重听发音" @click="speak(current.english)">🔊 重听</button>
            </template>
            <template v-else>
              <span class="fb-icon">😅</span>
              {{ revealed ? '已显示答案，正确答案是' : '不对哦，正确答案是' }}
              <strong class="correct-word">{{ current.english }}</strong>
              <button class="speak-btn" title="重听发音" @click="speak(current.english)">🔊 重听</button>
            </template>
          </div>
          <p v-if="result" class="auto-hint">
            {{
              result === 'correct'
                ? '⏳ 即将自动切换到下一题…'
                : '可点「重做这一题」重新作答，按回车或点「下一题」继续'
            }}
          </p>

          <div class="quiz-actions">
            <button v-if="!result" class="btn ghost" @click="skip">换一题</button>
            <button v-if="!result" class="btn ghost" @click="revealAnswer">显示答案</button>
            <button v-if="!result" class="btn primary" :disabled="!answer.trim()" @click="submit">
              提交答案
            </button>
            <button
              v-else-if="result === 'correct'"
              class="btn ghost"
              @click="skip"
            >
              跳过等待，下一题 →
            </button>
            <template v-else>
              <button class="btn primary" @click="redo">🔁 重做这一题</button>
              <button class="btn ghost" @click="skip">下一题 →</button>
            </template>
          </div>
        </div>
      </div>
    </template>

    <!-- 今日记录弹窗 -->
    <div v-if="showRecordsModal" class="modal-mask" @click.self="closeRecords">
      <div class="modal">
        <div class="modal-head">
          <h3>📊 今日背诵记录</h3>
          <button class="btn ghost mini" @click="closeRecords">✕ 关闭</button>
        </div>
        <div class="modal-tabs">
          <button class="tab-btn" :class="{ active: modalTab === 'correct' }" @click="modalTab = 'correct'">
            ✅ 正确 ({{ todayStats.correct }})
          </button>
          <button class="tab-btn" :class="{ active: modalTab === 'wrong' }" @click="modalTab = 'wrong'">
            ❌ 错误 ({{ todayStats.wrong }})
          </button>
        </div>
        <div class="modal-body">
          <p v-if="!modalRecords.length" class="muted empty-tip">
            今天还没有{{ modalTab === 'correct' ? '答对' : '答错' }}的单词记录
          </p>
          <ul v-else class="modal-list">
            <li v-for="(r, i) in modalRecords" :key="r.id" class="modal-item">
              <span class="m-num">{{ i + 1 }}</span>
              <span class="m-en">{{ r.english }}</span>
              <span class="m-pos">{{ r.pos || '—' }}</span>
              <span class="m-zh">{{ r.chinese }}</span>
              <span v-if="!r.correct && r.userAnswer" class="m-wrong-answer">
                你答：{{ r.userAnswer }}
              </span>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- 词典查询弹窗 -->
    <div v-if="dictModal" class="dict-mask" @click.self="closeDict">
      <div class="dict-modal">
        <div class="dict-head">
          <h3>📖 {{ dictModal.word }}</h3>
          <button class="dict-close" @click="closeDict">✕</button>
        </div>
        <div class="dict-body">
          <div v-if="dictModal.loading" class="dict-loading">查询中…</div>
          <div v-else-if="dictModal.error" class="dict-error">⚠️ {{ dictModal.error }}</div>
          <div v-else-if="dictModal.data">
            <div v-if="dictModal.data.usphone || dictModal.data.ukphone" class="dict-phonetic">
              <span v-if="dictModal.data.ukphone" class="phonetic-item">
                英 [{{ dictModal.data.ukphone }}]
                <button class="speak-mini" @click="speak(dictModal.word, 1)" title="英式发音">🔊</button>
              </span>
              <span v-if="dictModal.data.usphone" class="phonetic-item" style="margin-left:12px">
                美 [{{ dictModal.data.usphone }}]
                <button class="speak-mini" @click="speak(dictModal.word, 0)" title="美式发音">🔊</button>
              </span>
            </div>
            <div v-if="dictModal.data.examType && dictModal.data.examType.length" class="dict-exam">
              考试类型：{{ dictModal.data.examType.join(' / ') }}
            </div>
            <div v-if="dictModal.data.trs && dictModal.data.trs.length" class="dict-meaning">
              <p class="dict-label">📝 释义</p>
              <ul>
                <li v-for="(tr, i) in dictModal.data.trs" :key="i">{{ tr }}</li>
              </ul>
            </div>
            <div v-if="dictModal.data.wfs && dictModal.data.wfs.length" class="dict-meaning">
              <p class="dict-label">📌 词形变化</p>
              <ul>
                <li v-for="(wf, i) in dictModal.data.wfs" :key="i">{{ wf }}</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* 出题来源切换 */
.source-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin: 16px 0 0;
}

.source-label {
  font-weight: 700;
  color: var(--text-main);
  font-size: 14px;
}

.source-btn {
  border: 1.5px solid var(--border);
  background: #ffffff;
  border-radius: 999px;
  padding: 6px 16px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-sub);
  cursor: pointer;
  transition: all 0.2s;
}

.source-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.source-btn.active {
  border-color: var(--primary);
  background: var(--primary-light);
  color: var(--primary);
}

.today-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin: 16px 0 4px;
  padding: 12px 16px;
  background: var(--bg-soft);
  border-radius: 12px;
}

.today-label {
  font-weight: 700;
  color: var(--text-main);
  font-size: 15px;
}

.today-stat {
  border: 1px solid var(--border);
  background: #ffffff;
  border-radius: 10px;
  padding: 6px 14px;
  font-size: 14px;
  color: var(--text-sub);
  cursor: pointer;
  transition: all 0.2s;
}

.today-stat strong {
  font-size: 17px;
  margin-left: 4px;
}

.today-stat.today-correct:hover {
  border-color: var(--success);
  color: var(--success);
  background: #eefaf3;
}

.today-stat.today-wrong:hover {
  border-color: var(--danger);
  color: var(--danger);
  background: #fdf1ef;
}

.today-unique {
  background: #ffffff;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 6px 14px;
  font-size: 14px;
  color: var(--text-main);
}

.today-unique strong {
  color: var(--primary);
  font-size: 17px;
  margin: 0 2px;
}

.today-unique .unique-sub {
  color: var(--text-sub);
  font-size: 13px;
}

.quiz-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  font-size: 14px;
  color: var(--text-sub);
  margin: 14px 0 18px;
}

.stat-acc {
  font-weight: 700;
  color: var(--primary);
}

.stat-mastered {
  font-weight: 700;
  color: var(--success);
}

.quiz-card {
  background: linear-gradient(135deg, #f0f7ff 0%, #ffffff 100%);
  border: 1.5px solid var(--border);
  border-radius: 16px;
  padding: 28px 24px;
  text-align: center;
}

.quiz-label {
  font-size: 14px;
  color: var(--text-sub);
  margin-bottom: 8px;
}

.quiz-word {
  font-size: 34px;
  font-weight: 800;
  color: var(--text-main);
  margin: 0 0 6px;
  word-break: break-all;
}

.quiz-pos {
  font-size: 14px;
  color: var(--primary);
  margin-bottom: 16px;
}

.quiz-sound {
  margin-bottom: 16px;
}

.quiz-progress {
  max-width: 420px;
  margin: 0 auto 18px;
}

.progress-text {
  display: block;
  font-size: 13px;
  color: var(--text-sub);
  margin-bottom: 5px;
}

.progress-bar {
  height: 8px;
  border-radius: 999px;
  background: #e3ebf4;
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
  max-width: 420px;
  padding: 13px 16px;
  font-size: 18px;
  text-align: center;
  border: 1.5px solid var(--border);
  border-radius: 12px;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.quiz-input input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(74, 144, 217, 0.15);
}

.quiz-input input:disabled {
  background: #f2f4f7;
  color: var(--text-sub);
}

.feedback {
  margin: 16px auto 0;
  max-width: 480px;
  padding: 12px 16px;
  border-radius: 12px;
  font-size: 15px;
}

.feedback.correct {
  background: #e8f7ee;
  color: #1f7a4d;
  border: 1px solid #a8dcc0;
}

.feedback.wrong {
  background: #fdecea;
  color: #b3402f;
  border: 1px solid #f2b8b1;
}

.fb-mastered {
  font-weight: 700;
}

.correct-word {
  font-size: 17px;
  letter-spacing: 0.5px;
}

.speak-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 16px;
  padding: 2px 6px;
  border-radius: 8px;
  vertical-align: middle;
  transition: all 0.2s;
}

.speak-btn:hover {
  background: rgba(74, 144, 217, 0.12);
  transform: scale(1.12);
}

.auto-hint {
  margin-top: 10px;
  font-size: 13px;
  color: var(--text-faint);
}

.quiz-actions {
  display: flex;
  justify-content: center;
  gap: 14px;
  margin-top: 20px;
  flex-wrap: wrap;
}

.empty-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
  flex-wrap: wrap;
}

.small {
  font-size: 13px;
}

/* ===== 记录弹窗 ===== */
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(20, 30, 45, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 16px;
}

.modal {
  background: #ffffff;
  border-radius: 16px;
  width: 100%;
  max-width: 480px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 10px 40px rgba(20, 30, 45, 0.25);
}

.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-light);
}

.modal-head h3 {
  font-size: 17px;
}

.modal-tabs {
  display: flex;
  gap: 8px;
  padding: 12px 20px 0;
}

.tab-btn {
  flex: 1;
  padding: 9px 10px;
  border: 1px solid var(--border);
  background: #ffffff;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-sub);
  cursor: pointer;
  transition: all 0.2s;
}

.tab-btn.active {
  border-color: var(--primary);
  background: var(--primary-light);
  color: var(--primary);
}

.modal-body {
  padding: 12px 20px 20px;
  overflow-y: auto;
}

.empty-tip {
  text-align: center;
  padding: 24px 0;
}

.modal-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.modal-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 10px;
  background: var(--bg-soft);
  font-size: 15px;
}

.m-num {
  color: var(--text-faint);
  font-size: 13px;
  width: 20px;
}

.m-en {
  font-weight: 700;
  color: var(--primary);
  min-width: 90px;
}

.m-pos {
  color: var(--text-sub);
  font-size: 13px;
  min-width: 40px;
}

.m-zh {
  flex: 1;
  color: var(--text-main);
}

.m-wrong-answer {
  display: block;
  width: 100%;
  color: var(--danger);
  font-size: 13px;
  margin-top: 2px;
}

/* ===== 移动端适配 ===== */
@media (max-width: 768px) {
  .source-bar {
    gap: 8px;
  }

  .today-bar {
    padding: 10px 12px;
    gap: 8px;
  }

  .today-stat {
    padding: 6px 10px;
    font-size: 13px;
  }

  .today-stat strong {
    font-size: 15px;
  }

  .quiz-stats {
    gap: 6px 12px;
    font-size: 13px;
  }

  .quiz-card {
    padding: 22px 16px;
  }

  .quiz-word {
    font-size: 28px;
  }

  .quiz-input input {
    font-size: 18px;
    padding: 14px 12px;
  }

  .quiz-actions {
    gap: 10px;
  }

  .quiz-actions .btn {
    flex: 1;
    min-width: 100px;
  }

  .modal-mask {
    padding: 8px;
    align-items: flex-end;
  }

  .modal {
    max-height: 85vh;
    border-radius: 16px 16px 0 0;
  }

  .m-en {
    min-width: 70px;
  }
}

/* ===== 词典查询弹窗 ===== */
.dict-mask {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 16px;
}

.dict-modal {
  background: #fff;
  border-radius: 16px;
  width: 100%;
  max-width: 480px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dict-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-light);
}

.dict-head h3 {
  font-size: 20px;
  margin: 0;
  color: var(--primary);
}

.dict-close {
  border: none;
  background: none;
  font-size: 20px;
  cursor: pointer;
  color: var(--text-faint);
  padding: 4px 8px;
}

.dict-body {
  padding: 16px 20px;
  overflow-y: auto;
}

.dict-loading, .dict-error {
  text-align: center;
  padding: 30px 0;
  color: var(--text-sub);
}

.dict-error {
  color: var(--danger);
}

.dict-phonetic {
  color: var(--text-sub);
  font-size: 15px;
  margin-bottom: 10px;
}

.dict-meaning {
  margin-bottom: 14px;
}

.dict-pos {
  display: inline-block;
  background: var(--primary-light);
  color: var(--primary);
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 6px;
}

.dict-meaning ul {
  padding-left: 20px;
  margin: 4px 0;
}

.dict-meaning li {
  margin-bottom: 6px;
  font-size: 14px;
  color: var(--text-main);
  line-height: 1.5;
}

.dict-example {
  color: var(--text-sub);
  font-size: 13px;
  margin: 2px 0 0 0;
  font-style: italic;
}

.dict-exam {
  background: #fff8e6;
  color: #b8860b;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 13px;
  margin-bottom: 12px;
}

.dict-label {
  font-weight: 700;
  color: var(--text-main);
  margin: 0 0 6px 0;
  font-size: 14px;
}

.phonetic-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.speak-mini {
  border: none;
  background: var(--primary-light);
  border-radius: 50%;
  width: 26px;
  height: 26px;
  font-size: 14px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.speak-mini:active {
  transform: scale(0.9);
}
</style>
