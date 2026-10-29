<script setup>
import { ref, computed, nextTick, onMounted, onActivated, onBeforeUnmount, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useWords, loadState, weightedPickIndex } from '../composables/useWords'
import { useHistory } from '../composables/useHistory'
import { useWrongBook } from '../composables/useWrongBook'
import { isAnswerMatch, tokensOf, displayTokensOf, stemOf } from '../utils/wordDiff'
import { api } from '../api/index.js'
import AiUsageCard from '../components/AiUsageCard.vue'

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
// 词库变化且当前无题时自动出题（如空词库时先录入了词句再回到背诵页）
watch(
  () => words.value.length,
  () => {
    if (!current.value && available.value.length) next()
  }
)
// 类型筛选：'all' | 'word' | 'phrase' | 'sentence'
const typeFilter = ref('all')
const typeFilterOptions = [
  { value: 'all', label: '全部' },
  { value: 'word', label: '单词' },
  { value: 'phrase', label: '短语' },
  { value: 'sentence', label: '句子' },
]

// ---- 筛选底部面板（出题来源 + 类型 + 关键字） ----
const showFilterSheet = ref(false)
const draftSourceMode = ref('all')
const draftTypeFilter = ref('all')
const keywordFilter = ref('') // 关键字：在中文/英文/备注中过滤
const draftKeywordFilter = ref('')
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
  const k = keywordFilter.value ? `"${keywordFilter.value}"` : ''
  return [s, t, k].filter(Boolean).join(' · ')
})
// 是否启用了非默认筛选（用于按钮绿色高亮）
const hasFilter = computed(
  () => sourceMode.value !== 'all' || typeFilter.value !== 'all' || keywordFilter.value !== ''
)
// 当前生效的筛选条件标签（chips）：仅错题本 / 类型 / 关键字
const activeFilterChips = computed(() => {
  const chips = []
  if (sourceMode.value === 'wrong') chips.push({ key: 'source', label: '仅错题本' })
  if (typeFilter.value !== 'all') {
    const t = typeFilterOptions.find((o) => o.value === typeFilter.value)?.label
    if (t) chips.push({ key: 'type', label: t })
  }
  if (keywordFilter.value) chips.push({ key: 'keyword', label: `关键字：${keywordFilter.value}` })
  return chips
})
// 删除单个筛选条件（微信风格：点标签上的 × 移除）
function removeFilterChip(key) {
  if (key === 'source') sourceMode.value = 'all'
  else if (key === 'type') typeFilter.value = 'all'
  else if (key === 'keyword') keywordFilter.value = ''
  lastIndex.value = -1
  clearAutoTimer()
  next()
}
function openFilterSheet() {
  draftSourceMode.value = sourceMode.value
  draftTypeFilter.value = typeFilter.value
  draftKeywordFilter.value = keywordFilter.value
  showFilterSheet.value = true
}
function closeFilterSheet() {
  showFilterSheet.value = false
}
function resetFilterSheet() {
  draftSourceMode.value = 'all'
  draftTypeFilter.value = 'all'
  draftKeywordFilter.value = ''
  sourceMode.value = 'all'
  typeFilter.value = 'all'
  keywordFilter.value = ''
  showFilterSheet.value = false
  lastIndex.value = -1
  clearAutoTimer()
  next()
}
function applyFilterSheet() {
  sourceMode.value = draftSourceMode.value
  typeFilter.value = draftTypeFilter.value
  keywordFilter.value = draftKeywordFilter.value.trim()
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
const aiChecking = ref(false) // 句子 AI 判定进行中，防重复提交
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
// 出题池：随机模式 = 未背熟单词 ∩ 类型/关键字筛选；分组模式 = 所选组内未背熟 ∩ 类型/关键字筛选；错题本模式 = 错题本中且未背熟 ∩ 类型/关键字筛选（组内错题）
const available = computed(() => {
  const matchType = (w) => typeFilter.value === 'all' || (w.type || 'word') === typeFilter.value
  const matchKeyword = (w) =>
    !keywordFilter.value ||
    [w.english, w.chinese, w.remark || ''].some((f) =>
      String(f || '').toLowerCase().includes(keywordFilter.value.toLowerCase())
    )
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
      .filter((w) => w && !isMastered(w) && matchType(w) && matchKeyword(w) && ids.has(String(w.id)))
  }
  return base.filter((w) => !isMastered(w) && matchType(w) && matchKeyword(w))
})
const allMastered = computed(() => hasWords.value && available.value.length === 0)
// 分组模式：尚未设置任何分组
const groupEmpty = computed(() => practiceMode.value === 'group' && !groups.value.length)
// 筛选条件下无可用词句：筛选生效且出题池为空
const filterEmpty = computed(
  () => (typeFilter.value !== 'all' || keywordFilter.value !== '') && available.value.length === 0
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

// 输入框禁用逻辑：答错禁输；答对且不自动跳才置灰；
// 答对且自动跳时保持可编辑，避免 iOS 上 disabled 失焦导致键盘收起
const inputDisabled = computed(() => {
  if (result.value === 'wrong') return true
  if (result.value === 'correct') return !settings.value.autoNext
  return false
})

// 短语/句子答错时：逐词对比用户输入与正确答案，标记对/错单词（忽略标点/空白）
// 展示保留正确答案原文（含尾部撇号/句号等标点）；标点中性显示（ok=null）不参与对错
const diffResult = computed(() => {
  if (!current.value || result.value !== 'wrong' || current.value.type === 'word') return []
  const cs = !!current.value.caseSensitive
  const right = tokensOf(current.value.english, cs)
  const user = tokensOf(answer.value, cs)
  const words = displayTokensOf(current.value.english)
  let idx = 0
  return words.map((w) => {
    const stem = stemOf(w)
    if (!stem) return { word: w, ok: null } // 标点：中性
    const ok = idx < user.length && user[idx] === right[idx]
    idx++
    return { word: w, ok }
  })
})

// 点击发音/查词按钮时保持输入框焦点（iOS 键盘不收起）：
// @mousedown.prevent 已阻止按钮抢焦点；这里再在手势内把焦点放回输入框
function refocusInput() {
  const el = answerInput.value
  if (el && document.activeElement !== el) {
    try { el.focus() } catch (e) {}
  }
}
function speakKeepFocus(word, type = 0, onDone = null, key = '') {
  speak(word, type, onDone, key)
  refocusInput()
}

function submit() {
  if (!current.value || !answer.value.trim()) return
  if (aiChecking.value) return // AI 判定进行中，防重复提交
  // 重做答对后，再次回车/go：进入下一题作答
  if (isRedo.value && result.value === 'correct') {
    skip()
    return
  }
  if (result.value) return
  // 判定：单词整串比较；短语/句子忽略标点与空白（含中文空格、多空格），仅逐词比较
  const isPhrase = current.value.type !== 'word'
  let isCorrect = isAnswerMatch(answer.value, current.value.english, !!current.value.caseSensitive, isPhrase)
  // 句子且本地判错时：用 AI 复核（处理缩写/全写、标点等差异导致的误判），失败或超时保留本地判定
  if (current.value.type === 'sentence' && !isCorrect) {
    const handle = async () => {
      aiChecking.value = true
      try {
        const r = await api.checkSentence(answer.value, current.value.english)
        if (r && typeof r.correct === 'boolean') isCorrect = r.correct
      } catch (e) {
        // AI 失败：保留本地判定结果
      } finally {
        aiChecking.value = false
      }
      afterCheck(isCorrect)
    }
    handle()
    return
  }
  afterCheck(isCorrect)
}

function afterCheck(isCorrect) {
  if (isRedo.value) {
    // 重做模式：无论对错都不算正式作答，只显示反馈，不更新 count、不移除/加入错题本
    result.value = isCorrect ? 'correct' : 'wrong'
    // 语音播报期间锁定操作按钮（下一题/重做/提交等），播完再解锁
    answeredLock.value = true
    speak(current.value.english, current.value.type || 'word', () => {
      answeredLock.value = false
      focusInput()
    }, 'main')
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
    type: current.value.type || 'word',
    correct: isCorrect,
    userAnswer: answer.value,
  })
  refreshToday()

  clearAutoTimer()
  if (isCorrect) {
    // 答对：标记已作答（用于置灰作答控件），不显示"回答正确"文字提示
    result.value = 'correct'
    // 锁定输入，等正确发音播报完成后按设置决定是否自动切换下一题
    answeredLock.value = true
    speak(answeredWord, current.value.type || 'word', () => {
      answeredLock.value = false
      if (settings.value.autoNext) {
        next()
        focusInput()
      } else {
        focusInput()
      }
    }, 'main')
  } else {
    speak(answeredWord, current.value.type || 'word', null, 'main')
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
let doneTimer = null // 播放兜底定时器：iOS 上网络音频可能不触发 ended

function clearDoneTimer() {
  if (doneTimer) { clearTimeout(doneTimer); doneTimer = null }
}

function fireDone() {
  clearDoneTimer()
  playingKey.value = ''
  if (audioDone) {
    const fn = audioDone
    audioDone = null
    try { fn() } catch (e) {}
  }
}

// 按文本长度估算播放上限时长（秒），防止 ended 不触发时状态卡死
function estimateDuration(text) {
  return Math.max(10, Math.min(60, String(text || '').length * 0.3))
}

// 强制停止当前所有音频（Audio 对象 + 系统语音），防止旧音频残留叠加
function stopAudio() {
  try {
    if (currentAudio) {
      currentAudio.onended = null
      currentAudio.onpause = null
      currentAudio.onerror = null
      currentAudio.pause()
    }
  } catch (e) {}
  currentAudio = null
  try {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
  } catch (e) {}
}

// iOS 流式播放缓冲不足会触发 pause（并非播放结束），尝试自动恢复；真正播完由 ended / doneTimer 兜底复位
function resumeIfPaused() {
  if (!currentAudio || currentAudio.ended) return
  const d = currentAudio.duration
  const notFinished = !Number.isFinite(d) || currentAudio.currentTime < d - 0.5
  if (!notFinished) return
  setTimeout(() => {
    try { currentAudio && currentAudio.play().catch(() => {}) } catch (e) {}
  }, 250)
}

// 词句发音：先完整下载音频（fetch→blob）再本地播放，避免流式播放中途断、以及资源未就绪导致的误兜底二次请求；失败最多重试一次
// type：word/phrase/sentence，后端据此决定兜底（单词/短语→有道，句子→百度）
function playTts(text, onEnded, onFail, type = 'word') {
  // _ 时间戳防缓存：历史上句子响应曾被浏览器缓存（max-age=86400），URL 加随机参数强制绕过浏览器/任何缓存层，保证每次实时生成
  const url = `/api/tts?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(settings.value.sentenceVoice)}&type=${encodeURIComponent(type)}&_=${Date.now()}`
  stopAudio()
  let tries = 0
  const attempt = () => {
    tries++
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error('http ' + r.status)
        return r.blob()
      })
      .then((blob) => {
        if (!blob || blob.size < 500) throw new Error('empty')
        const au = new Audio(URL.createObjectURL(blob))
        currentAudio = au
        au.onended = () => { URL.revokeObjectURL(url); onEnded && onEnded() }
        au.onerror = () => { URL.revokeObjectURL(url); onEnded && onEnded() }
        return au.play()
      })
      .catch((e) => {
        if (e && e.name === 'AbortError') return // 用户/系统主动停止，不重试
        if (tries < 2) setTimeout(attempt, 600)
        else onFail && onFail()
      })
  }
  attempt()
}

function speak(word, type = 'word', onDone = null, key = '') {
  if (!word) return
  // 防卡死：上次音频未正常结束（audioPlaying 残留 true）时，先停掉并消费旧回调，保证本次能正常播放
  if (audioPlaying.value) {
    stopAudio()
    audioPlaying.value = false
    fireDone()
  }
  if (onDone) audioDone = onDone
  const text = String(word).trim()
  // 兼容旧调用（type 传数字 0 时按文本推断）；否则按调用方传入的词句类型
  const wordType = type && typeof type === 'string' ? type : (/\s/.test(text) ? 'phrase' : 'word')
  audioPlaying.value = true
  playingKey.value = key
  stopAudio() // 先停掉任何残留音频，再播新的
  try {
    // 统一走本服务 /api/tts：豆包优先（每次实时调用），单词/短语失败后端回退有道，句子回退百度
    playTts(text, () => { audioPlaying.value = false; fireDone() }, () => speakViaSpeechSynthesis(text), wordType)
  } catch (e) {
    speakViaSpeechSynthesis(text)
  }
}

// 英音/美音发音（详情弹框）：有道 dictvoice type=1 英音、type=2 美音（以有道官方页面为准），失败兜底本服务
function speakAccent(word, accent, key = '') {
  if (!word || audioPlaying.value) return
  const text = String(word).trim()
  audioPlaying.value = true
  playingKey.value = key
  stopAudio()
  const type = accent === 'uk' ? 1 : 2
  const url = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&type=${type}`
  currentAudio = new Audio(url)
  const done = () => { audioPlaying.value = false; if (playingKey.value === key) playingKey.value = '' }
  let fallbacked = false
  const once = () => {
    if (fallbacked) return
    fallbacked = true
    const u2 = `/api/tts?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(settings.value.sentenceVoice)}`
    currentAudio = new Audio(u2)
    currentAudio.onended = done
    currentAudio.onpause = resumeIfPaused
    currentAudio.onerror = done
    currentAudio.play().catch(done)
  }
  currentAudio.onended = done
  currentAudio.onpause = resumeIfPaused
  currentAudio.onerror = once
  currentAudio.play().catch(once)
  // 兜底：iOS 上网络音频可能不触发 ended/pause，按时长上限强制收尾，防止 audioPlaying 残留导致答题卡死
  doneTimer = setTimeout(() => {
    stopAudio()
    if (audioPlaying.value) { audioPlaying.value = false; if (playingKey.value === key) playingKey.value = '' }
  }, estimateDuration(text) * 1000)
}

// 系统 TTS 朗读（保底）
function speakViaSpeechSynthesis(text) {
  if (!('speechSynthesis' in window)) { audioPlaying.value = false; fireDone(); return }
  try {
    stopAudio() // 停掉残留的 Audio 与旧语音，再播新的
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
    doneTimer = setTimeout(() => {
      stopAudio()
      if (audioPlaying.value) { audioPlaying.value = false; fireDone() }
    }, estimateDuration(text) * 1000)
  } catch (e) {
    audioPlaying.value = false
    fireDone()
  }
}

// 例句中高亮当前单词（含常见词形变化）
function escapeHtml(s) {
  // 文本内容场景：不转义引号，避免后端已解码的引号被二次转义成 &quot;
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
// 判断候选词是否为词根 base 的常见词形变化（permit→permitted/permitting、stop→stopped、carry→carries）
function isFlection(word, base) {
  if (word === base) return true
  if (!base || base.length < 2 || word.length <= base.length) return false
  const suf = word.slice(base.length)
  // 必须同时以词根开头才算变形（避免 sheets 对 bring 截出 s 误判）
  if (word.startsWith(base) && ['s', 'es', 'ed', 'ing', 'd', "'s"].includes(suf)) return true
  // 词尾辅音双写 + ed/ing（permit→permitted）
  const last = base.slice(-1)
  if (/[bcdfghjklmnpqrstvwxyz]/.test(last) && word.startsWith(base + last)) {
    const suf2 = word.slice(base.length + 1)
    if (suf2 === 'ed' || suf2 === 'ing') return true
  }
  // 词根以 e 结尾（非 ee）：去 e + ing/ed/es（make→making、use→using）
  if (/[^e]e$/.test(base) && base.length > 2) {
    const stem = base.slice(0, -1)
    if (word === stem + 'ing' || word === stem + 'ed' || word === stem + 'es') return true
  }
  // 辅音+y → ies（carry→carries）
  if (/[bcdfghjklmnpqrstvwxyz]y$/.test(base) && word === base.slice(0, -1) + 'ies') return true
  return false
}
function highlightWord(word, sentence) {
  const esc = escapeHtml(sentence)
  const w = String(word || '').trim().toLowerCase()
  if (!w) return esc
  try {
    // 不用 lookbehind（部分移动端浏览器不支持），前缀用捕获组保留
    const re = /([^a-zA-Z]|^)([A-Za-z]+(?:['’-][A-Za-z]+)*)(?![a-zA-Z])/gi
    return esc.replace(re, (m, prefix, wordPart) => {
      const isHl = isFlection(wordPart.toLowerCase(), w)
      return `${prefix}${isHl ? `<span class="sent-hl">${wordPart}</span>` : wordPart}`
    })
  } catch (e) {
    return esc
  }
}

// 把英文单词拆成可点击的词链接；hlWord 匹配的词额外高亮
function wordify(text, hlWord, extraHl) {
  const esc = escapeHtml(text)
  const w = String(hlWord || '').trim().toLowerCase()
  const extra = new Set((Array.isArray(extraHl) ? extraHl : []).map((x) => String(x).toLowerCase()))
  try {
    return esc.replace(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g, (m) => {
      const low = m.toLowerCase()
      const isHl = w && (isFlection(low, w) || extra.has(low))
      const cls = isHl ? 'word-link sent-hl' : 'word-link'
      return `<span class="${cls}" data-word="${m}">${m}</span>`
    })
  } catch (e) { return esc }
}

// AI 词形补全：本地规则未命中且例句含目标词根时才调 AI 判断变形词（内存缓存，失败静默不高亮）
const flectionCache = new Map()
function fillAiFlections(data, word) {
  if (!data || !Array.isArray(data.sentences) || !data.sentences.length || !word) return
  const w = String(word).trim().toLowerCase()
  for (const s of data.sentences) {
    if (s.aiHlDone || s.aiHl) continue
    s.aiHlDone = true
    const toks = String(s.en || '').match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || []
    // 本地规则已命中 → 不需要 AI
    if (toks.some((m) => isFlection(m.toLowerCase(), w))) continue
    const key = w + '|' + s.en
    const cached = flectionCache.get(key)
    if (cached) { s.aiHl = cached; continue }
    api.matchFlection(w, s.en)
      .then((j) => {
        const matched = Array.isArray(j && j.matched) ? j.matched : []
        flectionCache.set(key, matched)
        s.aiHl = matched
      })
      .catch(() => {})
  }
}

// 正确答案单词点击：弹气泡查询，并保持答题输入框焦点（键盘不收起）
function onAnswerWordClick(e) {
  onDictTextClick(e)
  refocusInput()
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
// 朗读例句（走本服务 /api/tts，豆包发音，完整下载后本地播放）
function speakSentence(sentence, key = '') {
  if (!sentence) return
  audioPlaying.value = true
  playingKey.value = key
  playTts(String(sentence).trim(), () => {
    audioPlaying.value = false
    if (playingKey.value === key) playingKey.value = ''
  }, () => {
    audioPlaying.value = false
    if (playingKey.value === key) playingKey.value = ''
  })
}

// ===== 词典查询弹窗（有道词典接口） =====
const dictModal = ref(null) // { word, data, loading, error }
// 把用户录入的关联词句插到详情弹框：相关短语放 data.phrases（例句区块上方），例句插到有道例句最前
function prependExampleSentences(data, wordText) {
  if (!data) return
  const cur = words.value.find((w) => w.english.trim().toLowerCase() === String(wordText).trim().toLowerCase())
  if (!cur) return
  // 优先取多例句关联；兼容旧的单 exampleId
  let exs = (cur.examples && cur.examples.length) ? cur.examples : []
  if (!exs.length && cur.exampleId) {
    const old = words.value.find((x) => Number(x.id) === Number(cur.exampleId) && x.type === 'sentence')
    if (old) exs = [old]
  }
  if (!exs.length) return
  // 相关短语 → data.phrases（展示在例句上方）
  const phrases = exs.filter((x) => x && x.type === 'phrase' && x.english)
  if (phrases.length) {
    if (!Array.isArray(data.phrases)) data.phrases = []
    for (let i = phrases.length - 1; i >= 0; i--) {
      if (!data.phrases.some((p) => p.en === phrases[i].english)) {
        data.phrases.unshift({ en: phrases[i].english, zh: phrases[i].chinese })
      }
    }
  }
  // 例句 → data.sentences 最前
  const sentences = exs.filter((x) => x && x.type === 'sentence' && x.english) // 只放句子进例句区块，关联的单词/短语不进
  // 手动添加的例句按最后修改时间倒序（越近越靠前）；老数据无 updatedAt 时按关联顺序倒排（最近关联的在前）
  const hasTime = sentences.some((x) => (x.updatedAt || 0) > 0)
  if (hasTime) sentences.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  else sentences.reverse()
  if (sentences.length) {
    if (!Array.isArray(data.sentences)) data.sentences = []
    for (let i = sentences.length - 1; i >= 0; i--) {
      if (!data.sentences.some((s) => s.en === sentences[i].english)) {
        data.sentences.unshift({ en: sentences[i].english, zh: sentences[i].chinese })
      }
    }
  }
}

async function lookupWord(word, type = 'word') {
  if (!word) return
  // 打开详情弹框：收起键盘，避免弹框被键盘遮挡
  const el = answerInput.value
  if (el && document.activeElement === el) {
    try { el.blur() } catch (e) {}
  }
  dictModal.value = { word, type, data: null, loading: true, error: null }
  try {
    const res = await fetch(`/api/dict?word=${encodeURIComponent(word.trim().toLowerCase())}`)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      throw new Error(j.error || '查询失败')
    }
    dictModal.value.data = await res.json()
    prependExampleSentences(dictModal.value.data, word)
    fillAiFlections(dictModal.value.data, word)
    // 备注：本地词句库有则挂到弹框数据（有才显示）
    const local = words.value.find((x) => String(x.english || '').trim().toLowerCase() === String(word).trim().toLowerCase())
    if (local && String(local.remark || '').trim()) dictModal.value.data.remark = String(local.remark).trim()
  } catch (e) {
    dictModal.value.error = e.message || '查询失败，请稍后重试'
  } finally {
    dictModal.value.loading = false
  }
}
function closeDict() {
  dictModal.value = null
  // 关闭查词弹框后：等弹框移除，再聚焦答题输入框，并滚动保证输入框不被键盘遮盖
  nextTick(() => {
    const el = answerInput.value
    if (!el) return
    try { el.focus() } catch (e) {}
    // 等 iOS 键盘弹出动画结束（约 300ms+）后再滚动，避免被二次挤压
    setTimeout(() => {
      try {
        el.focus()
        if (el.setSelectionRange) el.setSelectionRange(el.value.length, el.value.length)
      } catch (e) {}
      // 手动滚动：让元素底边不越过视口下半区，多行文本框也不会被键盘盖住
      const r = el.getBoundingClientRect()
      const vh = window.innerHeight || document.documentElement.clientHeight
      const safeBottom = vh * 0.5
      if (r.top < 0) window.scrollBy(0, r.top - 20)
      else if (r.bottom > safeBottom) window.scrollBy(0, r.bottom - safeBottom)
    }, 400)
  })
}

// 更正当前词句：跳转词句库并自动筛选出当前词句进入编辑态
// 注意参数名用 editWord（不用 word）：PracticeView 有 watch(route.query.word) 会误触发换题
function goEditCurrent() {
  if (!current.value) return
  const el = answerInput.value
  if (el && document.activeElement === el) {
    try { el.blur() } catch (e) {}
  }
  router.push({ path: '/library', query: { editWord: current.value.english } })
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
    type: current.value.type || 'word',
    correct: false,
    userAnswer: '',
  })
  refreshToday()
  speak(current.value.english, current.value.type || 'word', null, 'main')
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
// 分组下拉切换（微信风格底部选择面板）
const showGroupPicker = ref(false)
const selectedGroup = computed(() => groups.value.find((g) => g.id === selectedGroupId.value) || null)
// 类型/关键字过滤后的组统计：组选择器与选择弹层的"已背熟 x/xxx"随当前筛选条件实时变化
const groupStats = computed(() => {
  const matchType = (w) => typeFilter.value === 'all' || (w.type || 'word') === typeFilter.value
  const matchKeyword = (w) =>
    !keywordFilter.value ||
    [w.english, w.chinese, w.remark || ''].some((f) =>
      String(f || '').toLowerCase().includes(keywordFilter.value.toLowerCase())
    )
  // 仅错题本来源：只统计组内错题本中的词句
  const wrongIds =
    sourceMode.value === 'wrong' ? new Set(wrongValid.value.map((w) => String(w.id))) : null
  return groups.value.map((g) => {
    let list = words.value.filter(
      (w) => String(w.groupId || '') === String(g.id) && matchType(w) && matchKeyword(w)
    )
    if (wrongIds) list = list.filter((w) => wrongIds.has(String(w.id)))
    return { ...g, size: list.length, mastered: list.filter((w) => isMastered(w)).length }
  })
})
const selectedGroupStats = computed(
  () => groupStats.value.find((g) => g.id === selectedGroupId.value) || null
)
function pickGroup(g) {
  showGroupPicker.value = false
  if (!g || g.id === selectedGroupId.value) return
  selectedGroupId.value = g.id
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

// 重新分配：保持各组数量不变，把词库词句打散随机重新分到各组（立即生效）
async function reshuffleGroups() {
  try {
    const r = await api.reshuffleGroups()
    groups.value = r.groups || []
    draftGroups.value = (r.groups || []).map((g) => ({ id: g.id, name: g.name, seq: g.seq, size: g.size, mastered: g.mastered }))
    groupError.value = ''
    // 刷新 words 的 groupId，出题池与组进度同步
    try {
      const st = await api.getState()
      if (st && Array.isArray(st.words)) loadState(st)
    } catch (e) {}
    lastIndex.value = -1
    clearAutoTimer()
    next()
  } catch (e) {
    groupError.value = e.message || '重新分配失败'
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
  // Ctrl+A：恢复浏览器默认的全选行为（不拦截）
  // Ctrl+Shift+A：显示答案（与 Ctrl+A 全选区分，Answer 首字母）
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === 'a') {
    e.preventDefault()
    revealAnswer()
    return
  }
  // Ctrl+Q：查询当前单词详情（阻止浏览器默认行为）
  if ((e.ctrlKey || e.metaKey) && key === 'q') {
    e.preventDefault()
    if (current.value) lookupWord(current.value.english, current.value.type || 'word')
    return
  }
  // Ctrl+P（Mac 为 Cmd+P）：朗读当前单词，阻止浏览器打印对话框；带 key 触发主发音按钮波浪动画，焦点留在输入框
  if ((e.ctrlKey || e.metaKey) && key === 'p') {
    e.preventDefault()
    if (current.value) speakKeepFocus(current.value.english, 0, null, 'main')
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
  // Ctrl+Enter：等同于普通输入框的提交效果（提交当前答案）
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    submit()
    return
  }
  if (e.key !== 'Enter') return
  // 回车跳下一题：答错、重做答对、或答对且关闭了自动下一题（此时停留在本题，回车等价于点「下一题」）
  const canSkip = result.value === 'wrong' || (result.value === 'correct' && (isRedo.value || !settings.value.autoNext))
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

onActivated(() => {
  // KeepAlive 切回：静默刷新分组与今日统计（不打断当前题目，保留答题现场）
  loadGroups()
  refreshToday()
  // 从词句库更正返回：若当前词句已被修改，同步最新内容并清空作答重新答
  if (current.value) {
    const fresh = words.value.find((w) => Number(w.id) === Number(current.value.id))
    if (fresh && (fresh.english !== current.value.english || fresh.chinese !== current.value.chinese || fresh.type !== current.value.type || fresh.pos !== current.value.pos)) {
      current.value = fresh
      answer.value = ''
      result.value = null
      revealed.value = false
      isRedo.value = false
    }
  }
  // 当前无题且出题池有词时自动出题（覆盖：空词库进入背诵页→去录入→切回的场景）
  if (!current.value && available.value.length) next()
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
            <span class="stat-label">已背词句</span>
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

    <!-- 当前筛选条件标签（微信风格，可单独删除） -->
    <div v-if="activeFilterChips.length" class="filter-chips">
      <span v-for="chip in activeFilterChips" :key="chip.key" class="filter-chip">
        {{ chip.label }}
        <button class="chip-del" title="移除该筛选" @click="removeFilterChip(chip.key)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </span>
    </div>

    <!-- 分组模式：组下拉选框 + 分组设置 -->
    <div v-if="practiceMode === 'group'" class="group-row">
      <button v-if="groups.length" class="group-select" @click="showGroupPicker = true">
        <span class="group-select-name">{{ selectedGroup?.name }}</span>
        <span class="group-select-progress">已背熟 {{ selectedGroupStats?.mastered }}/{{ selectedGroupStats?.size }}</span>
        <svg class="group-select-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
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
      <p class="empty-desc">先去录入一些词句，再来这里练习吧</p>
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
              <div class="sheet-group">
                <div class="sheet-group-title">关键字</div>
                <input
                  v-model="draftKeywordFilter"
                  class="sheet-keyword-input"
                  type="text"
                  placeholder="按备注 / 中文 / 英文过滤"
                  maxlength="50"
                  @keydown.enter="applyFilterSheet"
                />
              </div>
            </div>
            <div class="sheet-foot">
              <button class="sheet-btn ghost" @click="resetFilterSheet">重置</button>
              <button class="sheet-btn primary" @click="applyFilterSheet">确定</button>
            </div>
          </div>
        </div>
      </transition>

      <!-- 答题区（current 为空时不渲染，避免空指针崩溃） -->
      <div v-if="current" class="quiz-card">
        <button class="quiz-edit-btn" title="更正当前词句" @click="goEditCurrent">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <p class="quiz-label">中文</p>
        <p class="quiz-word" :class="quizWordClass">{{ current.chinese }}</p>
        <p v-if="current.type && current.type !== 'word'" class="quiz-type">{{ current.type === 'phrase' ? '短语' : '句子' }}</p>
        <p v-if="current.pos" class="quiz-pos">{{ current.pos }}</p>

        <div class="quiz-sound">
          <button class="sound-btn" :class="{ 'is-playing': playingKey === 'main' }" @mousedown.prevent @click="speakKeepFocus(current.english, 0, null, 'main')"><span class="spk-static">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg></span><span class="spk-eq"><i></i><i></i><i></i></span>
            发音
          </button>
          <button class="sound-btn" @click="lookupWord(current.english, current.type || 'word')">
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
          <!-- 单词/短语：单行输入框；句子：多行文本框 -->
          <input
            v-if="current.type !== 'sentence'"
            ref="answerInput"
            v-model="answer"
            type="text"
            lang="en"
            inputmode="text"
            enterkeyhint="go"
            autocorrect="off"
            placeholder="输入英文"
            :disabled="inputDisabled"
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
            :disabled="inputDisabled"
            @focus="focusEnabled = true"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
          ></textarea>
        </div>

        <!-- 判定反馈（答对不显示任何提示块；答错仅显示错误信息，无重听按钮） -->
        <div v-if="result === 'wrong'" class="feedback wrong">
          <span class="fb-text">{{ revealed ? '已显示答案' : '回答错误' }}</span>
          <template v-if="current.type === 'word'">
            <strong class="correct-word">{{ current.english }}</strong>
          </template>
          <template v-else>
            <span class="correct-word diff" @click="onAnswerWordClick">
              <span
                v-for="(w, i) in diffResult"
                :key="i"
                :class="w.ok === null ? '' : 'word-link ' + (w.ok ? 'diff-ok' : 'diff-bad')"
                :data-word="w.ok === null ? undefined : stemOf(w.word)"
              >{{ w.word }}</span>
            </span>
          </template>
        </div>

        <div class="quiz-actions">
          <template v-if="!result">
            <button class="btn ghost" :disabled="answeredLock" @mousedown.prevent @click="skip">换一题</button>
            <button class="btn ghost" :disabled="answeredLock" @click="revealAnswer">显示答案</button>
            <button class="btn primary" :disabled="!answer.trim() || answeredLock" @mousedown.prevent @click="submit">提交</button>
          </template>
          <template v-else-if="result === 'correct'">
            <!-- 答对：作答控件置灰，仅"下一题"可点（不自动跳时停留当前题） -->
            <button class="btn ghost" disabled>提交</button>
            <button class="btn ghost" disabled>显示答案</button>
            <button class="btn primary" :disabled="answeredLock" @mousedown.prevent @click="skip">下一题</button>
          </template>
          <template v-else>
            <button class="btn primary" :disabled="answeredLock" @click="redo">重做这一题</button>
            <button class="btn ghost" :disabled="answeredLock" @click="skip">下一题</button>
          </template>
        </div>
      </div>
      <div v-else class="quiz-loading">正在准备题目…</div>
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
          <AiUsageCard v-if="dictModal" :word="dictModal.word" :type="dictModal.type || 'word'" />
          <!-- 备注：短语/句子放在 AI 日常用法下方（有才显示） -->
          <div v-if="dictModal.data && dictModal.data.remark && dictModal.type !== 'word'" class="dict-meaning">
            <p class="dict-label">备注</p>
            <p class="remark-text">{{ dictModal.data.remark }}</p>
          </div>
          <div v-if="dictModal.type === 'phrase'" class="dict-speak-row">
            <button class="dict-speak-btn" :class="{ 'is-playing': playingKey === 'dict-main' }" @click="speak(dictModal.word, dictModal.type || 'word', null, 'dict-main')" title="朗读"><span class="spk-static">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg></span><span class="spk-eq"><i></i><i></i><i></i></span><span class="dict-speak-text">朗读</span>
            </button>
          </div>
          <div v-if="dictModal.loading" class="dict-loading">查询中…</div>
          <div v-else-if="dictModal.error" class="dict-error">{{ dictModal.error }}</div>
          <div v-else-if="dictModal.data">
            <div v-if="dictModal.data.translation" class="dict-meaning">
              <p class="dict-label">整句翻译</p>
              <div class="trans-block" @click="onDictTextClick">
                <div class="trans-src-row">
                  <p class="trans-src" v-html="wordify(dictModal.word, '')"></p>
                  <button class="speak-mini" :class="{ 'is-playing': playingKey === 'read' }" @click="speak(dictModal.word, dictModal.type || 'word', null, 'read')" title="朗读"><span class="spk-static">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg></span><span class="spk-eq"><i></i><i></i><i></i></span>
                  </button>
                </div>
                <p class="trans-dst">{{ dictModal.data.translation }}</p>
              </div>
            </div>
            <div v-if="dictModal.data.usphone || dictModal.data.ukphone" class="dict-phonetic">
              <span v-if="dictModal.data.ukphone" class="phonetic-item">
                英 [{{ dictModal.data.ukphone }}]
                <button class="speak-mini" :class="{ 'is-playing': playingKey === 'uk' }" @click="speakAccent(dictModal.word, 'uk', 'uk')" title="英式发音"><span class="spk-static">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg></span><span class="spk-eq"><i></i><i></i><i></i></span>
                </button>
              </span>
              <span v-if="dictModal.data.usphone" class="phonetic-item">
                美 [{{ dictModal.data.usphone }}]
                <button class="speak-mini" :class="{ 'is-playing': playingKey === 'us' }" @click="speakAccent(dictModal.word, 'us', 'us')" title="美式发音"><span class="spk-static">
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
            <div v-if="dictModal.data.phrases && dictModal.data.phrases.length" class="dict-meaning" @click="onDictTextClick">
              <p class="dict-label">相关短语</p>
              <ul class="sent-list">
                <li v-for="(s, i) in dictModal.data.phrases" :key="'ph' + i" class="sent-item">
                  <div class="sent-line">
                    <p class="sent-en" v-html="wordify(s.en, dictModal.word, s.aiHl)"></p>
                    <button class="sent-speak" :class="{ 'is-playing': playingKey === 'ph' + i }" @click="speakSentence(s.en, 'ph' + i)" title="朗读短语"><span class="spk-static">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg></span><span class="spk-eq"><i></i><i></i><i></i></span>
                    </button>
                  </div>
                  <p v-if="s.zh" class="sent-zh">{{ s.zh }}</p>
                </li>
              </ul>
            </div>
            <!-- 备注：单词放在例句上方（有才显示） -->
            <div v-if="dictModal.data.remark && dictModal.type === 'word'" class="dict-meaning">
              <p class="dict-label">备注</p>
              <p class="remark-text">{{ dictModal.data.remark }}</p>
            </div>
            <div v-if="dictModal.data.sentences && dictModal.data.sentences.length" class="dict-meaning" @click="onDictTextClick">
              <p class="dict-label">例句</p>
              <ul class="sent-list">
                <li v-for="(s, i) in dictModal.data.sentences" :key="i" class="sent-item">
                  <div class="sent-line">
                    <p class="sent-en" v-html="wordify(s.en, dictModal.word, s.aiHl)"></p>
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

      </div>
    </div>

        <!-- 单词气泡 -->
        <div v-if="wordBubble" ref="wbEl" class="wb-pop" :style="{ top: wordBubble.top + 'px', left: wordBubble.left + 'px', width: wordBubble.width + 'px', opacity: wordBubble.ready ? 1 : 0 }" @click.stop>
          <div class="wb-arrow" :class="{ flip: wordBubble.flip }" :style="{ left: wordBubble.arrowLeft + 'px' }"></div>
          <div v-if="wordBubble.loading" class="wb-loading">查询中…</div>
          <div v-else-if="wordBubble.error" class="wb-error">{{ wordBubble.error }}</div>
          <template v-else-if="wordBubble.data">
            <div class="wb-head">
              <span class="wb-word">{{ wordBubble.word }}</span>
              <button class="speak-mini" :class="{ 'is-playing': playingKey === 'bubble' }" @click="speak(wordBubble.word, 'word', null, 'bubble')" title="朗读"><span class="spk-static">
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

    <!-- 选择分组（微信风格底部弹层） -->
    <div v-if="showGroupPicker" class="picker-mask" @click.self="showGroupPicker = false" @touchmove.prevent>
      <div class="picker-sheet" @touchmove.stop>
        <div class="picker-head">选择分组</div>
        <div class="picker-list">
          <button v-for="g in groupStats" :key="g.id" class="picker-item" @click="pickGroup(g)">
            <span class="picker-name">{{ g.name }}</span>
            <span class="picker-progress">已背熟 {{ g.mastered }}/{{ g.size }}</span>
            <svg v-if="g.id === selectedGroupId" class="picker-check" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </button>
        </div>
        <button class="picker-cancel" @click="showGroupPicker = false">取消</button>
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
            <div class="g-inputs">
              <div class="g-cell">
                <span class="g-cell-label">序号</span>
                <input class="g-cell-input" type="number" min="1" v-model.number="g.seq" />
              </div>
              <div class="g-cell g-cell-name">
                <span class="g-cell-label">名称</span>
                <input class="g-cell-input" type="text" v-model="g.name" placeholder="组名" />
              </div>
              <div class="g-cell">
                <span class="g-cell-label">数量</span>
                <input class="g-cell-input" type="number" min="0" v-model.number="g.size" />
              </div>
              <button class="g-del" title="删除该组" @click="removeGroupDraft(i)">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
            <div class="g-progress">已背熟 {{ g.mastered }}</div>
          </div>
          <button class="g-add" @click="addGroupDraft">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            添加一组
          </button>
          <button v-if="draftGroups.length" class="g-reshuffle" @click="reshuffleGroups">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="4" x2="21" y2="21"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
            重新分配
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

/* 筛选条件标签（微信风格：浅灰底小圆角 chip，可单独删除） */
.filter-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: -4px 16px 10px;
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: #f2f2f2;
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 12px;
  color: var(--text-sub);
}

.chip-del {
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  padding: 0;
  color: #b0b0b0;
  cursor: pointer;
}

.chip-del:active {
  color: #888;
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
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  text-align: left;
}

.group-select-name {
  font-size: 15px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 40%;
}

.group-select-progress {
  flex: 1;
  text-align: right;
  font-size: 13px;
  color: #999;
  white-space: nowrap;
}

.group-select-arrow {
  flex: none;
  color: #999;
}

/* 选择分组：微信风格底部弹层 */
.picker-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 700;
  display: flex;
  align-items: flex-end;
}

.picker-sheet {
  width: 100%;
  background: #ededed;
  border-radius: 12px 12px 0 0;
  overflow: hidden;
  padding-bottom: env(safe-area-inset-bottom);
  animation: pickerUp 0.2s ease-out;
}

@keyframes pickerUp {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}

.picker-head {
  background: #fff;
  text-align: center;
  padding: 13px 16px;
  font-size: 13px;
  color: #999;
}

.picker-list {
  background: #fff;
}

.picker-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px;
  border: none;
  background: #fff;
  border-bottom: 0.5px solid #f0f0f0;
  cursor: pointer;
  text-align: left;
}

.picker-item:last-child {
  border-bottom: none;
}

.picker-item:active {
  background: #f5f5f5;
}

.picker-name {
  font-size: 16px;
  color: var(--text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 50%;
}

.picker-progress {
  flex: 1;
  text-align: right;
  font-size: 13px;
  color: #999;
  white-space: nowrap;
}

.picker-check {
  color: var(--primary);
  flex: none;
}

.picker-cancel {
  width: calc(100% - 16px);
  margin: 8px;
  padding: 13px;
  font-size: 16px;
  color: var(--text-main);
  background: #fff;
  border: none;
  border-radius: 12px;
  cursor: pointer;
}

.picker-cancel:active {
  background: #f5f5f5;
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
  background: #f7f7f7;
  border-radius: 0 0 12px 12px;
}

.group-card {
  background: #fff;
  border-radius: 12px;
  padding: 12px 12px 8px;
  margin-bottom: 14px;
  border: 0.5px solid #e5e5e5;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

/* 输入行：三个轻量字段 + 删除一行 */
.g-inputs {
  display: flex;
  align-items: center;
  gap: 10px;
}

.g-cell {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  background: #f5f5f5;
  border-radius: 8px;
  padding: 7px 10px;
}

.g-cell-name {
  flex: 1.6;
}

.g-cell-label {
  font-size: 12px;
  color: #999;
  flex: none;
}

.g-cell-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 14px;
  color: var(--text-main);
  padding: 0;
  text-align: left;
}

.g-del {
  border: none;
  background: none;
  padding: 6px;
  cursor: pointer;
  color: #999;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.g-del:active {
  color: #666;
}

.g-progress {
  margin-top: 8px;
  font-size: 13px;
  color: #999;
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

/* 重新分配（微信风格次要操作） */
.g-reshuffle {
  width: 100%;
  border: none;
  background: #fff;
  border-radius: 10px;
  padding: 11px 12px;
  margin-top: 10px;
  font-size: 14px;
  color: #576b95;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.g-reshuffle:active {
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
  background: #fff;
  border-top: 0.5px solid #f0f0f0;
  border-radius: 0 0 12px 12px;
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
  cursor: pointer;  transition: all 0.2s;
}
.sheet-opt.active {
  background: rgba(7, 193, 96, 0.1);
  color: var(--primary);
  font-weight: 500;
}
.sheet-keyword-input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #e5e5e5;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 14px;
  color: var(--text-main);
  background: #fff;
  outline: none;
  transition: border-color 0.2s;
}
.sheet-keyword-input:focus {
  border-color: var(--primary);
}
.sheet-keyword-input::placeholder {
  color: #b2b2b2;
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
.quiz-loading {
  padding: 40px 0;
  text-align: center;
  color: #999;
  font-size: 14px;
}
.quiz-card {
  position: relative;
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

/* 更正当前词句：铅笔图标绝对定位在卡片右上角（不占文档流，不影响"中文"居中） */
.quiz-edit-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-sub);
  border-radius: 50%;
  cursor: pointer;
}
.quiz-edit-btn:active {
  background: rgba(0, 0, 0, 0.06);
}

/* 短语/句子类型小标签（与词句库列表一致，位于词性位置） */
.quiz-type {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 4px;
  background: rgba(7, 193, 96, 0.1);
  color: var(--primary);
  font-size: 12px;
  margin: 0 0 16px;
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

/* 短语/句子逐词对比：答对词绿色，答错词红色 */
.correct-word.diff {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px 6px;
}
.diff-ok {
  color: var(--success);
}
.diff-bad {
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

/* 详情弹框：短语独立发音行（微信风格胶囊按钮），左右对齐内容区，下留白避免挤压释义 */
.dict-speak-row {
  padding: 12px 0;
}
.dict-speak-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #f2f2f2;
  border: none;
  border-radius: 16px;
  padding: 6px 14px;
  color: #576b95;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}
.dict-speak-text {
  color: #576b95;
  font-size: 13px;
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
  flex-wrap: wrap;
  align-items: center;
  column-gap: 16px;
  row-gap: 6px;
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

.remark-text {
  background: #f7f7f7;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 14px;
  line-height: 1.6;
  color: #333;
  word-break: break-all;
  white-space: pre-wrap;
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
.correct-word.diff .word-link {
  cursor: pointer;
  border-bottom: 1px dashed rgba(87, 107, 149, 0.55);
  padding: 0 1px;
}
.correct-word.diff .word-link.diff-ok {
  border-bottom-color: rgba(7, 193, 96, 0.45);
}
.correct-word.diff .word-link.diff-bad {
  border-bottom-color: rgba(250, 81, 81, 0.45);
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
  gap: 6px;
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
