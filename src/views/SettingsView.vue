<script setup>
import { ref, computed, onMounted } from 'vue'
import { useWords } from '../composables/useWords'
import { api } from '../api/index.js'

const {
  words,
  settings,
  setThreshold,
  resetAllCounts,
  isMastered,
  exportData,
  validateImport,
  importData,
} = useWords()

const thresholdInput = ref(String(settings.value.masteryThreshold))
const confirmResetAll = ref(false)
const tip = ref(null) // { text, kind: 'ok' | 'warn' | 'err' }
let tipTimer = null

// ---- 导入 / 导出 ----
const importMode = ref('merge') // 'merge' | 'overwrite'
const fileInput = ref(null)
const pendingImport = ref(null) // { data, mode }
const confirmOverwrite = ref(false)
let pendingMode = 'merge'

const totalCount = computed(() => words.value.length)
const masteredCount = computed(() => words.value.filter((w) => isMastered(w)).length)
const notMasteredCount = computed(() => totalCount.value - masteredCount.value)

function showTip(text, kind = 'ok') {
  tip.value = { text, kind }
  clearTimeout(tipTimer)
  tipTimer = setTimeout(() => (tip.value = ''), 4000)
}

function saveThreshold() {
  const val = Number(thresholdInput.value)
  if (!Number.isInteger(val) || val < 1 || val > 999) {
    showTip('⚠️ 请输入 1~999 之间的整数', 'warn')
    return
  }
  if (setThreshold(val)) {
    thresholdInput.value = String(settings.value.masteryThreshold)
    showTip(`✅ 背熟阈值已保存为 ${settings.value.masteryThreshold} 次`, 'ok')
  }
}

function askResetAll() {
  confirmResetAll.value = true
}

function cancelResetAll() {
  confirmResetAll.value = false
}

function doResetAll() {
  resetAllCounts()
  confirmResetAll.value = false
  showTip('✅ 已将全部单词背诵次数重置为 0', 'ok')
}

// ---- 导出：下载 JSON 备份文件 ----
async function exportDataFile() {
  try {
    const data = await exportData()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const d = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
    a.download = `背单词助手备份_${stamp}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    showTip(
      `✅ 已导出 ${data.words.length} 个单词（含背诵次数）与背熟阈值，文件名：背单词助手备份_${stamp}.json`,
      'ok'
    )
  } catch (err) {
    showTip(`⛔ 导出失败：${err.message}`, 'err')
  }
}

// ---- 导入：选择文件 ----
function pickImportFile(mode) {
  pendingMode = mode
  fileInput.value?.click()
}

function onFileSelected(e) {
  const file = e.target.files?.[0]
  e.target.value = '' // 允许重复选择同一个文件
  if (!file) return

  const reader = new FileReader()
  reader.onerror = () => showTip('⛔ 读取文件失败，请重试', 'err')
  reader.onload = () => {
    let data
    try {
      data = JSON.parse(reader.result)
    } catch {
      showTip('⛔ 文件不是有效的 JSON，无法导入', 'err')
      return
    }
    const valid = validateImport(data)
    if (!valid.ok) {
      showTip(`⛔ 导入失败：${valid.reason}`, 'err')
      return
    }
    // 覆盖导入且当前有数据时，先确认，防止误操作清空词库
    if (pendingMode === 'overwrite' && totalCount.value > 0) {
      pendingImport.value = { data, mode: 'overwrite' }
      confirmOverwrite.value = true
      return
    }
    applyImport(data, pendingMode)
  }
  reader.readAsText(file)
}

function applyImport(data, mode) {
  const res = importData(data, mode)
  thresholdInput.value = String(settings.value.masteryThreshold)
  const modeText = mode === 'merge' ? '合并' : '覆盖'
  const skipText = res.skipped ? `，跳过 ${res.skipped} 个（重复或无有效内容）` : ''
  showTip(
    `✅ ${modeText}导入成功：新增 ${res.imported} 个单词${skipText}，当前词库共 ${res.total} 个`,
    'ok'
  )
}

function doConfirmOverwrite() {
  const p = pendingImport.value
  pendingImport.value = null
  confirmOverwrite.value = false
  if (p) applyImport(p.data, p.mode)
}

function cancelOverwrite() {
  pendingImport.value = null
  confirmOverwrite.value = false
}

// ---- 从 localStorage 迁移旧数据 ----
const confirmMigrate = ref(false)
const migrating = ref(false)

function readLocal(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function askMigrate() {
  // 先检查 localStorage 里有没有旧数据
  const oldWords = readLocal('vocab-words')
  if (!Array.isArray(oldWords) || !oldWords.length) {
    showTip('ℹ️ 浏览器本地没有找到旧数据（vocab-words 为空）', 'warn')
    return
  }
  confirmMigrate.value = true
}

async function doMigrate() {
  migrating.value = true
  try {
    const payload = {
      words: readLocal('vocab-words') || [],
      settings: readLocal('vocab-settings') || {},
      records: readLocal('vocab-history') || [],
      wrongbook: readLocal('vocab-wrongbook') || [],
    }
    const res = await api.migrateData(payload)
    if (res.ok) {
      showTip(
        `✅ 迁移成功：${res.words} 个单词、${res.records} 条记录、${res.wrongbook} 个错题${res.threshold ? `、阈值 ${res.threshold}` : ''}，即将刷新页面…`,
        'ok'
      )
      setTimeout(() => window.location.reload(), 1500)
    } else {
      showTip(`⛔ 迁移失败：${res.reason || '未知错误'}`, 'err')
    }
  } catch (err) {
    showTip(`⛔ 迁移失败：${err.message}`, 'err')
  } finally {
    migrating.value = false
    confirmMigrate.value = false
  }
}

function cancelMigrate() {
  confirmMigrate.value = false
}
</script>

<template>
  <div class="settings">
    <transition name="fade">
      <p v-if="tip" class="tip" :class="tip.kind">{{ tip.text }}</p>
    </transition>

    <!-- 数据管理 -->
    <div class="cell-group">
      <div class="cell" @click="exportDataFile">
        <span class="cell-label">导出数据备份</span>
        <span class="cell-right">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <span class="chevron">›</span>
        </span>
      </div>

      <div class="cell cell-col">
        <div class="cell-subhead">导入方式</div>
        <div class="io-mode">
          <label class="io-radio" :class="{ active: importMode === 'merge' }">
            <input v-model="importMode" type="radio" value="merge" />
            合并（跳过重复）
          </label>
          <label class="io-radio" :class="{ active: importMode === 'overwrite' }">
            <input v-model="importMode" type="radio" value="overwrite" />
            覆盖（整体替换）
          </label>
        </div>
      </div>

      <div class="cell" @click="pickImportFile(importMode)">
        <span class="cell-label">导入数据备份</span>
        <span class="cell-right">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <span class="chevron">›</span>
        </span>
        <input
          ref="fileInput"
          type="file"
          accept=".json,application/json"
          class="hidden-file"
          @change="onFileSelected"
        />
      </div>
    </div>

    <!-- 危险操作 -->
    <div class="cell-group danger-group">
      <div class="cell cell-danger" @click="askResetAll">
        <span class="cell-label">重置所有背诵次数</span>
        <span class="chevron">›</span>
      </div>
    </div>

    <!-- 确认弹层 -->
    <div v-if="confirmResetAll" class="mask" @click.self="cancelResetAll">
      <div class="dialog">
        <p class="dialog-title">重置全部背诵次数？</p>
        <p class="dialog-msg">将词库中全部 {{ totalCount }} 个单词的背诵次数归 0，此操作不可撤销。</p>
        <div class="dialog-btns">
          <button class="dialog-btn" @click="cancelResetAll">取消</button>
          <button class="dialog-btn danger" @click="doResetAll">确定重置</button>
        </div>
      </div>
    </div>

    <div v-if="confirmOverwrite" class="mask" @click.self="cancelOverwrite">
      <div class="dialog">
        <p class="dialog-title">覆盖导入？</p>
        <p class="dialog-msg">将清空当前 {{ totalCount }} 个单词并替换为备份数据，此操作不可撤销。</p>
        <div class="dialog-btns">
          <button class="dialog-btn" @click="cancelOverwrite">取消</button>
          <button class="dialog-btn danger" @click="doConfirmOverwrite">确定覆盖</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 8px 0;
}

.tip {
  margin: 0 16px;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 14px;
}

.tip.ok { background: #e8f7ee; color: #1f7a4d; }
.tip.warn { background: #fff7e6; color: #ad6800; }
.tip.err { background: #fdecea; color: #b3402f; font-weight: 600; }

/* 微信 cell 分组 */
.cell-group {
  background: #fff;
  margin: 0 16px;
  border-radius: 12px;
  overflow: hidden;
}

.cell {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  font-size: 15px;
  color: var(--text-main);
  cursor: pointer;
  position: relative;
}

.cell:active { background: #f2f2f2; }

.cell + .cell::before {
  content: '';
  position: absolute;
  left: 16px;
  top: 0;
  height: 0.5px;
  background: #e5e5e5;
}

.cell-label { flex: 1; }
.cell-right { display: flex; align-items: center; gap: 6px; color: #c8c8c8; }
.chevron { font-size: 20px; color: #c8c8c8; line-height: 1; }

.cell-col {
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  cursor: default;
}
.cell-col:active { background: #fff; }
.cell-subhead { font-size: 13px; color: var(--text-sub); }

.danger-group { margin-top: 8px; }
.cell-danger { color: #fa5151; text-align: center; justify-content: center; }
.cell-danger .chevron { display: none; }

.io-mode { display: flex; gap: 8px; flex-wrap: wrap; }

.io-radio {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border: 1px solid #e5e5e5;
  border-radius: 6px;
  background: #fff;
  color: var(--text-sub);
  font-size: 14px;
  cursor: pointer;
  user-select: none;
}

.io-radio.active {
  border-color: var(--primary);
  background: #e8f7ee;
  color: var(--primary);
  font-weight: 500;
}

.io-radio input { display: none; }

.hidden-file { display: none; }

/* 微信风格确认弹窗 */
.mask {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.dialog {
  background: #fff;
  border-radius: 14px;
  width: 100%;
  max-width: 300px;
  overflow: hidden;
}

.dialog-title {
  font-size: 16px;
  font-weight: 600;
  text-align: center;
  padding: 20px 16px 8px;
  margin: 0;
}

.dialog-msg {
  font-size: 14px;
  color: var(--text-sub);
  text-align: center;
  padding: 0 16px 18px;
  margin: 0;
}

.dialog-btns {
  display: flex;
  border-top: 0.5px solid #e5e5e5;
}

.dialog-btn {
  flex: 1;
  padding: 12px;
  background: #fff;
  border: none;
  font-size: 16px;
  color: var(--primary);
  cursor: pointer;
}

.dialog-btn + .dialog-btn {
  border-left: 0.5px solid #e5e5e5;
}

.dialog-btn.danger { color: #fa5151; font-weight: 500; }

.fade-enter-active,
.fade-leave-active { transition: opacity 0.25s; }
.fade-enter-from,
.fade-leave-to { opacity: 0; }
</style>
