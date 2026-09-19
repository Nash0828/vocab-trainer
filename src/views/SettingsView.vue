<script setup>
import { ref, computed } from 'vue'
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
    <section class="card">
      <div class="card-head">
        <h2>⚙️ 设置</h2>
        <p class="muted">调整背单词的"背熟"规则与背诵数据</p>
      </div>

      <transition name="fade">
        <p v-if="tip" class="tip" :class="tip.kind">{{ tip.text }}</p>
      </transition>

      <!-- 数据概览 -->
      <div class="stats-row">
        <div class="stat-item">
          <span class="stat-num">{{ totalCount }}</span>
          <span class="stat-label">单词总数</span>
        </div>
        <div class="stat-item">
          <span class="stat-num mastered">{{ masteredCount }}</span>
          <span class="stat-label">已背熟</span>
        </div>
        <div class="stat-item">
          <span class="stat-num">{{ notMasteredCount }}</span>
          <span class="stat-label">未背熟</span>
        </div>
        <div class="stat-item">
          <span class="stat-num">{{ settings.masteryThreshold }}</span>
          <span class="stat-label">背熟阈值</span>
        </div>
      </div>

      <!-- 背熟阈值设置 -->
      <div class="setting-block">
        <h3>🎯 背熟阈值（单词出现次数上限）</h3>
        <p class="muted">
          每个单词在「背单词」中每答对一次，背诵次数 +1；当次数达到该阈值时视为"已背熟"，不再出现在随机出题中。
        </p>
        <div class="threshold-form">
          <input
            v-model="thresholdInput"
            type="number"
            min="1"
            max="999"
            step="1"
            inputmode="numeric"
            class="threshold-input"
          />
          <span class="muted">次</span>
          <button class="btn primary" @click="saveThreshold">保存阈值</button>
        </div>
      </div>

      <!-- 一键重置 -->
      <div class="setting-block danger-block">
        <h3>🔄 一键重置所有背诵次数</h3>
        <p class="muted">将词库中所有单词的背诵次数归 0，全部恢复为"未背熟"状态。</p>

        <template v-if="confirmResetAll">
          <div class="confirm-box">
            <span class="confirm-text">⚠️ 确定要重置全部 {{ totalCount }} 个单词的背诵次数吗？此操作不可撤销。</span>
            <div class="confirm-actions">
              <button class="btn danger mini" @click="doResetAll">是，全部重置</button>
              <button class="btn ghost mini" @click="cancelResetAll">取消</button>
            </div>
          </div>
        </template>
        <button v-else class="btn danger" @click="askResetAll">一键重置所有背诵次数</button>
      </div>

      <!-- 数据导入 / 导出 -->
      <div class="setting-block">
        <h3>📦 数据导入 / 导出</h3>
        <p class="muted">
          导出可将词库（含每个单词的背诵次数）与背熟阈值保存为 JSON 备份文件，方便备份或在其他浏览器中迁移；导入可从备份文件恢复数据。
        </p>

        <!-- 导出 -->
        <div class="io-row">
          <span class="io-label">导出备份</span>
          <button class="btn primary" @click="exportDataFile">⬇️ 导出数据（JSON）</button>
        </div>

        <!-- 导入 -->
        <div class="io-row">
          <span class="io-label">导入方式</span>
          <div class="io-mode">
            <label class="io-radio" :class="{ active: importMode === 'merge' }">
              <input v-model="importMode" type="radio" value="merge" />
              合并（跳过重复单词）
            </label>
            <label class="io-radio" :class="{ active: importMode === 'overwrite' }">
              <input v-model="importMode" type="radio" value="overwrite" />
              覆盖（用文件整体替换词库）
            </label>
          </div>
        </div>
        <div class="io-row">
          <span class="io-label">选择文件</span>
          <button class="btn ghost" @click="pickImportFile(importMode)">📂 导入数据（JSON）</button>
          <input
            ref="fileInput"
            type="file"
            accept=".json,application/json"
            class="hidden-file"
            @change="onFileSelected"
          />
        </div>

        <!-- 覆盖导入确认 -->
        <div v-if="confirmOverwrite" class="confirm-box overwrite-box">
          <span class="confirm-text">
            ⚠️ 覆盖导入将<b>清空当前 {{ totalCount }} 个单词</b>，替换为备份文件中的数据，此操作不可撤销。确定继续吗？
          </span>
          <div class="confirm-actions">
            <button class="btn danger mini" @click="doConfirmOverwrite">是，覆盖导入</button>
            <button class="btn ghost mini" @click="cancelOverwrite">取消</button>
          </div>
        </div>
      </div>

      <!-- 从 localStorage 迁移旧数据 -->
      <div class="setting-block">
        <h3>🔄 从浏览器本地迁移旧数据</h3>
        <p class="muted">
          如果之前使用旧版本（数据存在浏览器 localStorage），点击下方按钮可将旧数据一次性导入到新的数据库。<b>迁移会清空当前数据库并替换为旧数据</b>。
        </p>

        <template v-if="confirmMigrate">
          <div class="confirm-box">
            <span class="confirm-text">⚠️ 迁移将清空当前数据库中的所有数据，替换为浏览器 localStorage 中的旧数据。确定继续吗？</span>
            <div class="confirm-actions">
              <button class="btn danger mini" :disabled="migrating" @click="doMigrate">
                {{ migrating ? '迁移中…' : '是，开始迁移' }}
              </button>
              <button class="btn ghost mini" :disabled="migrating" @click="cancelMigrate">取消</button>
            </div>
          </div>
        </template>
        <button v-else class="btn ghost" @click="askMigrate">从浏览器本地迁移</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

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

.stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-top: 20px;
}

.stat-item {
  background: var(--bg-soft);
  border-radius: 12px;
  padding: 16px 10px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-num {
  font-size: 26px;
  font-weight: 800;
  color: var(--text-main);
}

.stat-num.mastered {
  color: var(--success);
}

.stat-label {
  font-size: 13px;
  color: var(--text-sub);
}

.setting-block {
  margin-top: 26px;
  padding-top: 22px;
  border-top: 1px dashed var(--border);
}

.setting-block h3 {
  font-size: 16px;
  margin-bottom: 6px;
  color: var(--text-main);
}

.setting-block .muted {
  margin-bottom: 14px;
}

.threshold-form {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.threshold-input {
  width: 130px;
  padding: 10px 14px;
  border: 1.5px solid var(--border);
  border-radius: 10px;
  font-size: 16px;
  outline: none;
}

.threshold-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(74, 144, 217, 0.15);
}

.danger-block {
  border-top-color: #f2b8b1;
}

.danger-block h3 {
  color: var(--danger);
}

.confirm-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  background: var(--danger-soft);
  border: 1px solid #f2b8b1;
  border-radius: 10px;
  padding: 12px 14px;
}

.confirm-text {
  font-size: 14px;
  color: var(--danger);
  font-weight: 600;
}

.confirm-actions {
  display: flex;
  gap: 8px;
}

/* 数据导入 / 导出 */
.io-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 14px;
}

.io-label {
  width: 86px;
  font-size: 14px;
  color: var(--text-sub);
  font-weight: 600;
  flex-shrink: 0;
}

.io-mode {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.io-radio {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1.5px solid var(--border);
  border-radius: 10px;
  background: #ffffff;
  color: var(--text-sub);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
  user-select: none;
}

.io-radio:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.io-radio.active {
  border-color: var(--primary);
  background: var(--primary-light);
  color: var(--primary);
  font-weight: 600;
}

.io-radio input {
  accent-color: var(--primary);
}

.hidden-file {
  display: none;
}

.overwrite-box {
  margin-top: 14px;
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
  .stats-row {
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }

  .stat-item {
    padding: 12px 6px;
  }

  .stat-num {
    font-size: 22px;
  }

  .stat-label {
    font-size: 12px;
  }

  .threshold-form {
    flex-wrap: wrap;
  }

  .io-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .io-label {
    width: auto;
  }
}
</style>
