<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useWords } from '../composables/useWords'

const router = useRouter()
const { words, updateWord, removeWord, checkDuplicate, resetCount, isMastered, settings } =
  useWords()

const editingId = ref(null)
const editForm = reactive({ chinese: '', english: '', pos: '', caseSensitive: false })
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
}

// 播放发音
function speak(word, type = 0) {
  if (!word) return
  try {
    const url = `https://dict.youdao.com/dictvoice?type=${type}&audio=${encodeURIComponent(String(word).trim())}`
    new Audio(url).play().catch(() => {})
  } catch (e) {}
}

// 弹窗打开时禁止背景滚动
watch(dictModal, (val) => {
  document.body.style.overflow = val ? 'hidden' : ''
})

const threshold = computed(() => settings.value.masteryThreshold)
const masteredCount = computed(() => words.value.filter((w) => isMastered(w)).length)

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

// ---- 筛选：关键字 + 背熟状态（可组合） ----
const keyword = ref('')
const statusFilter = ref('all') // 'all' | 'mastered' | 'notMastered'

const filteredWords = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return sortedWords.value.filter((w) => {
    const matchKw =
      !kw ||
      w.chinese.toLowerCase().includes(kw) ||
      w.english.toLowerCase().includes(kw)
    const mastered = isMastered(w)
    const matchStatus =
      statusFilter.value === 'all' ||
      (statusFilter.value === 'mastered' && mastered) ||
      (statusFilter.value === 'notMastered' && !mastered)
    return matchKw && matchStatus
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
watch([keyword, statusFilter, sortField, sortDir], () => {
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

function resetFilters() {
  keyword.value = ''
  statusFilter.value = 'all'
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
  // 重复校验：排除当前编辑的单词自身，避免把自己的旧值误判为重复
  const dup = checkDuplicate({
    chinese: editForm.chinese,
    english: editForm.english,
    excludeId: word.id,
  })
  const parts = []
  if (dup.duplicateChinese) parts.push(`中文释义「${editForm.chinese.trim()}」`)
  if (dup.duplicateEnglish) parts.push(`英文单词「${editForm.english.trim()}」`)
  if (parts.length) {
    showTip(`⛔ ${parts.join(' 与 ')}与词库中其他单词重复，保存失败`, 'err')
    return
  }
  const ok = updateWord(word.id, {
    chinese: editForm.chinese.trim(),
    english: editForm.english.trim(),
    pos: editForm.pos.trim(),
    caseSensitive: editForm.caseSensitive,
  })
  if (ok) {
    showTip(`✅ 已保存修改：${editForm.english}`, 'ok')
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
    showTip(`🗑️ 已删除：${word.english}`, 'ok')
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
    showTip(`↺ 已将「${word.english}」背诵次数重置为 0`, 'ok')
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
        <button v-if="keyword" class="btn ghost mini" @click="keyword = ''">清空</button>
      </div>
      <div class="status-filters">
        <button
          v-for="opt in filterOptions"
          :key="opt.value"
          class="filter-btn"
          :class="{ active: statusFilter === opt.value }"
          @click="statusFilter = opt.value"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>

    <!-- 空状态：词库为空 -->
    <div v-if="!totalCount" class="empty-state">
      <div class="empty-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#c8c8c8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
      </div>
      <p class="empty-title">暂无单词</p>
      <p class="empty-desc">去录入添加你的第一个单词吧</p>
      <button class="empty-btn" @click="router.push('/input')">去录入</button>
    </div>

    <!-- 无匹配结果 -->
    <div v-else-if="noMatch" class="empty-state">
      <div class="empty-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#c8c8c8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      </div>
      <p class="empty-title">没有符合条件的单词</p>
      <p class="empty-desc">试试换一个关键词或切换筛选条件</p>
      <button class="empty-btn" @click="resetFilters">清除筛选</button>
    </div>

    <!-- 列表 -->
    <div v-else class="word-list">
      <div v-for="(word, index) in pagedWords" :key="word.id" class="word-item">
        <!-- 编辑态 -->
        <div v-if="editingId === word.id" class="edit-row">
          <input v-model="editForm.chinese" class="cell-input" placeholder="中文" />
          <input v-model="editForm.english" class="cell-input" placeholder="英文" />
          <input v-model="editForm.pos" class="cell-input pos" placeholder="词性" />
          <label class="mini-switch">
            <input type="checkbox" v-model="editForm.caseSensitive" />
            <span class="mini-switch-slider"></span>
          </label>
          <span class="mini-switch-label">大小写敏感</span>
          <div class="edit-btns">
            <button class="btn primary mini" @click="saveEdit(word)">保存</button>
            <button class="btn ghost mini" @click="cancelEdit">取消</button>
          </div>
        </div>

        <!-- 正常态 -->
        <template v-else>
          <div class="word-main">
            <div class="word-left">
              <span class="word-en">{{ word.english }}</span>
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
    <div v-if="dictModal" class="dict-mask" @click.self="closeDict">
      <div class="dict-modal">
        <div class="dict-head">
          <h3>{{ dictModal.word }}</h3>
          <button class="dict-close" @click="closeDict">✕</button>
        </div>
        <div class="dict-body">
          <div v-if="dictModal.loading" class="dict-loading">查询中…</div>
          <div v-else-if="dictModal.error" class="dict-error"> {{ dictModal.error }}</div>
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

.tip {
  margin: 14px 0 0;
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

/* 微信风格单词列表 */
.word-list {
  margin-top: 12px;
}

.word-item {
  padding: 12px 16px;
  position: relative;
  background: #fff;
  margin-bottom: 8px;
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

.word-en {
  font-size: 17px;
  font-weight: 600;
  color: var(--text-main);
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

.search-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 14px;
  background: transparent;
  color: var(--text-main);
}

.status-filters {
  display: flex;
  gap: 6px;
}

.filter-btn {
  border: none;
  background: #fff;
  color: var(--text-sub);
  border-radius: 6px;
  padding: 7px 14px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.filter-btn.active {
  background: var(--primary);
  color: #fff;
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

.dict-meaning {
  margin-bottom: 16px;
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

.dict-meaning li:last-child {
  border-bottom: none;
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

.mini-switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
}
.mini-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}
.mini-switch-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #ccc;
  border-radius: 24px;
  transition: 0.3s;
}
.mini-switch-slider:before {
  position: absolute;
  content: "";
  height: 20px;
  width: 20px;
  left: 2px;
  bottom: 2px;
  background-color: white;
  border-radius: 50%;
  transition: 0.3s;
}
.mini-switch input:checked + .mini-switch-slider {
  background-color: var(--primary);
}
.mini-switch input:checked + .mini-switch-slider:before {
  transform: translateX(20px);
}
.mini-switch-label {
  font-size: 13px;
  color: #666;
}
</style>
