<script setup>
import { ref, computed, nextTick, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useWords, loadState, weightedPickIndex } from '../composables/useWords'
import { useHistory } from '../composables/useHistory'
import { useWrongBook } from '../composables/useWrongBook'
import { api } from '../api/index.js'

const router = useRouter()
const route = useRoute()
const pendingWord = ref(null) // 从词句库/今日记录跳转来的指定背诵词
const { words, settings, incrementCount, isMastered } = useWords()
const { getTodayStats, getTodayRecords, getTodayUniqueStats, addRecord } = useHistory()
const { addWrong, removeWrong, getValidWrongWords } = useWrongBook()

// 出题来源：'all' = 全部未背熟词库；'wrong' = 仅错题本
const sourceMode = ref('all')
// 背诵模式：'random' = 随机背诵（整词库）；'group' = 分组背诵（按组出题）
const practiceMode = ref(localStorage.getItem('vt_practice_mode') === 'group' ? 'group' : 'random')
const groups = ref([]) // { id, name, seq, size, mastered }
const groupTotal = ref(0) // 当前词库总词数
const selectedGroupId = ref(null)
const showGroupModal = ref(false) // 分组设置弹框
const draftGroups = ref([]) // 弹框编辑副本
const groupError = ref('')
watch(practiceMode, (m) => localStorage.setItem('vt_practice_mode', m))

async function loadGroups() {
  try {
    const r = await api.getGroups()
    groups.value = r.groups
    groupTotal.value = r.total
    if (practiceMode.value === 'group' && groups.value.length) {
      if (!selectedGroupId.value || !groups.value.some((g) => g.id === selectedGroupId.value)) {
        selectedGroupId.value = groups.value[0].id
      }
      if (groups.value.length && !current.value) next()
    }
  } catch (e) {}
}
// 词库变化（录入/删除/背诵次数）时刷新分组统计
watch(() => words.value, loadGroups, { deep: true })
// 类型筛选：'all' | 'word' | 'phrase' | 'sentence'
const typeFilter = ref('all')
const typeFilterOptions = [
  { value: 'all', label: '全部' },
  { value: 'word', label: '单词' },
  { value: 'phrase', label: '短语' },
  { value: 'sentence', label: '句子' },
]

// ---- 筛选底部面板（出题来源 + 类型） ----
const showFilterSheet = ref(false)
const draftSourceMode = ref('all')
const draftTypeFilter = ref('all')
const sourceOptions = [
  { value: 'all', label: '全部未背熟' },
  { value: 'wrong', label: '仅错题本' },
]
// 筛选按钮摘要：如 "全部未背熟" / "仅错题本 · 短语"
const filterSummary = computed(() => {
  const s = sourceOptions.find((o) => o.value === sourceMode.value)?.label || '全部未背熟'
  const t =
    typeFilter.value !== 'all'
      ? (typeFilterOptions.find((o) => o.value === typeFilter.value)?.label || '')
      : ''
  return t ? `${s} · ${t}` : s
})
// 是否启用了非默认筛选（用于按钮绿色高亮）
const hasFilter = computed(() => sourceMode.value !== 'all' || typeFilter.value !== 'all')
function openFilterSheet() {
  draftSourceMode.value = sourceMode.value
  draftTypeFilter.value = typeFilter.value
  showFilterSheet.value = true
}
function closeFilterSheet() {
  showFilterSheet.value = false
}
function resetFilterSheet() {
  draftSourceMode.value = 'all'
  draftTypeFilter.value = 'all'
  sourceMode.value = 'all'
  typeFilter.value = 'all'
  showFilterSheet.value = false
  lastIndex.value = -1
  clearAutoTimer()
  next()
}
function applyFilterSheet() {
  sourceMode.value = draftSourceMode.value
  typeFilter.value = draftTypeFilter.value
  showFilterSheet.value = false
  lastIndex.value = -1
  clearAutoTimer()
  next()
}
function clearTypeFilter() {
  typeFilter.value = 'all'
  lastIndex.value = -1
  clearAutoTimer()
  next()
}

const current = ref(null)
// 中文为短语/句子时自适应缩小字号
const quizWordClass = computed(() => {
  const len = (current.value?.chinese || '').length
  if (len > 30) return 'xlong'
  if (len > 12) return 'long'
  return ''
})
const answer = ref('')
const result = ref(null) // null | 'correct' | 'wrong'
const revealed = ref(false) // 是否通过"显示答案"按钮作答
const isRedo = ref(false) // 是否处于重做模式（重做答对不算答对、不移除错题本）
const answeredLock = ref(false) // 答对后等待发音播报期间锁定输入框
const lastIndex = ref(-1)
const answerInput = ref(null)
const focusEnabled = ref(false)
let autoTimer = null // 作答后自动切换下一题的定时器

// 今日统计与记录弹窗
const todayStats = ref(getTodayStats())
const todayUnique = ref(getTodayUniqueStats()) // 今日去重单词统计（重复单词只算一次）
const todayRecords = ref([])
const showRecordsModal = ref(false)
const modalTab = ref('correct') // 'all' | 'correct' | 'wrong'
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
// 出题池：随机模式 = 未背熟单词 ∩ 类型筛选；分组模式 = 所选组内未背熟 ∩ 类型筛选；错题本模式 = 错题本中且未背熟 ∩ 类型筛选（组内错题）
const available = computed(() => {
  const matchType = (w) => typeFilter.value === 'all' || (w.type || 'word') === typeFilter.value
  let base
  if (practiceMode.value === 'group') {
    if (!selectedGroupId.value) return []
    const gid = String(selectedGroupId.value)
    base = words.value.filter((w) => String(w.groupId || '') === gid)
  } else {
    base = words.value
  }
  if (sourceMode.value === 'wrong') {
    const ids = new Set(base.map((w) => String(w.id)))
    return wrongValid.value
      .map((item) => resolveWord(item))
      .filter((w) => w && !isMastered(w) && matchType(w) && ids.has(String(w.id)))
  }
  return base.filter((w) => !isMastered(w) && matchType(w))
})
const allMastered = computed(() => hasWords.value && available.value.length === 0)
// 分组模式：尚未设置任何分组
const groupEmpty = computed(() => practiceMode.value === 'group' && !groups.value.length)
// 类型筛选下无可用词句：类型筛选生效且出题池为空
const filterEmpty = computed(
  () => typeFilter.value !== 'all' && available.value.length === 0
)
// 错题本模式空状态：'empty'=错题本为空；'all-mastered'=错题本单词已全部背熟；null=正常
const wrongState = computed(() => {
  if (sourceMode.value !== 'wrong') return null
  if (!wrongValid.value.length) return 'empty'
  if (!available.value.length) return 'all-mastered'
  return null
})
const totalMastered = computed(() => words.value.filter((w) => isMastered(w)).length)
// 待练数：未背熟的单词总数
const pendingWords = computed(() => words.value.filter((w) => !isMastered(w)).length)
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

// 分组模式：当前组背完自动切到下一组（按序号顺序，跳过无可用词的组；找不到返回 null）
function findNextGroupWithWords() {
  const ordered = [...groups.value].sort((a, b) => a.seq - b.seq)
  const curIdx = ordered.findIndex((g) => g.id === selectedGroupId.value)
  const matchType = (w) => typeFilter.value === 'all' || (w.type || 'word') === typeFilter.value
  const ids = new Set(
    words.value.filter((w) => !isMastered(w) && matchType(w)).map((w) => String(w.groupId || ''))
  )
  for (let i = curIdx + 1; i < ordered.length; i++) {
    if (ids.has(String(ordered[i].id))) return ordered[i]
  }
  return null
}

function focusInput(force = false) {
  if (!force && !focusEnabled.value) return
  const el = answerInput.value
  if (!el) return
  // 同步聚焦：必须在用户手势内执行，iOS 才会弹出键盘
  try { el.focus() } catch (e) {}
  // 兜底：等 Vue 更新 disabled 等属性后再聚焦一次
  nextTick(() => {
    const el2 = answerInput.value
    if (el2 && document.activeElement !== el2) {
      try { el2.focus() } catch (e) {}
    }
  })
}

function next() {
  if (answeredLock.value) return // 等发音播报完成，禁止手动换题
  clearAutoTimer()
  answeredLock.value = false
  // 优先背诵指定词（从词句库/今日记录跳转）
  if (pendingWord.value) {
    const w = pendingWord.value
    pendingWord.value = null
    current.value = w
    answer.value = ''
    result.value = null
    revealed.value = false
    isRedo.value = false
    focusInput(true) // 指定背诵场景强制聚焦
    return
  }
  if (!available.value.length) {
    // 分组模式：当前组背完自动切到下一组（一组一组来背）
    if (practiceMode.value === 'group' && groups.value.length) {
      const nxt = findNextGroupWithWords()
      if (nxt) {
        selectedGroupId.value = nxt.id
        lastIndex.value = -1
        next()
        return
      }
    }
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
  // 大小写敏感：开启则严格匹配，否则不区分大小写（均去除首尾空格）
  const userInput = answer.value.trim()
  const rightAnswer = current.value.english.trim()
  const isCorrect = current.value.caseSensitive
    ? userInput === rightAnswer
    : userInput.toLowerCase() === rightAnswer.toLowerCase()

  if (isRedo.value) {
    // 重做模式：无论对错都不算正式作答，只显示反馈，不更新 count、不移除/加入错题本
    result.value = isCorrect ? 'correct' : 'wrong'
    speak(current.value.english, 0, null, 'main')
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
  revealed.value = false
  const answeredWord = current.value.english

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
    // 答对：锁定输入，等正确发音播报完成后自动切换下一题并聚焦
    answeredLock.value = true
    speak(answeredWord, 0, () => {
      answeredLock.value = false
      next()
      focusInput()
    }, 'main')
  } else {
    speak(answeredWord, 0, null, 'main')
    result.value = 'wrong'
  }
}

function skip() {
  clearAutoTimer()
  next()
}

// 播放发音（有道优先，失败回退百度 TTS，再失败回退系统 TTS）；onDone 为播放最终结束时回调（只触发一次）
let currentAudio = null
const audioPlaying = ref(false)
const playingKey = ref('') // 当前正在播放的按钮标识，独立控制动画
let audioDone = null

function fireDone() {
  playingKey.value = ''
  if (audioDone) {
    const fn = audioDone
    audioDone = null
    try { fn() } catch (e) {}
  }
}

function speak(word, type = 0, onDone = null, key = '') {
  if (!word || audioPlaying.value) return
  if (onDone) audioDone = onDone
  const text = String(word).trim()
  audioPlaying.value = true
  playingKey.value = key
  try {
    const url = `https://dict.youdao.com/dictvoice?type=${type}&audio=${encodeURIComponent(text)}`
    currentAudio = new Audio(url)
    let fallbacked = false
    const once = () => {
      if (fallbacked) return
      fallbacked = true
      speakBaidu(text)
    }
    currentAudio.onended = () => { audioPlaying.value = false; fireDone() }
    currentAudio.onpause = () => { audioPlaying.value = false; fireDone() }
    currentAudio.onerror = once
    currentAudio.play().catch(once)
  } catch (e) {
    speakBaidu(text)
  }
}

// 百度 TTS（走本服务代理 /api/tts，支持任意句子）
function speakBaidu(text) {
  try {
    const url = `/api/tts?text=${encodeURIComponent(text)}`
    currentAudio = new Audio(url)
    let fallbacked = false
    const once = () => {
      if (fallbacked) return
      fallbacked = true
      speakViaSpeechSynthesis(text)
    }
    currentAudio.onended = () => { audioPlaying.value = false; fireDone() }
    currentAudio.onpause = () => { audioPlaying.value = false; fireDone() }
    currentAudio.onerror = once
    currentAudio.play().catch(once)
  } catch (e) {
    speakViaSpeechSynthesis(text)
  }
}

// 系统 TTS 朗读（保底）
function speakViaSpeechSynthesis(text) {
  if (!('speechSynthesis' in window)) { audioPlaying.value = false; fireDone(); return }
  try {
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'en-US'
    u.rate = 1
    const voices = window.speechSynthesis.getVoices()
    const enVoice =
      voices.find((v) => /^en(-|_)?US/i.test(v.lang)) ||
      voices.find((v) => /^en/i.test(v.lang))
    if (enVoice) u.voice = enVoice
    u.onend = () => { audioPlaying.value = false; fireDone() }
    u.onerror = () => { audioPlaying.value = false; fireDone() }
    window.speechSynthesis.speak(u)
  } catch (e) {
    audioPlaying.value = false
    fireDone()
  }
}

// 例句中高亮当前单词（含常见词形变化）
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function highlightWord(word, sentence) {
  const esc = escapeHtml(sentence)
  const w = String(word || '').trim()
  if (!w) return esc
  try {
    const base = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const suffixes = ['s', 'es', 'ed', 'ing', 'd', "'s"]
    if (/[^aeiou]y$/i.test(w)) suffixes.push('ies')
    // 不用 lookbehind（部分移动端浏览器不支持），前缀用捕获组保留
    const re = new RegExp(`([^a-zA-Z]|^)(${base}(?:${suffixes.join('|')})?)(?![a-zA-Z])`, 'gi')
    return esc.replace(re, (m, prefix, wordPart) => `${prefix}<span class="sent-hl">${wordPart}</span>`)
  } catch (e) {
    return esc
  }
}

// 把英文单词拆成可点击的词链接；hlWord 匹配的词额外高亮
function wordify(text, hlWord) {
  const esc = escapeHtml(text)
  const w = String(hlWord || '').trim().toLowerCase()
  try {
    const base = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const suffixes = ['s', 'es', 'ed', 'ing', 'd', "'s"]
    if (/[^aeiou]y$/i.test(w)) suffixes.push('ies')
    const re = new RegExp(`^(?:${base})(?:${suffixes.join('|')})?$`, 'i')
    return esc.replace(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g, (m) => {
      const isHl = w && re.test(m.toLowerCase())
      const cls = isHl ? 'word-link sent-hl' : 'word-link'
      return `<span class="${cls}" data-word="${m}">${m}</span>`
    })
  } catch (e) { return esc }
}

// 例句/词形变化点击事件委托：点中词链接则弹气泡查询
function onDictTextClick(e) {
  const el = e.target && e.target.closest ? e.target.closest('.word-link') : null
  if (!el) return
  const w = el.getAttribute('data-word')
  if (w) openWordBubble(w, el)
}

// 单词气泡查询（微信风格小卡片，定位在单词上方 10px，带指向箭头）
const wordBubble = ref(null)
const wbEl = ref(null)
function closeWordBubble() {
  wordBubble.value = null
  document.removeEventListener('click', closeWordBubble)
}
function placeBubble(rect) {
  const b = wordBubble.value
  if (!b || !rect) return
  const wb = wbEl.value
  const h = wb ? wb.offsetHeight : 180
  let top = rect.top - h - 10
  b.flip = false
  if (top < 8) {
    top = rect.bottom + 10
    b.flip = true
  }
  b.top = top
  const center = rect.left + rect.width / 2
  let arrowLeft = center - b.left - 6
  arrowLeft = Math.max(12, Math.min(arrowLeft, b.width - 18))
  b.arrowLeft = arrowLeft
  b.ready = true
}
async function openWordBubble(word, el) {
  if (!word || !el) return
  const rect = el.getBoundingClientRect()
  const width = Math.min(340, window.innerWidth * 0.88)
  let left = rect.left + rect.width / 2 - width / 2
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8))
  wordBubble.value = { word, data: null, loading: true, error: null, top: 0, left, width, arrowLeft: 50, flip: false, ready: false }
  nextTick(() => placeBubble(rect))
  document.removeEventListener('click', closeWordBubble)
  setTimeout(() => document.addEventListener('click', closeWordBubble), 0)
  try {
    const res = await fetch(`/api/dict?word=${encodeURIComponent(word.trim().toLowerCase())}`)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      throw new Error(j.error || '查询失败')
    }
    wordBubble.value.data = await res.json()
  } catch (err) {
    wordBubble.value.error = err.message || '查询失败，请稍后重试'
  } finally {
    wordBubble.value.loading = false
    nextTick(() => placeBubble(rect))
  }
}
// 朗读例句（有道 dictvoice type=2 句子发音）
function speakSentence(sentence, key = '') {
  if (!sentence || audioPlaying.value) return
  try {
    audioPlaying.value = true
    playingKey.value = key
    const url = `https://dict.youdao.com/dictvoice?type=2&audio=${encodeURIComponent(String(sentence).trim())}`
    currentAudio = new Audio(url)
    const done = () => { audioPlaying.value = false; if (playingKey.value === key) playingKey.value = '' }
    currentAudio.onended = done
    currentAudio.onpause = done
    currentAudio.onerror = done
    currentAudio.play().catch(done)
  } catch (e) {
    audioPlaying.value = false
    if (playingKey.value === key) playingKey.value = ''
  }
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

// 弹窗打开时禁止背景滚动（iOS 全版本可靠的 body 滚动锁）
let dictScrollY = 0
watch(dictModal, (val) => {
  if (val) {
    dictScrollY = window.scrollY
    document.body.style.position = 'fixed'
    document.body.style.top = `-${dictScrollY}px`
    document.body.style.left = '0'
    document.body.style.right = '0'
    document.body.style.width = '100%'
  } else {
    document.body.style.position = ''
    document.body.style.top = ''
    document.body.style.left = ''
    document.body.style.right = ''
    document.body.style.width = ''
    window.scrollTo(0, dictScrollY)
  }
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
  speak(current.value.english), 0, null, 'main'
}

// 切换出题来源
function setSource(mode) {
  if (mode === sourceMode.value) return
  sourceMode.value = mode
  lastIndex.value = -1
  clearAutoTimer()
  next()
}

// ===== 背诵模式切换（随机 / 分组） =====
function setMode(m) {
  if (practiceMode.value === m) return
  practiceMode.value = m
  lastIndex.value = -1
  clearAutoTimer()
  if (m === 'group') {
    if (!groups.value.length) {
      current.value = null
      result.value = null
      openGroupModal()
      return
    }
    if (!selectedGroupId.value || !groups.value.some((g) => g.id === selectedGroupId.value)) {
      selectedGroupId.value = groups.value[0].id
    }
  }
  next()
}
// 分组下拉切换
function onSelectGroup(e) {
  const v = e.target.value
  selectedGroupId.value = /^\d+$/.test(v) ? Number(v) : v
  lastIndex.value = -1
  clearAutoTimer()
  current.value = null
  result.value = null
  answer.value = ''
  next()
}

// ===== 分组设置弹框 =====
function openGroupModal() {
  draftGroups.value = groups.value.map((g) => ({ id: g.id, name: g.name, seq: g.seq, size: g.size, mastered: g.mastered }))
  groupError.value = ''
  showGroupModal.value = true
}
function closeGroupModal() {
  showGroupModal.value = false
}
function addGroupDraft() {
  const used = draftGroups.value.reduce((a, g) => a + (Number(g.size) || 0), 0)
  const size = Math.max(0, groupTotal.value - used)
  draftGroups.value.push({ id: null, name: '组' + (draftGroups.value.length + 1), seq: draftGroups.value.length + 1, size, mastered: 0 })
}
function removeGroupDraft(idx) {
  const g = draftGroups.value[idx]
  draftGroups.value.splice(idx, 1)
  // 被删组的数量随机分摊到其他组（保持总和 = 词库总数）
  if (g && Number(g.size) > 0 && draftGroups.value.length) {
    for (let i = 0; i < Number(g.size); i++) {
      const t = draftGroups.value[Math.floor(Math.random() * draftGroups.value.length)]
      t.size = (Number(t.size) || 0) + 1
    }
  }
  draftGroups.value.forEach((x, i) => (x.seq = i + 1))
}
const draftAssigned = computed(() => draftGroups.value.reduce((a, g) => a + (Number(g.size) || 0), 0))
const draftValid = computed(
  () =>
    draftGroups.value.length > 0 &&
    draftAssigned.value === groupTotal.value &&
    draftGroups.value.every(
      (g) => String(g.name || '').trim() && Number.isFinite(Number(g.size)) && Number(g.size) >= 0
    )
)
async function saveGroupsDraft() {
  if (!draftValid.value) return
  try {
    // 按用户设定的序号排序保存（决定背诵组出现顺序）
    const ordered = [...draftGroups.value].sort((a, b) => a.seq - b.seq)
    const r = await api.saveGroups(
      ordered.map((g) => ({ id: g.id, name: String(g.name).trim(), seq: g.seq, size: Number(g.size) }))
    )
    groups.value = r.groups
    if (!selectedGroupId.value || !groups.value.some((g) => g.id === selectedGroupId.value)) {
      selectedGroupId.value = groups.value[0]?.id || null
    }
    // 重新拉取 state：让 words 携带最新的 groupId，出题池才能匹配到组内词
    try {
      const st = await api.getState()
      if (st && Array.isArray(st.words)) loadState(st)
    } catch (e) {}
    showGroupModal.value = false
    lastIndex.value = -1
    clearAutoTimer()
    next()
  } catch (e) {
    groupError.value = e.message || '保存失败'
  }
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
  if (modalTab.value === 'correct') return recs.filter((r) => r.correct)
  if (modalTab.value === 'wrong') return recs.filter((r) => !r.correct)
  return recs
})

// 跳转背诵指定单词（来自词句库/今日背诵记录的"背诵"按钮）
function goPractice(word) {
  if (!word) return
  closeRecords()
  router.push({ path: '/practice', query: { word } })
}

// 从路由 query 解析指定背诵词
function setPendingFromQuery() {
  const q = route.query.word
  if (!q) return
  const w = words.value.find((x) => x.english.trim().toLowerCase() === String(q).trim().toLowerCase())
  if (w) pendingWord.value = w
}

// 全局键盘：Ctrl+P 朗读 / Ctrl+N 下一题 / Ctrl+A 显示答案 / Ctrl+Q 查词详情；答错/重做答对后回车进入下一题
function onGlobalKeydown(e) {
  const key = (e.key || '').toLowerCase()
  // Esc：关闭查词弹框 / 单词气泡
  if (e.key === 'Escape') {
    if (dictModal.value) closeDict()
    else if (wordBubble.value) closeWordBubble()
    return
  }
  // Ctrl+↓：下一题（阻止页面滚动）
  if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowDown') {
    e.preventDefault()
    next()
    return
  }
  // Ctrl+A：显示答案（阻止输入框全选）
  if ((e.ctrlKey || e.metaKey) && key === 'a') {
    e.preventDefault()
    revealAnswer()
    return
  }
  // Ctrl+Q：查询当前单词详情（阻止浏览器默认行为）
  if ((e.ctrlKey || e.metaKey) && key === 'q') {
    e.preventDefault()
    if (current.value) lookupWord(current.value.english)
    return
  }
  // Ctrl+P（Mac 为 Cmd+P）：朗读当前单词，阻止浏览器打印对话框，焦点留在输入框
  if ((e.ctrlKey || e.metaKey) && key === 'p') {
    e.preventDefault()
    if (current.value) speak(current.value.english)
    return
  }
  // Ctrl+R：答错后重做这一题（答错时阻止浏览器默认刷新并重做；未答错时放行）
  if ((e.ctrlKey || e.metaKey) && key === 'r') {
    if (result.value === 'wrong') {
      e.preventDefault()
      redo()
    }
    return
  }
  if (e.key !== 'Enter') return
  const canSkip = result.value === 'wrong' || (result.value === 'correct' && isRedo.value)
  if (!canSkip) return
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
  setPendingFromQuery()
  if (pendingWord.value) next()
  loadGroups()
})

watch(
  () => route.query.word,
  () => {
    setPendingFromQuery()
    next()
  }
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onGlobalKeydown)
  document.removeEventListener('click', closeWordBubble)
  clearAutoTimer()
  if (todayInterval) clearInterval(todayInterval)
})

// 首次进入时准备第一题并刷新今日统计
refreshToday()
next()
</script>

<template>
  <div class="practice">
    <!-- 今日统计 + 待练（两卡片一行，全局数据不受筛选影响，置顶显示） -->
    <div class="stats-row">
      <div class="stats-card">
        <div class="stats-title">今日背诵</div>
        <div class="today-grid">
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
            <span class="stat-label">已背</span>
          </div>
          <div class="stat-item">
            <span class="stat-num">{{ accuracy }}%</span>
            <span class="stat-label">正确率</span>
          </div>
        </div>
      </div>
      <button class="stats-card pending-card" @click="router.push('/library')">
        <div class="stats-title">待练</div>
        <div class="pending-num">{{ pendingWords }}</div>
        <div class="pending-desc">未背熟词句</div>
      </button>
    </div>

    <!-- 背诵模式切换 + 筛选入口（一行） -->
    <div class="mode-row">
      <div class="mode-tabs">
        <button class="mode-tab" :class="{ active: practiceMode === 'random' }" @click="setMode('random')">随机背诵</button>
        <button class="mode-tab" :class="{ active: practiceMode === 'group' }" @click="setMode('group')">分组背诵</button>
      </div>
      <button
        v-if="hasWords"
        class="filter-icon-btn"
        :class="{ active: hasFilter }"
        title="筛选"
        @click="openFilterSheet"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
      </button>
    </div>

    <!-- 分组模式：组下拉选框 + 分组设置 -->
    <div v-if="practiceMode === 'group'" class="group-row">
      <select v-if="groups.length" class="group-select" :value="selectedGroupId" @change="onSelectGroup">
        <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}（已背熟 {{ g.mastered }}/{{ g.size }}）</option>
      </select>
      <span v-else class="group-empty-hint">尚未设置分组</span>
      <button class="group-set-btn" @click="openGroupModal">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>
        分组设置
      </button>
    </div>

    <!-- 空词库 -->
    <div v-if="!hasWords" class="empty-state">
      <div class="empty-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#c8c8c8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
      </div>
      <p class="empty-title">词句库还是空的</p>
      <p class="empty-desc">先去录入一些单词，再来这里练习吧</p>
      <button class="empty-btn" @click="router.push('/input')">去录入单词</button>
    </div>

    <!-- 分组模式：尚未设置分组 -->
    <div v-else-if="groupEmpty" class="empty-state">
      <div class="empty-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#c8c8c8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>
      </div>
      <p class="empty-title">尚未设置分组</p>
      <p class="empty-desc">点击上方「分组设置」把词句分成若干组，一组一组来背</p>
      <button class="empty-btn" @click="openGroupModal">去设置分组</button>
    </div>

    <!-- 错题本模式：错题本为空 -->
    <div v-else-if="wrongState === 'empty'" class="empty-state">
      <div class="empty-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#c8c8c8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      </div>
      <p class="empty-title">错题本还是空的</p>
      <p class="empty-desc">在背单词中答错的单词会自动记入错题本</p>
      <button class="empty-btn" @click="setSource('all')">切换到全部词句库</button>
    </div>

    <!-- 错题本模式：错题本单词已全部背熟 -->
    <div v-else-if="wrongState === 'all-mastered'" class="empty-state">
      <div class="empty-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#c8c8c8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      </div>
      <p class="empty-title">错题本都背熟了</p>
      <p class="empty-desc">错题本里的单词都已达到背熟阈值</p>
      <button class="empty-btn" @click="setSource('all')">切换到全部词句库</button>
    </div>

    <!-- 全部背熟 / 所有分组都背完 -->
    <div v-else-if="allMastered && !filterEmpty" class="empty-state">
      <div class="empty-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#c8c8c8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>
      </div>
      <p class="empty-title">{{ practiceMode === 'group' ? '所有分组都背完了' : '全部背熟了' }}</p>
      <p class="empty-desc">{{ practiceMode === 'group' ? '所选分组中的词句都已达到背熟阈值' : '词句库中所有词句都已达到背熟阈值' }}</p>
      <button class="empty-btn" @click="router.push('/settings')">去设置调整</button>
    </div>

    <!-- 类型筛选下没有可练习词句 -->
    <div v-else-if="filterEmpty" class="empty-state">
      <div class="empty-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#c8c8c8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      </div>
      <p class="empty-title">「{{ filterSummary }}」下没有可练习的词句</p>
      <p class="empty-desc">试试切换类型筛选，或先录入一些{{ filterSummary }}</p>
      <button class="empty-btn" @click="clearTypeFilter">清除筛选</button>
    </div>

    <!-- 有可练习单词 -->
    <template v-else>
      <!-- 筛选底部面板：出题来源 + 类型 -->
      <transition name="sheet">
        <div v-if="showFilterSheet" class="sheet-mask" @click.self="closeFilterSheet" @touchmove.prevent>
          <div class="sheet" @touchmove.stop>
            <div class="sheet-title">筛选</div>
            <div class="sheet-body">
              <div class="sheet-group">
                <div class="sheet-group-title">出题来源</div>
                <div class="sheet-opts">
                  <button
                    v-for="opt in sourceOptions"
                    :key="opt.value"
                    class="sheet-opt"
                    :class="{ active: draftSourceMode === opt.value }"
                    @click="draftSourceMode = opt.value"
                  >{{ opt.label }}</button>
                </div>
              </div>
              <div class="sheet-group">
                <div class="sheet-group-title">类型</div>
                <div class="sheet-opts">
                  <button
                    v-for="opt in typeFilterOptions"
                    :key="opt.value"
                    class="sheet-opt"
                    :class="{ active: draftTypeFilter === opt.value }"
                    @click="draftTypeFilter = opt.value"
                  >{{ opt.label }}</button>
                </div>
              </div>
            </div>
            <div class="sheet-foot">
              <button class="sheet-btn ghost" @click="resetFilterSheet">重置</button>
              <button class="sheet-btn primary" @click="applyFilterSheet">确定</button>
            </div>
          </div>
        </div>
      </transition>

      <!-- 答题区 -->
      <div class="quiz-card">
        <p class="quiz-label">中文</p>
        <p class="quiz-word" :class="quizWordClass">{{ current.chinese }}</p>
        <p v-if="current.pos" class="quiz-pos">{{ current.pos }}</p>

        <div class="quiz-sound">
          <button class="sound-btn" :class="{ 'is-playing': playingKey === 'main' }" @click="speak(current.english, 0, null, 'main')"><span class="spk-static">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg></span><span class="spk-eq"><i></i><i></i><i></i></span>
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
          <!-- 单词：单行输入框；短语/句子：多行文本框 -->
          <input
            v-if="current.type === 'word'"
            ref="answerInput"
            v-model="answer"
            type="text"
            lang="en"
            inputmode="text"
            enterkeyhint="go"
            autocorrect="off"
            placeholder="输入英文"
            :disabled="!!result || answeredLock"
            @focus="focusEnabled = true"
            @keyup.enter="submit"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
          />
          <textarea
            v-else
            ref="answerInput"
            v-model="answer"
            lang="en"
            inputmode="text"
            rows="2"
            autocorrect="off"
            placeholder="输入英文"
            :disabled="!!result || answeredLock"
            @focus="focusEnabled = true"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
          ></textarea>
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
          <button class="speak-btn" :class="{ 'is-playing': playingKey === 'main2' }" @click="speak(current.english, 0, null, 'main2')"><span class="spk-static">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg></span><span class="spk-eq"><i></i><i></i><i></i></span>
            重听
          </button>
        </div>

        <div class="quiz-actions">
          <button v-if="!result" class="btn ghost" :disabled="answeredLock" @click="skip">换一题</button>
          <button v-if="!result" class="btn ghost" :disabled="answeredLock" @click="revealAnswer">显示答案</button>
          <button v-if="!result" class="btn primary" :disabled="!answer.trim() || answeredLock" @click="submit">提交</button>
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
    <div v-if="showRecordsModal" class="modal-mask" @click.self="closeRecords" @touchmove.prevent>
      <div class="modal" @touchmove.stop>
        <div class="modal-head">
          <h3>今日背诵记录</h3>
          <button class="modal-close" @click="closeRecords">✕</button>
        </div>
        <div class="modal-tabs">
          <button class="tab-btn" :class="{ active: modalTab === 'all' }" @click="modalTab = 'all'">
            全部 ({{ todayStats.total }})
          </button>
          <button class="tab-btn" :class="{ active: modalTab === 'correct' }" @click="modalTab = 'correct'">
            正确 ({{ todayStats.correct }})
          </button>
          <button class="tab-btn" :class="{ active: modalTab === 'wrong' }" @click="modalTab = 'wrong'">
            错误 ({{ todayStats.wrong }})
          </button>
        </div>
        <div class="modal-body" @touchmove.stop>
          <p v-if="!modalRecords.length" class="empty-tip">
            今天还没有{{ modalTab === 'all' ? '背诵记录' : (modalTab === 'correct' ? '答对' : '答错') + '的单词记录' }}
          </p>
          <ul v-else class="modal-list">
            <li v-for="(r, i) in modalRecords" :key="r.id" class="modal-item">
              <div class="m-main">
                <span class="m-en">{{ r.english }}</span>
                <span v-if="r.pos" class="m-pos">{{ r.pos }}</span>
                <button class="study-btn" @click="goPractice(r.english)" title="背诵">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
                </button>
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
    <div v-if="dictModal" class="dict-mask" @click.self="closeDict" @touchmove.prevent>
      <div class="dict-modal" @touchmove.stop>
        <div class="dict-head">
          <h3>{{ dictModal.word }}</h3>
          <button class="dict-close" @click="closeDict">✕</button>
        </div>
        <div class="dict-body">
          <div v-if="dictModal.loading" class="dict-loading">查询中…</div>
          <div v-else-if="dictModal.error" class="dict-error">{{ dictModal.error }}</div>
          <div v-else-if="dictModal.data">
            <div v-if="dictModal.data.translation" class="dict-meaning">
              <p class="dict-label">整句翻译</p>
              <div class="trans-block" @click="onDictTextClick">
                <div class="trans-src-row">
                  <p class="trans-src" v-html="wordify(dictModal.word, '')"></p>
                  <button class="speak-mini" :class="{ 'is-playing': playingKey === 'read' }" @click="speak(dictModal.word, 0, null, 'read')" title="朗读"><span class="spk-static">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg></span><span class="spk-eq"><i></i><i></i><i></i></span>
                  </button>
                </div>
                <p class="trans-dst">{{ dictModal.data.translation }}</p>
              </div>
            </div>
            <div v-if="dictModal.data.usphone || dictModal.data.ukphone" class="dict-phonetic">
              <span v-if="dictModal.data.ukphone" class="phonetic-item">
                英 [{{ dictModal.data.ukphone }}]
                <button class="speak-mini" :class="{ 'is-playing': playingKey === 'uk' }" @click="speak(dictModal.word, 1, null, 'uk')" title="英式发音"><span class="spk-static">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg></span><span class="spk-eq"><i></i><i></i><i></i></span>
                </button>
              </span>
              <span v-if="dictModal.data.usphone" class="phonetic-item" style="margin-left:12px">
                美 [{{ dictModal.data.usphone }}]
                <button class="speak-mini" :class="{ 'is-playing': playingKey === 'us' }" @click="speak(dictModal.word, 0, null, 'us')" title="美式发音"><span class="spk-static">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg></span><span class="spk-eq"><i></i><i></i><i></i></span>
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
            <div v-if="dictModal.data.wfs && dictModal.data.wfs.length" class="dict-meaning" @click="onDictTextClick">
              <p class="dict-label">词形变化</p>
              <ul>
                <li v-for="(wf, i) in dictModal.data.wfs" :key="i" v-html="wordify(wf, '')"></li>
              </ul>
            </div>
            <div v-if="dictModal.data.sentences && dictModal.data.sentences.length" class="dict-meaning" @click="onDictTextClick">
              <p class="dict-label">例句</p>
              <ul class="sent-list">
                <li v-for="(s, i) in dictModal.data.sentences" :key="i" class="sent-item">
                  <div class="sent-line">
                    <p class="sent-en" v-html="wordify(s.en, dictModal.word)"></p>
                    <button class="sent-speak" :class="{ 'is-playing': playingKey === 's' + i }" @click="speakSentence(s.en, 's' + i)" title="朗读例句"><span class="spk-static">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg></span><span class="spk-eq"><i></i><i></i><i></i></span>
                    </button>
                  </div>
                  <p v-if="s.zh" class="sent-zh">{{ s.zh }}</p>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <!-- 单词气泡 -->
        <div v-if="wordBubble" ref="wbEl" class="wb-pop" :style="{ top: wordBubble.top + 'px', left: wordBubble.left + 'px', width: wordBubble.width + 'px', opacity: wordBubble.ready ? 1 : 0 }" @click.stop>
          <div class="wb-arrow" :class="{ flip: wordBubble.flip }" :style="{ left: wordBubble.arrowLeft + 'px' }"></div>
          <div v-if="wordBubble.loading" class="wb-loading">查询中…</div>
          <div v-else-if="wordBubble.error" class="wb-error">{{ wordBubble.error }}</div>
          <template v-else-if="wordBubble.data">
            <div class="wb-head">
              <div class="wb-word">{{ wordBubble.word }}</div>
              <button class="speak-mini" :class="{ 'is-playing': playingKey === 'bubble' }" @click="speak(wordBubble.word, 0, null, 'bubble')" title="朗读"><span class="spk-static">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg></span><span class="spk-eq"><i></i><i></i><i></i></span>
              </button>
            </div>
            <div v-if="wordBubble.data.usphone || wordBubble.data.ukphone" class="wb-phone">
              <span v-if="wordBubble.data.ukphone">英 [{{ wordBubble.data.ukphone }}]</span>
              <span v-if="wordBubble.data.usphone" style="margin-left:8px">美 [{{ wordBubble.data.usphone }}]</span>
            </div>
            <ul v-if="wordBubble.data.trs && wordBubble.data.trs.length" class="wb-trs">
              <li v-for="(tr, i) in wordBubble.data.trs.slice(0, 3)" :key="i">{{ tr }}</li>
            </ul>
            <div v-else-if="wordBubble.data.translation" class="wb-trans">{{ wordBubble.data.translation }}</div>
          </template>
        </div>
      </div>
    </div>

    <!-- 分组设置弹框 -->
    <div v-if="showGroupModal" class="modal-mask" @click.self="closeGroupModal" @touchmove.prevent>
      <div class="modal group-modal" @touchmove.stop>
        <div class="modal-head">
          <h3>分组设置</h3>
          <button class="modal-close" @click="closeGroupModal">✕</button>
        </div>
        <div class="group-modal-tip">
          <span :class="{ over: draftAssigned !== groupTotal }">已分配 {{ draftAssigned }} / 总词数 {{ groupTotal }}</span>
          <span v-if="draftAssigned !== groupTotal" class="group-tip-diff">还需 {{ groupTotal - draftAssigned }} 词才能保存</span>
        </div>
        <div class="modal-body group-modal-body" @touchmove.stop>
          <div v-if="!draftGroups.length" class="empty-tip">还没有分组，点击下方「添加一组」开始</div>
          <div v-for="(g, i) in draftGroups" :key="i" class="group-card">
            <div class="g-fields">
              <label class="g-field g-seq">
                <span class="g-label">序号</span>
                <input class="g-input" type="number" min="1" v-model.number="g.seq" />
              </label>
              <label class="g-field g-name">
                <span class="g-label">名称</span>
                <input class="g-input" type="text" v-model="g.name" placeholder="组名" />
              </label>
              <label class="g-field g-size">
                <span class="g-label">数量</span>
                <input class="g-input" type="number" min="0" v-model.number="g.size" />
              </label>
              <button class="g-del" title="删除该组" @click="removeGroupDraft(i)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
            <div class="g-progress">已背熟 {{ g.mastered }} / 组内 {{ g.size }}</div>
          </div>
          <button class="g-add" @click="addGroupDraft">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            添加一组
          </button>
          <p v-if="groupError" class="group-error">{{ groupError }}</p>
        </div>
        <div class="group-modal-foot">
          <button class="btn ghost group-cancel" @click="closeGroupModal">取消</button>
          <button class="btn primary group-save" :disabled="!draftValid" @click="saveGroupsDraft">保存</button>
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

/* 背诵模式切换 + 筛选图标（一行，微信风格） */
.mode-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 16px 10px;
}

.mode-tabs {
  display: flex;
  flex: 1;
  background: #fff;
  border-radius: 10px;
  padding: 3px;
  gap: 3px;
  min-width: 0;
}

.mode-tab {
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

.mode-tab.active {
  background: var(--primary);
  color: #fff;
  font-weight: 500;
}

/* 筛选图标按钮：白底圆角，与模式条同高；有筛选时绿色 */
.filter-icon-btn {
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: #fff;
  border-radius: 10px;
  color: var(--text-sub);
  cursor: pointer;
  transition: all 0.2s;
}

.filter-icon-btn:active {
  background: #f5f5f5;
}

.filter-icon-btn.active {
  color: var(--primary);
  background: rgba(7, 193, 96, 0.1);
}

/* 分组模式：组下拉 + 分组设置按钮 */
.group-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 16px 8px;
}

.group-select {
  flex: 1;
  border: none;
  background: #fff;
  border-radius: 10px;
  padding: 9px 12px;
  font-size: 14px;
  color: var(--text-main);
  appearance: none;
  -webkit-appearance: none;
  outline: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  min-width: 0;
}

.group-empty-hint {
  flex: 1;
  background: #fff;
  border-radius: 10px;
  padding: 9px 12px;
  font-size: 14px;
  color: var(--text-sub);
}

.group-set-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: #fff;
  border-radius: 10px;
  padding: 9px 12px;
  font-size: 13px;
  color: var(--text-main);
  cursor: pointer;
  flex-shrink: 0;
}

.group-set-btn:active {
  background: #f5f5f5;
}

/* 分组设置弹框 */
.group-modal {
  max-width: 480px;
}

.group-modal-tip {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 16px 0;
  font-size: 13px;
  color: var(--text-sub);
}

.group-modal-tip .over {
  color: var(--danger);
}

.group-tip-diff {
  color: var(--danger);
}

.group-modal-body {
  padding: 12px 16px 16px;
}

.group-card {
  background: #f7f7f7;
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 10px;
}

.g-fields {
  display: flex;
  align-items: center;
  gap: 8px;
}

.g-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.g-field.g-seq {
  flex: 0 0 56px;
}

.g-field.g-name {
  flex: 1.4;
}

.g-label {
  font-size: 12px;
  color: var(--text-sub);
}

.g-input {
  border: none;
  background: #fff;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 14px;
  color: var(--text-main);
  outline: none;
  width: 100%;
  box-sizing: border-box;
}

.g-del {
  align-self: flex-end;
  border: none;
  background: #f5f5f5;
  border-radius: 50%;
  width: 28px;
  height: 28px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #888;
  flex-shrink: 0;
}

.g-del:active {
  background: #ebebeb;
}

.g-progress {
  margin-top: 8px;
  font-size: 12px;
  color: var(--primary);
}

.g-add {
  width: 100%;
  border: none;
  background: #fff;
  border-radius: 10px;
  padding: 11px 12px;
  font-size: 14px;
  color: var(--primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.g-add:active {
  background: #f5f5f5;
}

.group-error {
  color: var(--danger);
  font-size: 13px;
  margin-top: 8px;
}

.group-modal-foot {
  display: flex;
  gap: 8px;
  padding: 12px 16px 16px;
  border-top: 0.5px solid #f0f0f0;
}

.group-modal-foot .btn {
  flex: 1;
}

/* 筛选底部面板（微信风格） */
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
  touch-action: pan-y;
}
.sheet-title {
  text-align: center;
  padding: 14px;
  font-size: 16px;
  font-weight: 500;
  background: #fff;
  border-bottom: 1px solid #e5e5e5;
}
.sheet-body {
  background: #fff;
  padding: 0 16px;
  max-height: 60vh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}
.sheet-group {
  padding: 14px 0;
}
.sheet-group-title {
  font-size: 13px;
  color: var(--text-sub);
  margin-bottom: 10px;
}
.sheet-opts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.sheet-opt {
  border: none;
  background: #f2f2f2;
  border-radius: 6px;
  padding: 7px 16px;
  font-size: 14px;
  color: var(--text-main);
  cursor: pointer;
  transition: all 0.2s;
}
.sheet-opt.active {
  background: rgba(7, 193, 96, 0.1);
  color: var(--primary);
  font-weight: 500;
}
.sheet-foot {
  display: flex;
  gap: 10px;
  padding: 12px 16px;
  background: #fff;
  border-top: 1px solid #f0f0f0;
}
.sheet-btn {
  flex: 1;
  border: none;
  border-radius: 8px;
  padding: 11px 0;
  font-size: 15px;
  cursor: pointer;
}
.sheet-btn.primary {
  background: var(--primary);
  color: #fff;
}
.sheet-btn.ghost {
  background: #f2f2f2;
  color: var(--text-main);
}

.sheet-enter-active,
.sheet-leave-active {
  transition: transform 0.25s ease, opacity 0.25s;
}
.sheet-enter-from,
.sheet-leave-to {
  transform: translateY(100%);
}
.sheet-mask.sheet-enter-active,
.sheet-mask.sheet-leave-active {
  transition: opacity 0.25s;
}
.sheet-mask.sheet-enter-from,
.sheet-mask.sheet-leave-to {
  opacity: 0;
}

/* 今日统计 + 待练卡片（一行两组） */
.stats-row {
  display: flex;
  gap: 8px;
  margin: 0 16px 8px;
}

.stats-card {
  flex: 1;
  background: #fff;
  border-radius: 12px;
  padding: 12px 10px 10px;
  min-width: 0;
}

.stats-title {
  font-size: 12px;
  color: var(--text-sub);
  text-align: center;
  margin-bottom: 8px;
}

.today-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  row-gap: 8px;
}

.stat-item {
  text-align: center;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 0;
}

.stat-num {
  display: block;
  font-size: 19px;
  font-weight: 600;
  color: var(--text-main);
}

.stat-num.ok { color: var(--primary); }
.stat-num.bad { color: var(--danger); }

.stat-label {
  display: block;
  font-size: 11px;
  color: var(--text-sub);
  margin-top: 2px;
}

.pending-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: none;
  width: 100%;
  font: inherit;
  cursor: pointer;
  text-align: center;
  -webkit-appearance: none;
  appearance: none;
}

.pending-num {
  font-size: 30px;
  font-weight: 700;
  color: var(--primary);
  text-align: center;
  line-height: 1.2;
}

.pending-desc {
  font-size: 11px;
  color: var(--text-sub);
  text-align: center;
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
  word-break: break-word;
  overflow-wrap: anywhere;
  line-height: 1.35;
}
.quiz-word.long {
  font-size: 24px;
}
.quiz-word.xlong {
  font-size: 19px;
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

.quiz-input input,
.quiz-input textarea {
  width: 100%;
  padding: 12px 16px;
  font-size: 18px;
  text-align: center;
  border: 1px solid #e5e5e5;
  border-radius: 8px;
  outline: none;
  box-sizing: border-box;
}

.quiz-input textarea {
  resize: none;
  line-height: 1.5;
  font-family: inherit;
}

.quiz-input input:focus,
.quiz-input textarea:focus {
  border-color: var(--primary);
}

.quiz-input input:disabled,
.quiz-input textarea:disabled {
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
  touch-action: none;
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
  touch-action: pan-y;
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
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
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

/* "背诵"按钮（跳转背诵该词） */
.study-btn {
  border: none;
  background: #f5f5f5;
  border-radius: 50%;
  width: 28px;
  height: 28px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #888;
  padding: 0;
  flex-shrink: 0;
  margin-left: auto;
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
  touch-action: none;
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
  touch-action: pan-y;
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
  max-width: 100%;
  padding: 0 40px 0 0;
  word-break: break-word;
  line-height: 1.4;
  text-align: left;
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
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
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

.trans-block {
  background: #f7f7f7;
  border-radius: 8px;
  padding: 10px 12px;
}

.trans-src-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.trans-src {
  font-size: 15px;
  color: var(--text-main);
  margin: 0;
  line-height: 1.5;
  word-break: break-word;
}

.trans-dst {
  font-size: 14px;
  color: var(--text-sub);
  margin: 0;
  line-height: 1.5;
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

.sent-item {
  padding: 10px 0;
}
.sent-line {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.sent-en {
  flex: 1;
  font-size: 15px;
  color: var(--text-main);
  line-height: 1.6;
  margin: 0;
  word-break: break-word;
}
.sent-zh {
  font-size: 13px;
  color: var(--text-sub);
  line-height: 1.5;
  margin: 4px 0 0 0;
  word-break: break-word;
}
.sent-en :deep(.sent-hl) {
  color: var(--primary);
  font-weight: 600;
  background: rgba(7, 193, 96, 0.12);
  border-radius: 3px;
  padding: 0 2px;
}
.dict-meaning :deep(.word-link) {
  color: #576b95;
  cursor: pointer;
}
.dict-meaning :deep(.word-link.sent-hl) {
  color: var(--primary);
  font-weight: 600;
  background: rgba(7, 193, 96, 0.12);
  border-radius: 3px;
  padding: 0 2px;
}

/* 单词气泡（微信风格） */
.wb-pop {
  position: fixed;
  z-index: 600;
  max-width: 88vw;
  transition: opacity 0.15s;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  padding: 12px 14px;
  box-sizing: border-box;
}
.wb-arrow {
  position: absolute;
  bottom: -6px;
  left: 50%;
  width: 0;
  height: 0;
  border: 6px solid transparent;
  border-bottom: 0;
  border-top: 6px solid #fff;
}
.wb-arrow.flip {
  bottom: auto;
  top: -6px;
  border-top: 0;
  border-bottom: 6px solid #fff;
}
.wb-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.wb-word {
  font-size: 17px;
  font-weight: 600;
  color: var(--text-main);
  word-break: break-word;
}
.wb-phone {
  font-size: 13px;
  color: var(--text-sub);
  margin-top: 4px;
}
.wb-trs {
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
  font-size: 14px;
  color: var(--text-main);
  line-height: 1.6;
}
.wb-trs li + li {
  margin-top: 2px;
}
.wb-trans {
  margin-top: 6px;
  font-size: 14px;
  color: var(--text-sub);
  line-height: 1.5;
}
.wb-loading,
.wb-error {
  font-size: 14px;
  color: var(--text-sub);
}
.sent-speak {
  flex-shrink: 0;
  border: none;
  background: none;
  padding: 2px;
  color: var(--text-sub);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
</style>
