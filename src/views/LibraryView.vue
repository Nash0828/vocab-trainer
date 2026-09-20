<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useWords } from '../composables/useWords'

const router = useRouter()
const { words, updateWord, removeWord, checkDuplicate, resetCount, isMastered, settings } =
  useWords()

const editingId = ref(null)
const editForm = reactive({ chinese: '', english: '', pos: '' })
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
      w.english.toLowerCase().includes(kw) ||
      (w.pos || '').toLowerCase().includes(kw)
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
  { value: 'mastered', label: '✓ 已背熟' },
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
}

function cancelEdit() {
  editingId.value = null
}

function saveEdit(word) {
  if (!editForm.chinese.trim() || !editForm.english.trim()) {
    showTip('⚠️ 中文和英文不能为空', 'warn')
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
  <section class="card">
    <div class="card-head">
      <h2>🗂️ 词库管理</h2>
      <p class="muted">
        查看、修改或删除已录入的单词，共 <strong>{{ totalCount }}</strong> 个，其中
        <strong class="mastered-text">已背熟 {{ masteredCount }}</strong> 个（阈值 {{ threshold }} 次）
      </p>
    </div>

    <transition name="fade">
      <p v-if="tip" class="tip" :class="tip.kind">{{ tip.text }}</p>
    </transition>

    <!-- 筛选工具栏 -->
    <div v-if="totalCount" class="filter-bar">
      <div class="search-box">
        <span class="search-icon">🔍</span>
        <input
          v-model="keyword"
          type="text"
          class="search-input"
          placeholder="搜索中文 / 英文 / 词性…"
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
    <div v-if="!totalCount" class="empty">
      <div class="empty-icon">📭</div>
      <h3>暂无单词</h3>
      <p class="muted">去「单词录入」添加你的第一个单词吧！</p>
      <button class="btn primary" @click="router.push('/')">去录入 →</button>
    </div>

    <!-- 无匹配结果 -->
    <div v-else-if="noMatch" class="empty">
      <div class="empty-icon">🔎</div>
      <h3>没有符合条件的单词</h3>
      <p class="muted">试试换一个关键词或切换筛选条件</p>
      <button class="btn ghost" @click="resetFilters">清除筛选</button>
    </div>

    <!-- 列表 -->
    <div v-else class="table-wrap">
      <table class="word-table">
        <colgroup>
          <col
            v-for="(h, i) in headerList"
            :key="'col-' + i"
            :style="colWidths[i] ? { width: colWidths[i] + 'px' } : {}"
          />
        </colgroup>
        <thead>
          <tr>
            <th v-for="(h, i) in headerList" :key="h" :class="{ 'th-op': h === '操作' }">
              {{ h }}
              <button
                v-if="sortKey(h)"
                class="sort-btn"
                :class="{ active: sortField === sortKey(h) }"
                :title="sortField === sortKey(h) ? '点击切换升序/降序，再点取消' : '点击排序'"
                @click="toggleSort(sortKey(h))"
              >
                {{ sortArrow(sortKey(h)) }}
              </button>
              <span
                class="resize-handle"
                title="拖拽调整列宽"
                @mousedown.prevent="startResize($event, i)"
              ></span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(word, index) in pagedWords" :key="word.id">
            <template v-if="editingId === word.id">
              <td class="idx">{{ (currentPage - 1) * pageSize + index + 1 }}</td>
              <td><input v-model="editForm.chinese" class="cell-input" placeholder="中文" /></td>
              <td><input v-model="editForm.english" class="cell-input" placeholder="英文" /></td>
              <td><input v-model="editForm.pos" class="cell-input pos" placeholder="词性" /></td>
              <td class="muted small">次数 {{ word.count || 0 }}</td>
              <td class="muted small time-cell">{{ formatTime(word.createdAt) }}</td>
              <td class="op">
                <div class="op-actions">
                  <button class="btn primary mini" @click="saveEdit(word)">保存</button>
                  <button class="btn ghost mini" @click="cancelEdit">取消</button>
                </div>
              </td>
            </template>

            <template v-else>
              <td class="idx">{{ (currentPage - 1) * pageSize + index + 1 }}</td>
              <td>{{ word.chinese }}</td>
              <td class="en">{{ word.english }}</td>
              <td>
                <span v-if="word.pos" class="pos-tag">{{ word.pos }}</span>
                <span v-else class="muted">—</span>
              </td>
              <td class="progress-cell">
                <template v-if="isMastered(word)">
                  <span class="mastered-badge">✓ 已背熟</span>
                  <span class="progress-text">{{ word.count || 0 }}/{{ threshold }}</span>
                </template>
                <template v-else>
                  <span class="progress-text">{{ word.count || 0 }}/{{ threshold }}</span>
                  <div class="progress-bar">
                    <div class="progress-fill" :style="{ width: pct(word) + '%' }"></div>
                  </div>
                </template>
              </td>
              <td class="muted small time-cell">{{ formatTime(word.createdAt) }}</td>
              <td class="op">
                <div class="op-actions">
                  <template v-if="confirmDeleteId === word.id">
                    <span class="confirm-hint">确认删除？</span>
                    <button class="btn danger mini" @click="doDelete(word)">是，删除</button>
                    <button class="btn ghost mini" @click="cancelDelete">取消</button>
                  </template>
                  <template v-else-if="confirmResetId === word.id">
                    <span class="confirm-hint">确认重置次数？</span>
                    <button class="btn danger mini" @click="doReset(word)">是，重置</button>
                    <button class="btn ghost mini" @click="cancelReset">取消</button>
                  </template>
                  <template v-else>
                    <button class="icon-btn edit" title="编辑单词" @click="startEdit(word)">✏️</button>
                    <button class="icon-btn dict" title="查询词典释义" @click="lookupWord(word.english)">📖</button>
                    <button class="icon-btn reset" title="重置背诵次数" @click="askReset(word)">↺</button>
                    <button class="icon-btn del" title="删除单词" @click="askDelete(word)">🗑️</button>
                  </template>
                </div>
              </td>
            </template>
          </tr>
        </tbody>
      </table>

      <!-- 分页控件 -->
      <div v-if="filteredWords.length" class="pagination">
        <span class="page-info">
          共 {{ filteredWords.length }} 条 · 第 {{ currentPage }}/{{ pageCount }} 页
        </span>
        <div class="page-btns">
          <button
            class="page-btn"
            :disabled="currentPage <= 1"
            title="第一页"
            @click="currentPage = 1"
          >
            «
          </button>
          <button
            class="page-btn"
            :disabled="currentPage <= 1"
            title="上一页"
            @click="currentPage > 1 && currentPage--"
          >
            ‹
          </button>
          <template v-for="(p, i) in pageNumbers" :key="i">
            <span v-if="p === '…'" class="page-ellipsis">…</span>
            <button
              v-else
              class="page-btn"
              :class="{ active: p === currentPage }"
              @click="currentPage = p"
            >
              {{ p }}
            </button>
          </template>
          <button
            class="page-btn"
            :disabled="currentPage >= pageCount"
            title="下一页"
            @click="currentPage < pageCount && currentPage++"
          >
            ›
          </button>
          <button
            class="page-btn"
            :disabled="currentPage >= pageCount"
            title="最后一页"
            @click="currentPage = pageCount"
          >
            »
          </button>
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

.table-wrap {
  margin-top: 16px;
  overflow-x: auto;
}

/* 筛选工具栏 */
.filter-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  margin-top: 16px;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 220px;
  max-width: 360px;
  background: #ffffff;
  border: 1.5px solid var(--border);
  border-radius: 10px;
  padding: 0 8px 0 10px;
}

.search-icon {
  font-size: 14px;
}

.search-input {
  flex: 1;
  border: none;
  outline: none;
  padding: 9px 4px;
  font-size: 14px;
  background: transparent;
  color: var(--text-main);
}

.status-filters {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.filter-btn {
  border: 1.5px solid var(--border);
  background: #ffffff;
  color: var(--text-sub);
  border-radius: 10px;
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.filter-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.filter-btn.active {
  border-color: var(--primary);
  background: var(--primary);
  color: #ffffff;
}

.word-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 15px;
}

.word-table th {
  text-align: left;
  padding: 10px 10px;
  color: var(--text-sub);
  font-weight: 600;
  font-size: 13px;
  border-bottom: 2px solid var(--border);
  white-space: nowrap;
  position: relative; /* 为拖拽手柄定位 */
  user-select: none;
}

/* 表头排序按钮 */
.sort-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: 6px;
  width: 22px;
  height: 22px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #ffffff;
  color: var(--text-faint);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  vertical-align: middle;
  transition: all 0.18s ease;
}

.sort-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-light);
}

.sort-btn.active {
  border-color: var(--primary);
  background: var(--primary);
  color: #ffffff;
}

/* 表头拖拽手柄：表头右缘细竖线 */
.resize-handle {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 9px;
  cursor: col-resize;
  z-index: 3;
  touch-action: none;
}

.resize-handle::after {
  content: '';
  position: absolute;
  right: 3px;
  top: 22%;
  bottom: 22%;
  width: 2px;
  border-radius: 2px;
  background: transparent;
  transition: background 0.15s;
}

.resize-handle:hover::after,
.resize-handle:active::after {
  background: var(--primary);
}

.word-table td {
  padding: 11px 10px;
  border-bottom: 1px solid var(--border-light);
  color: var(--text-main);
  vertical-align: middle;
}

.word-table tbody tr:hover {
  background: var(--bg-soft);
}

.idx {
  color: var(--text-faint);
  width: 40px;
}

.en {
  font-weight: 700;
  color: var(--primary);
  white-space: nowrap;
}

.time-cell {
  white-space: nowrap;
}

.pos-tag {
  display: inline-block;
  padding: 2px 9px;
  border-radius: 999px;
  background: #eef3fb;
  color: var(--primary);
  font-size: 13px;
}

.mastered-text {
  color: var(--success);
}

.progress-cell {
  min-width: 120px;
}

.progress-text {
  font-size: 13px;
  color: var(--text-sub);
  margin-right: 6px;
}

.progress-bar {
  display: inline-block;
  vertical-align: middle;
  width: 70px;
  height: 7px;
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

.mastered-badge {
  display: inline-block;
  padding: 2px 9px;
  border-radius: 999px;
  background: #e8f7ee;
  border: 1px solid #a8dcc0;
  color: var(--success);
  font-size: 13px;
  font-weight: 700;
}

.th-op {
  width: 150px;
  white-space: nowrap;
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

/* 操作列 td 保持表格单元格布局，内层 flex 容器承载按钮，
   避免 display:flex 导致该列下边框与其他列错位 */
.op {
  white-space: nowrap;
}

.op-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

/* 图标按钮 */
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  border: 1px solid var(--border);
  background: #ffffff;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  transition: all 0.2s ease;
}

.icon-btn:hover {
  transform: translateY(-1px);
}

.icon-btn.edit:hover {
  border-color: var(--primary);
  background: var(--primary-light);
}

.icon-btn.reset:hover {
  border-color: #8a6dff;
  background: #f2eeff;
}

.icon-btn.del:hover {
  border-color: var(--danger);
  background: #fdecea;
}

.confirm-hint {
  font-size: 13px;
  color: var(--danger);
  font-weight: 600;
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

/* ===== 移动端适配：表格 → 卡片列表 ===== */
@media (max-width: 768px) {
  .table-wrap {
    overflow-x: visible;
  }

  .filter-bar {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }

  .search-box {
    max-width: 100%;
    min-width: 0;
  }

  .status-filters {
    justify-content: center;
  }

  .filter-btn {
    padding: 8px 12px;
    font-size: 13px;
  }

  /* 表格整体转为卡片流 */
  .word-table,
  .word-table thead,
  .word-table tbody,
  .word-table tr,
  .word-table td {
    display: block;
  }

  .word-table thead {
    display: none; /* 隐藏表头 */
  }

  .word-table tr {
    margin-bottom: 0;
    padding: 12px 14px;
    border: none;
    border-radius: 0;
    background: #ffffff;
    border-bottom: 8px solid #f2f2f2;
    display: block;
  }

  .word-table tbody tr:hover {
    background: #ffffff;
  }

  .word-table td {
    border: none;
    padding: 0;
    vertical-align: top;
    display: block;
  }

  /* 序号手机上不显示 */
  .word-table .idx {
    display: none;
  }

  /* 第一行：英文 + 词性在左，操作按钮在右 */
  .word-table td.en {
    font-size: 17px;
    font-weight: 600;
  }

  .word-table td.pos,
  .word-table td:nth-child(4) {
    font-size: 12px;
    color: var(--text-faint);
    margin-top: 1px;
  }

  /* 操作按钮：单独一行，右对齐 */
  .word-table td.op {
    float: none;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 0.5px solid #f0f0f0;
  }

  .op-actions {
    justify-content: flex-end;
    gap: 8px;
  }

  .icon-btn {
    width: 34px;
    height: 34px;
    font-size: 16px;
  }

  /* 第二行：中文 */
  .word-table td.zh {
    font-size: 14px;
    color: var(--text-sub);
    margin-top: 4px;
  }

  /* 第三行：进度 + 时间 */
  .word-table td.progress-cell {
    min-width: 0;
    font-size: 12px;
    color: var(--text-faint);
    margin-top: 6px;
    display: inline-block;
    margin-right: 12px;
  }

  .word-table .time-cell {
    font-size: 12px;
    color: var(--text-faint);
    display: inline-block;
  }

  .progress-bar {
    width: 60px;
    height: 3px;
    display: inline-block;
    vertical-align: middle;
    margin-left: 4px;
  }

  /* 分页控件 */
  .pagination {
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }

  .page-btn {
    min-width: 34px;
    height: 34px;
  }
}

/* 词典按钮 hover */
.icon-btn.dict:hover {
  border-color: #8a6dff;
  background: #f2eeff;
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
