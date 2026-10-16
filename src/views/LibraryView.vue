<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useWords } from '../composables/useWords'
import AiUsageCard from '../components/AiUsageCard.vue'

const router = useRouter()

// 跳转背诵页并直接背诵该词
function goPractice(word) {
  if (!word) return
  router.push({ path: '/practice', query: { word } })
}
const { words, updateWord, removeWord, checkDuplicate, resetCount, isMastered, settings } =
  useWords()

const editingId = ref(null)
const editForm = reactive({ chinese: '', english: '', pos: '', type: 'word', caseSensitive: false })
const typeOptions = [
  { value: 'word', label: '单词' },
  { value: 'phrase', label: '短语' },
  { value: 'sentence', label: '句子' },
]
const confirmDeleteId = ref(null)
const confirmResetId = ref(null)
const tip = ref(null) // { text, kind: 'ok' | 'warn' | 'err' }
let tipTimer = null

// ===== 词典查询弹窗 =====
const dictModal = ref(null)
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
  closeWordBubble()
}

// Esc 关闭查词弹框 / 单词气泡
function onKeydown(e) {
  if (e.key === 'Escape') {
    if (dictModal.value) closeDict()
    else if (wordBubble.value) closeWordBubble()
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', closeWordBubble)
  document.removeEventListener('keydown', onKeydown)
})

// 播放发音：有道优先，失败回退百度 TTS，再失败回退系统 TTS
let currentAudio = null
const audioPlaying = ref(false)
const playingKey = ref('') // 当前正在播放的按钮标识
function speak(word, type = 0, onDone = null, key = '') {
  if (!word || audioPlaying.value) return
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
    currentAudio.onended = () => { audioPlaying.value = false; playingKey.value = '' }
    currentAudio.onpause = () => { audioPlaying.value = false; playingKey.value = '' }
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
    currentAudio.onended = () => { audioPlaying.value = false; playingKey.value = '' }
    currentAudio.onpause = () => { audioPlaying.value = false; playingKey.value = '' }
    currentAudio.onerror = once
    currentAudio.play().catch(once)
  } catch (e) {
    speakViaSpeechSynthesis(text)
  }
}

// 系统 TTS 朗读（保底）
function speakViaSpeechSynthesis(text) {
  if (!('speechSynthesis' in window)) { audioPlaying.value = false; return }
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
    u.onend = () => { audioPlaying.value = false; playingKey.value = '' }
    u.onerror = () => { audioPlaying.value = false; playingKey.value = '' }
    window.speechSynthesis.speak(u)
  } catch (e) {
    audioPlaying.value = false
    playingKey.value = ''
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

const threshold = computed(() => settings.value.masteryThreshold)
const masteredCount = computed(() => words.value.filter((w) => isMastered(w)).length)

// 词库统计：全部 / 单词 / 短语 / 句子（基于全量，不受搜索与筛选影响）
const typeStats = computed(() => {
  const all = words.value.length
  const word = words.value.filter((w) => (w.type || 'word') === 'word').length
  const phrase = words.value.filter((w) => w.type === 'phrase').length
  const sentence = words.value.filter((w) => w.type === 'sentence').length
  return { all, word, phrase, sentence }
})

// ---- 排序：支持「背诵进度」与「录入时间」两列（三态：降序 → 升序 → 取消） ----
const sortField = ref(null) // null | 'count' | 'createdAt'
const sortDir = ref('desc') // 'asc' | 'desc'

function toggleSort(field) {
  if (sortField.value !== field) {
    sortField.value = field
    sortDir.value = 'desc'
  } else if (sortDir.value === 'desc') {
    sortDir.value = 'asc'
  } else {
    sortField.value = null // 取消排序，回到默认（录入时间倒序）
  }
}

// 表头标题 → 排序字段
function sortKey(header) {
  if (header === '背诵进度') return 'count'
  if (header === '录入时间') return 'createdAt'
  return null
}

// 排序箭头指示：未排序 ⇅ / 降序 ↓ / 升序 ↑
function sortArrow(field) {
  if (sortField.value !== field) return '⇅'
  return sortDir.value === 'desc' ? '↓' : '↑'
}

const sortedWords = computed(() => {
  const list = [...words.value]
  if (sortField.value === 'count') {
    list.sort((a, b) => (a.count || 0) - (b.count || 0))
    if (sortDir.value === 'desc') list.reverse()
  } else if (sortField.value === 'createdAt') {
    list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    if (sortDir.value === 'desc') list.reverse()
  } else {
    // 默认：录入时间倒序（最新录入在前）
    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  }
  return list
})

const totalCount = computed(() => words.value.length)

// ---- 筛选：关键字 + 类型 + 背熟状态（可组合） ----
const keyword = ref('')
const statusFilter = ref('all') // 'all' | 'mastered' | 'notMastered'
const typeFilter = ref('all') // 'all' | 'word' | 'phrase' | 'sentence'

const filteredWords = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return sortedWords.value.filter((w) => {
    const matchKw =
      !kw ||
      w.chinese.toLowerCase().includes(kw) ||
      w.english.toLowerCase().includes(kw)
    const type = w.type || 'word'
    const matchType =
      typeFilter.value === 'all' || type === typeFilter.value
    const mastered = isMastered(w)
    const matchStatus =
      statusFilter.value === 'all' ||
      (statusFilter.value === 'mastered' && mastered) ||
      (statusFilter.value === 'notMastered' && !mastered)
    return matchKw && matchType && matchStatus
  })
})

const noMatch = computed(() => totalCount.value > 0 && filteredWords.value.length === 0)

// ---- 分页 ----
const pageSize = ref(20)
const currentPage = ref(1)

const pageCount = computed(() =>
  Math.max(1, Math.ceil(filteredWords.value.length / pageSize.value))
)

const pagedWords = computed(() => {
  // 删除/筛选导致当前页超出范围时自动回退到最后一页
  if (currentPage.value > pageCount.value) currentPage.value = pageCount.value
  const start = (currentPage.value - 1) * pageSize.value
  return filteredWords.value.slice(start, start + pageSize.value)
})

// 页码窗口：首页/末页 + 当前页附近，间隔用省略号
const pageNumbers = computed(() => {
  const pages = pageCount.value
  const cur = currentPage.value
  const set = new Set([1, pages, cur - 1, cur, cur + 1])
  const list = [...set].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b)
  const out = []
  let prev = 0
  for (const p of list) {
    if (prev && p - prev > 1) out.push('…')
    out.push(p)
    prev = p
  }
  return out
})

// 筛选/排序条件变化时回到第 1 页
watch([keyword, statusFilter, typeFilter, sortField, sortDir], () => {
  currentPage.value = 1
})

function changePageSize(v) {
  pageSize.value = Number(v)
  currentPage.value = 1
}

const filterOptions = [
  { value: 'all', label: '全部' },
  { value: 'mastered', label: '已背熟' },
  { value: 'notMastered', label: '未背熟' },
]

const typeFilterOptions = [
  { value: 'all', label: '全部' },
  { value: 'word', label: '单词' },
  { value: 'phrase', label: '短语' },
  { value: 'sentence', label: '句子' },
]

// ---- 筛选底部面板 ----
const showFilterSheet = ref(false)
const draftTypeFilter = ref('all')
const draftStatusFilter = ref('all')

// 按钮上显示当前生效的筛选摘要
const filterSummary = computed(() => {
  if (typeFilter.value !== 'all') {
    return typeFilterOptions.find((o) => o.value === typeFilter.value)?.label || ''
  }
  if (statusFilter.value !== 'all') {
    return filterOptions.find((o) => o.value === statusFilter.value)?.label || ''
  }
  return ''
})

function openFilterSheet() {
  draftTypeFilter.value = typeFilter.value
  draftStatusFilter.value = statusFilter.value
  showFilterSheet.value = true
}

function closeFilterSheet() {
  showFilterSheet.value = false
}

function resetFilterSheet() {
  draftTypeFilter.value = 'all'
  draftStatusFilter.value = 'all'
  typeFilter.value = 'all'
  statusFilter.value = 'all'
  showFilterSheet.value = false
}

function applyFilterSheet() {
  typeFilter.value = draftTypeFilter.value
  statusFilter.value = draftStatusFilter.value
  showFilterSheet.value = false
}

function resetFilters() {
  keyword.value = ''
  statusFilter.value = 'all'
  typeFilter.value = 'all'
}

// ---- 列宽拖拽（colgroup + col 方案，表头与单元格自动对齐） ----
const COLW_KEY = 'vocab-colwidths'
const headerList = ['#', '中文', '英文', '词性', '背诵进度', '录入时间', '操作']
// 各列最小宽度：序号/进度/操作列给足空间，避免拖拽挤压内容
const MIN_WIDTHS = { 0: 44, 4: 120, 6: 140 }

function loadColWidths() {
  try {
    const raw = localStorage.getItem(COLW_KEY)
    const data = raw ? JSON.parse(raw) : {}
    return data && typeof data === 'object' ? data : {}
  } catch (e) {
    return {}
  }
}

const colWidths = ref(loadColWidths())
const dragging = ref(false)
let dragIndex = -1
let dragStartX = 0
let dragStartWidth = 0

function startResize(e, i) {
  dragIndex = i
  dragStartX = e.clientX
  // 以表头当前实际渲染宽度为基准（兼容自动宽度/已设置宽度）
  const th = e.target.closest('th')
  dragStartWidth = th ? th.offsetWidth : colWidths.value[i] || 80
  dragging.value = true
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
}

function onDragMove(e) {
  if (!dragging.value) return
  const dx = e.clientX - dragStartX
  const minW = MIN_WIDTHS[dragIndex] || 60
  const w = Math.max(minW, dragStartWidth + dx)
  colWidths.value[dragIndex] = Math.round(w)
}

function onDragEnd() {
  dragging.value = false
  dragIndex = -1
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
  // 松手后持久化列宽
  try {
    localStorage.setItem(COLW_KEY, JSON.stringify(colWidths.value))
  } catch (e) {
    // 持久化失败静默处理
  }
}

function showTip(text, kind = 'ok') {
  tip.value = { text, kind }
  clearTimeout(tipTimer)
  tipTimer = setTimeout(() => (tip.value = ''), 2800)
}

// 背诵进度百分比（0~100）
function pct(word) {
  const t = threshold.value || 1
  return Math.min(100, Math.round(((word.count || 0) / t) * 100))
}

function startEdit(word) {
  editingId.value = word.id
  confirmDeleteId.value = null
  confirmResetId.value = null
  editForm.chinese = word.chinese
  editForm.english = word.english
  editForm.pos = word.pos || ''
  editForm.type = ['word', 'phrase', 'sentence'].includes(word.type) ? word.type : 'word'
  editForm.caseSensitive = !!word.caseSensitive
}

function cancelEdit() {
  editingId.value = null
}

function saveEdit(word) {
  if (!editForm.chinese.trim() || !editForm.english.trim()) {
    showTip('中文和英文不能为空', 'warn')
    return
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9\s.,!?;:'"()\-’'']*$/.test(editForm.english.trim())) {
    showTip('英文只允许字母、数字、空格和常见标点', 'warn')
    return
  }
  // 重复校验：排除当前编辑的单词自身，避免把自己的旧值误判为重复
  const dup = checkDuplicate({
    chinese: editForm.chinese,
    english: editForm.english,
    excludeId: word.id,
  })
  const parts = []
  if (dup.duplicateChinese) parts.push(`中文「${editForm.chinese.trim()}」`)
  if (dup.duplicateEnglish) parts.push(`英文「${editForm.english.trim()}」`)
  if (parts.length) {
    showTip(`⛔ ${parts.join(' 与 ')}与词句库中其他词句重复，保存失败`, 'err')
    return
  }
  const ok = updateWord(word.id, {
    chinese: editForm.chinese.trim(),
    english: editForm.english.trim(),
    pos: editForm.type === 'word' ? editForm.pos.trim() : '',
    type: editForm.type,
    caseSensitive: editForm.type === 'word' ? editForm.caseSensitive : false,
  })
  if (ok) {
    showTip(`已保存修改：${editForm.english}`, 'ok')
    editingId.value = null
  }
}

function askDelete(word) {
  confirmDeleteId.value = word.id
  confirmResetId.value = null
  editingId.value = null
}

function cancelDelete() {
  confirmDeleteId.value = null
}

function doDelete(word) {
  const ok = removeWord(word.id)
  if (ok) {
    showTip(`已删除：${word.english}`, 'ok')
  }
  confirmDeleteId.value = null
}

function askReset(word) {
  confirmResetId.value = word.id
  confirmDeleteId.value = null
  editingId.value = null
}

function cancelReset() {
  confirmResetId.value = null
}

function doReset(word) {
  const ok = resetCount(word.id)
  if (ok) {
    showTip(`已将「${word.english}」背诵次数重置为 0`, 'ok')
  }
  confirmResetId.value = null
}

function formatTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
</script>

<template>
  <div class="library-page">

    <transition name="fade">
      <p v-if="tip" class="tip" :class="tip.kind">{{ tip.text }}</p>
    </transition>

    <!-- 词库统计：全部 / 单词 / 短语 / 句子 -->
    <div v-if="totalCount" class="lib-stats">
      <div class="stat-item">
        <span class="stat-num">{{ typeStats.all }}</span>
        <span class="stat-label">全部</span>
      </div>
      <div class="stat-item">
        <span class="stat-num">{{ typeStats.word }}</span>
        <span class="stat-label">单词</span>
      </div>
      <div class="stat-item">
        <span class="stat-num">{{ typeStats.phrase }}</span>
        <span class="stat-label">短语</span>
      </div>
      <div class="stat-item">
        <span class="stat-num">{{ typeStats.sentence }}</span>
        <span class="stat-label">句子</span>
      </div>
    </div>

    <!-- 筛选工具栏 -->
    <div v-if="totalCount" class="filter-bar">
      <div class="search-box">
        <span class="search-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </span>
        <input
          v-model="keyword"
          type="text"
          class="search-input"
          placeholder="搜索中文 / 英文…"
        />
        <button v-if="keyword" class="search-clear" @click="keyword = ''">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <button class="filter-btn" :class="{ active: filterSummary }" @click="openFilterSheet">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
          <span>{{ filterSummary || '筛选' }}</span>
        </button>
      </div>
    </div>

    <!-- 筛选底部面板 -->
    <transition name="sheet">
      <div v-if="showFilterSheet" class="sheet-mask" @click.self="closeFilterSheet" @touchmove.prevent>
        <div class="sheet" @touchmove.stop>
          <div class="sheet-title">筛选</div>
          <div class="sheet-body">
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
              <div class="sheet-group-title">背熟程度</div>
              <div class="sheet-opts">
                <button
                  v-for="opt in filterOptions"
                  :key="opt.value"
                  class="sheet-opt"
                  :class="{ active: draftStatusFilter === opt.value }"
                  @click="draftStatusFilter = opt.value"
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

    <!-- 空状态：词句库为空 -->
    <div v-if="!totalCount" class="empty-state">
      <div class="empty-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#c8c8c8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
      </div>
      <p class="empty-title">暂无词句</p>
      <p class="empty-desc">去录入添加你的第一条词句吧</p>
      <button class="empty-btn" @click="router.push('/input')">去录入</button>
    </div>

    <!-- 无匹配结果 -->
    <div v-else-if="noMatch" class="empty-state">
      <div class="empty-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#c8c8c8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      </div>
      <p class="empty-title">没有符合条件的词句</p>
      <p class="empty-desc">试试换一个关键词或切换筛选条件</p>
      <button class="empty-btn" @click="resetFilters">清除筛选</button>
    </div>

    <!-- 列表 -->
    <div v-else class="word-list">
      <div v-for="(word, index) in pagedWords" :key="word.id" class="word-item">
        <!-- 编辑态 -->
        <div v-if="editingId === word.id" class="edit-row">
          <textarea v-model="editForm.chinese" class="cell-input area" placeholder="中文"></textarea>
          <textarea v-model="editForm.english" class="cell-input area" placeholder="英文"></textarea>
          <div class="type-row">
            <span class="type-label">类型</span>
            <div class="type-seg">
              <button
                v-for="opt in typeOptions"
                :key="opt.value"
                class="type-seg-btn"
                :class="{ active: editForm.type === opt.value }"
                @click="editForm.type = opt.value"
              >{{ opt.label }}</button>
            </div>
          </div>
          <template v-if="editForm.type === 'word'">
            <input v-model="editForm.pos" class="cell-input pos" placeholder="词性" />
            <div class="case-row">
              <span class="case-label">区分大小写</span>
              <div class="mini-switch" :class="{ on: editForm.caseSensitive }" @click="editForm.caseSensitive = !editForm.caseSensitive">
                <div class="mini-switch-knob"></div>
              </div>
            </div>
          </template>
          <div class="edit-btns">
            <button class="btn primary mini" @click="saveEdit(word)">保存</button>
            <button class="btn ghost mini" @click="cancelEdit">取消</button>
          </div>
        </div>

        <!-- 正常态 -->
        <template v-else>
          <div class="word-main">
            <div class="word-left">
              <span class="word-en" title="查看详情" @click="lookupWord(word.english)">{{ word.english }}</span>
              <button class="speak-btn" :class="{ 'is-playing': playingKey === 'card' + word.id }" title="发音" @click.stop="speak(word.english, 0, null, 'card' + word.id)"><span class="spk-static">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg></span><span class="spk-eq"><i></i><i></i><i></i></span>
              </button>
              <span v-if="word.type && word.type !== 'word'" class="type-tag">{{ word.type === 'phrase' ? '短语' : '句子' }}</span>
              <span v-if="word.pos" class="pos-tag">{{ word.pos }}</span>
            </div>
            <span class="word-count" :class="{ mastered: isMastered(word) }">
              <template v-if="isMastered(word)">✓ {{ word.count || 0 }}/{{ threshold }}</template>
              <template v-else>{{ word.count || 0 }}/{{ threshold }}</template>
            </span>
          </div>
          <div class="word-sub">
            <span class="word-zh">{{ word.chinese }}</span>
            <span class="word-time">{{ formatTime(word.createdAt) }}</span>
          </div>

          <div v-if="!isMastered(word) && (word.count || 0) > 0" class="progress-bar">
            <div class="progress-fill" :style="{ width: pct(word) + '%' }"></div>
          </div>

          <!-- 操作按钮 -->
          <div class="word-ops">
            <template v-if="confirmDeleteId === word.id">
              <span class="confirm-hint">删除？</span>
              <button class="btn danger mini" @click="doDelete(word)">是</button>
              <button class="btn ghost mini" @click="cancelDelete">取消</button>
            </template>
            <template v-else-if="confirmResetId === word.id">
              <span class="confirm-hint">重置次数？</span>
              <button class="btn danger mini" @click="doReset(word)">是</button>
              <button class="btn ghost mini" @click="cancelReset">取消</button>
            </template>
            <template v-else>
              <button class="op-btn study" title="背诵" @click="goPractice(word.english)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
              </button>
              <button class="op-btn" title="编辑" @click="startEdit(word)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="op-btn" title="查词典" @click="lookupWord(word.english)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
              </button>
              <button class="op-btn" title="重置次数" @click="askReset(word)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
              </button>
              <button class="op-btn del" title="删除" @click="askDelete(word)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </template>
          </div>
        </template>
      </div>

      <!-- 分页控件 -->
      <div v-if="filteredWords.length" class="pagination">
        <span class="page-info">共 {{ filteredWords.length }} 条 · {{ currentPage }}/{{ pageCount }} 页</span>
        <div class="page-btns">
          <button class="page-btn" :disabled="currentPage <= 1" @click="currentPage = 1">«</button>
          <button class="page-btn" :disabled="currentPage <= 1" @click="currentPage > 1 && currentPage--">‹</button>
          <template v-for="(p, i) in pageNumbers" :key="i">
            <span v-if="p === '…'" class="page-ellipsis">…</span>
            <button v-else class="page-btn" :class="{ active: p === currentPage }" @click="currentPage = p">{{ p }}</button>
          </template>
          <button class="page-btn" :disabled="currentPage >= pageCount" @click="currentPage < pageCount && currentPage++">›</button>
          <button class="page-btn" :disabled="currentPage >= pageCount" @click="currentPage = pageCount">»</button>
        </div>
        <select class="page-size" :value="pageSize" @change="changePageSize($event.target.value)">
          <option :value="20">20 条/页</option>
          <option :value="50">50 条/页</option>
          <option :value="100">100 条/页</option>
        </select>
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
          <AiUsageCard v-if="dictModal" :word="dictModal.word" />
          <div v-if="dictModal.loading" class="dict-loading">查询中…</div>
          <div v-else-if="dictModal.error" class="dict-error"> {{ dictModal.error }}</div>
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
  </div>
</template>

<style scoped>
.library-page {
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





/* 微信风格单词列表 */
.word-list {
  margin-top: 12px;
}

.word-item {
  padding: 12px 16px;
  position: relative;
  background: #fff;
  margin-bottom: 8px;
  border-radius: 8px;
}

.word-item:last-child {
  margin-bottom: 0;
}

.word-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.word-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.speak-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: #f2f2f2;
  color: var(--text-main);
  width: 28px;
  height: 28px;
  border-radius: 50%;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.2s;
}

.speak-btn:active {
  background: #e5e5e5;
}

.word-en {
  font-size: 17px;
  font-weight: 600;
  color: var(--text-main);
  word-break: break-word;
  overflow-wrap: anywhere;
  cursor: pointer;
}

.word-en:active {
  opacity: 0.6;
}

.pos-tag {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 4px;
  background: #f2f2f2;
  color: var(--text-sub);
  font-size: 12px;
  flex-shrink: 0;
}

.type-tag {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 4px;
  background: rgba(7, 193, 96, 0.1);
  color: var(--primary);
  font-size: 12px;
  flex-shrink: 0;
}

.type-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}
.type-label {
  font-size: 14px;
  color: var(--text-sub);
  flex-shrink: 0;
}
.type-seg {
  display: flex;
  background: #f5f5f5;
  border-radius: 8px;
  padding: 2px;
  gap: 2px;
  flex: 1;
}
.type-seg-btn {
  flex: 1;
  padding: 6px 0;
  border: none;
  background: transparent;
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-sub);
  cursor: pointer;
}
.type-seg-btn.active {
  background: #fff;
  color: var(--primary);
  font-weight: 500;
  box-shadow: 0 1px 2px rgba(0,0,0,0.06);
}

.word-count {
  font-size: 13px;
  color: var(--text-sub);
  flex-shrink: 0;
}

.word-count.mastered {
  color: var(--primary);
  font-weight: 500;
}

.word-sub {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
}

.word-zh {
  font-size: 14px;
  color: var(--text-sub);
  word-break: break-word;
  overflow-wrap: anywhere;
}

.word-time {
  font-size: 12px;
  color: #b2b2b2;
}

.progress-bar {
  width: 100%;
  height: 4px;
  border-radius: 999px;
  background: #e8e8e8;
  overflow: hidden;
  margin-top: 8px;
}

.progress-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--primary);
  transition: width 0.3s ease;
}

.word-ops {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 0.5px solid #f2f2f2;
}

.op-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: #888;
  cursor: pointer;
  transition: all 0.15s;
}


.op-btn:active { background: #f2f2f2; }

.edit-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.edit-btns {
  display: flex;
  gap: 8px;
}

.confirm-hint {
  font-size: 13px;
  color: var(--danger);
  font-weight: 600;
  margin-right: 4px;
}

.cell-input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
  outline: none;
  background: #fff;
  box-sizing: border-box;
}

.cell-input:focus {
  border-color: var(--primary);
}

.mastered-text {
  color: var(--success);
}

/* 筛选工具栏 */
.filter-bar {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
}

/* 词库统计条（微信风格） */
.lib-stats {
  display: flex;
  background: #fff;
  margin: 8px 16px 0;
  border-radius: 12px;
  padding: 14px 0;
}

.stat-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.stat-item + .stat-item {
  border-left: 0.5px solid #f0f0f0;
}

.stat-num {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-main);
  line-height: 1.2;
}

.stat-label {
  font-size: 12px;
  color: #999;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #fff;
  border-radius: 8px;
  padding: 0 10px;
  height: 38px;
}

.search-icon {
  display: flex;
  color: #b2b2b2;
}

.filter-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: #f2f2f2;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 13px;
  color: var(--text-sub);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.2s;
}

.filter-btn.active {
  background: rgba(7, 193, 96, 0.1);
  color: var(--primary);
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
.sheet-group + .sheet-group {
  border-top: 1px solid #f0f0f0;
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

.search-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #e0e0e0;
  color: #fff;
  border: none;
  cursor: pointer;
}

.search-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 14px;
  background: transparent;
  color: var(--text-main);
}

/* ===== 分页控件 ===== */
.pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--border-light);
}

.page-info {
  font-size: 13px;
  color: var(--text-sub);
}

.page-btns {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.page-btn {
  min-width: 30px;
  height: 30px;
  padding: 0 6px;
  border: 1px solid var(--border);
  background: #ffffff;
  border-radius: 7px;
  font-size: 14px;
  color: var(--text-sub);
  cursor: pointer;
  transition: all 0.18s ease;
}

.page-btn:hover:not(:disabled) {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-light);
}

.page-btn.active {
  border-color: var(--primary);
  background: var(--primary);
  color: #ffffff;
  font-weight: 700;
}

.page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.page-ellipsis {
  padding: 0 3px;
  color: var(--text-faint);
  font-size: 13px;
}

.page-size {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 13px;
  color: var(--text-sub);
  background: #ffffff;
  cursor: pointer;
}

.confirm-hint {
  font-size: 13px;
  color: var(--danger);
  font-weight: 600;
  margin-right: 4px;
}

.cell-input {
  width: 100%;
  min-width: 90px;
  padding: 7px 10px;
  border: 1.5px solid var(--primary);
  border-radius: 8px;
  font-size: 14px;
  outline: none;
  background: #fff;
}

.cell-input.area {
  resize: none;
  min-height: 48px;
  line-height: 1.5;
  font-family: inherit;
  box-sizing: border-box;
}

.cell-input.pos {
  min-width: 70px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* ===== 移动端适配 ===== */
@media (max-width: 768px) {
  .card {
    padding: 0;
    background: transparent;
  }

  .card-head {
    padding: 14px 16px 0;
    background: transparent;
  }

  .filter-bar {
    padding: 0 16px;
  }

  .word-list {
    margin: 12px 16px 0;
  }

  .pagination {
    padding: 12px 16px;
  }
}

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

.dict-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-main);
  margin: 0 0 8px 0;
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

.dict-exam {
  background: #f5f5f5;
  color: var(--text-sub);
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  margin-bottom: 16px;
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

.speak-mini:active {
  transform: scale(0.9);
}

.case-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.case-label {
  font-size: 13px;
  color: #666;
  white-space: nowrap;
}
.mini-switch {
  position: relative;
  width: 44px;
  height: 24px;
  border-radius: 24px;
  background-color: #ccc;
  transition: background-color 0.3s;
  cursor: pointer;
  flex-shrink: 0;
}
.mini-switch.on {
  background-color: var(--primary);
}
.mini-switch-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background-color: #fff;
  transition: left 0.3s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
.mini-switch.on .mini-switch-knob {
  left: 22px;
}
.mini-switch-label {
  font-size: 13px;
  color: #666;
}
</style>
