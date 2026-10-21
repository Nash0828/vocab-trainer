<script setup>
import { ref, computed, onMounted } from 'vue'
import { useWords } from '../composables/useWords'
import { api } from '../api/index.js'

const {
  words,
  settings,
  setThreshold,
  setAutoNext,
  setSentenceVoice,
  resetAllCounts,
  isMastered,
  exportData,
  validateImport,
  importData,
} = useWords()

// 句子朗读音色（豆包 TTS）
const TTS_VOICES = [
  { voice: 'en_female_jenny_uranus_bigtts', label: 'Jenny', desc: '美音女声' },
  { voice: 'en_female_dacey_uranus_bigtts', label: 'Dacey', desc: '美音女声' },
  { voice: 'en_female_stokie_uranus_bigtts', label: 'Stokie', desc: '美音女声' },
  { voice: 'en_female_female_tutor_ms-jenny_uranus_bigtts', label: 'Holly', desc: '美音女声·教学' },
  { voice: 'en_female_hayley_uranus_bigtts', label: 'Hayley', desc: '美音女声·教学' },
  { voice: 'en_female_mel_uranus_bigtts', label: 'Mel', desc: '美音女声·教学' },
  { voice: 'en_male_tim_uranus_bigtts', label: 'Tim', desc: '美音男声' },
  { voice: 'en_male_alex_uranus_bigtts', label: 'Alex', desc: '美音男声' },
  { voice: 'en_male_josh_uranus_bigtts', label: 'Josh', desc: '美音男声' },
  { voice: 'en_female_authoritative-british_uranus_bigtts', label: 'Charlotte', desc: '英音女声' },
]
const currentVoiceName = computed(() => {
  const v = TTS_VOICES.find((x) => x.voice === settings.value.sentenceVoice)
  return v ? `${v.label}（${v.desc}）` : 'Jenny（美音女声）'
})
const showVoiceSheet = ref(false)
const previewVoice = ref('') // 正在试听的音色
let previewAudio = null
function openVoiceSheet() {
  previewVoice.value = ''
  stopPreview()
  showVoiceSheet.value = true
}
function closeVoiceSheet() {
  stopPreview()
  showVoiceSheet.value = false
}
function stopPreview() {
  if (previewAudio) { try { previewAudio.pause() } catch (e) {} previewAudio = null }
  previewVoice.value = ''
}
function previewSpeak(voice) {
  if (previewVoice.value === voice) { stopPreview(); return }
  stopPreview()
  previewVoice.value = voice
  const audio = new Audio(`/api/tts?text=${encodeURIComponent("Hello! Nice to meet you. Let's learn English together.")}&voice=${encodeURIComponent(voice)}`)
  previewAudio = audio
  audio.onended = () => { previewVoice.value = ''; previewAudio = null }
  audio.onerror = () => { previewVoice.value = ''; previewAudio = null }
  audio.play().catch(() => { previewVoice.value = ''; previewAudio = null })
}
function pickVoice(voice) {
  setSentenceVoice(voice)
  showVoiceSheet.value = false
  stopPreview()
  const v = TTS_VOICES.find((x) => x.voice === voice)
  showTip(`句子音色已切换为 ${v ? v.label : 'Jenny'}`, 'ok')
}

const thresholdInput = ref(String(settings.value.masteryThreshold))
const confirmResetAll = ref(false)
const tip = ref(null) // { text, kind: 'ok' | 'warn' | 'err' }
let tipTimer = null

// ---- 导入 / 导出 ----
const fileInput = ref(null)
const pendingImport = ref(null) // { data, mode }
const confirmOverwrite = ref(false)
const showImportMode = ref(false)
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
    showTip('请输入 1~999 之间的整数', 'warn')
    return
  }
  if (setThreshold(val)) {
    thresholdInput.value = String(settings.value.masteryThreshold)
    showTip(`背熟阈值已保存为 ${settings.value.masteryThreshold} 次`, 'ok')
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
  showTip('已将全部单词背诵次数重置为 0', 'ok')
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
    a.download = `词句助手数据_${stamp}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    showTip(
      `已导出 ${data.words.length} 个单词（含背诵次数）与背熟阈值，文件名：词句助手数据_${stamp}.json`,
      'ok'
    )
  } catch (err) {
    showTip(`⛔ 导出失败：${err.message}`, 'err')
  }
}

// ---- 导入：选择文件 ----
function chooseImportMode(mode) {
  showImportMode.value = false
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
    `${modeText}导入成功：新增 ${res.imported} 个单词${skipText}，当前词句库共 ${res.total} 个`,
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
        `迁移成功：${res.words} 个单词、${res.records} 条记录、${res.wrongbook} 个错题${res.threshold ? `、阈值 ${res.threshold}` : ''}，即将刷新页面…`,
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

    <!-- 背诵行为 -->
    <div class="menu-group">
      <div class="menu-item" @click="settings.autoNext = !settings.autoNext; setAutoNext(settings.autoNext)">
        <span class="menu-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        </span>
        <span class="menu-label">答对自动下一题</span>
        <span class="menu-switch" :class="{ on: settings.autoNext }">
          <i></i>
        </span>
      </div>
    </div>

    <!-- 朗读设置 -->
    <div class="menu-group">
      <div class="menu-item" @click="openVoiceSheet">
        <span class="menu-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
        </span>
        <span class="menu-label">句子音色</span>
        <span class="menu-value">{{ currentVoiceName }}</span>
        <span class="menu-arrow">›</span>
      </div>
      <div class="menu-desc">朗读句子时使用的豆包语音音色</div>
    </div>

    <!-- 背熟规则 -->
    <div class="menu-group">
      <div class="menu-item">
        <span class="menu-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        </span>
        <span class="menu-label">背熟阈值</span>
        <input v-model="thresholdInput" class="threshold-input" type="number" min="1" max="999" @change="saveThreshold" />
      </div>
      <div class="menu-desc">答对多少次后视为已背熟，已背熟的单词不再出题</div>
    </div>

    <!-- 数据管理 -->
    <div class="menu-group">
      <div class="menu-item" @click="exportDataFile">
        <span class="menu-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </span>
        <span class="menu-label">导出数据</span>
        <span class="menu-arrow">›</span>
      </div>
      <div class="menu-item" @click="showImportMode = true">
        <span class="menu-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        </span>
        <span class="menu-label">导入数据</span>
        <span class="menu-arrow">›</span>
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
    <div class="menu-group">
      <div class="menu-item danger" @click="askResetAll">
        <span class="menu-label">重置所有背诵次数</span>
      </div>
    </div>

    <!-- 句子音色选择器（微信 ActionSheet 风格） -->
    <div v-if="showVoiceSheet" class="mask" @click.self="closeVoiceSheet" @touchmove.prevent>
      <div class="voice-sheet">
        <p class="voice-sheet-title">选择句子音色</p>
        <div class="voice-sheet-list">
          <div
            v-for="(v, i) in TTS_VOICES"
            :key="v.voice"
            class="voice-option"
            :class="{ active: v.voice === settings.sentenceVoice }"
            @click="pickVoice(v.voice)"
          >
            <span class="voice-name">{{ v.label }}<span class="voice-desc">{{ v.desc }}</span></span>
            <span class="voice-check" v-if="v.voice === settings.sentenceVoice">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </span>
            <button
              class="voice-preview"
              :class="{ playing: previewVoice === v.voice }"
              @click.stop="previewSpeak(v.voice)"
              :title="`试听 ${v.label}`"
            >
              <span v-if="previewVoice !== v.voice" class="spk-static">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
              </span>
              <span v-else class="spk-eq"><i></i><i></i><i></i></span>
            </button>
          </div>
        </div>
        <button class="voice-cancel" @click="closeVoiceSheet">取消</button>
      </div>
    </div>

    <!-- 确认弹层 -->
    <div v-if="confirmResetAll" class="mask" @click.self="cancelResetAll" @touchmove.prevent>
      <div class="dialog">
        <p class="dialog-title">重置全部背诵次数？</p>
        <p class="dialog-msg">将词句库中全部 {{ totalCount }} 条词句的背诵次数归 0，此操作不可撤销。</p>
        <div class="dialog-btns">
          <button class="dialog-btn" @click="cancelResetAll">取消</button>
          <button class="dialog-btn danger" @click="doResetAll">确定重置</button>
        </div>
      </div>
    </div>

    <!-- 导入方式选择 -->
    <div v-if="showImportMode" class="mask" @click.self="showImportMode = false" @touchmove.prevent>
      <div class="action-sheet">
        <div class="action-sheet-title">选择导入方式</div>
        <button class="action-sheet-btn" @click="chooseImportMode('merge')">合并（跳过重复单词）</button>
        <button class="action-sheet-btn" @click="chooseImportMode('overwrite')">覆盖（清空当前词句库）</button>
        <button class="action-sheet-cancel" @click="showImportMode = false">取消</button>
      </div>
    </div>

    <div v-if="confirmOverwrite" class="mask" @click.self="cancelOverwrite" @touchmove.prevent>
      <div class="dialog">
        <p class="dialog-title">覆盖导入？</p>
        <p class="dialog-msg">将清空当前 {{ totalCount }} 个单词并替换为导入数据，此操作不可撤销。</p>
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
  gap: 8px;
  padding: 8px 0 16px;
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
  touch-action: none;
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

.action-sheet {
  width: 100%;
  background: #f7f7f7;
  border-radius: 12px 12px 0 0;
  overflow: hidden;
}

.action-sheet-title {
  background: #fff;
  padding: 14px;
  text-align: center;
  font-size: 14px;
  color: var(--text-sub);
  border-bottom: 0.5px solid #e5e5e5;
}

.action-sheet-btn {
  display: block;
  width: 100%;
  padding: 14px;
  background: #fff;
  border: none;
  border-bottom: 0.5px solid #e5e5e5;
  font-size: 16px;
  color: var(--text-main);
  cursor: pointer;
  text-align: center;
}

.action-sheet-btn:active { background: #f5f5f5; }

.action-sheet-cancel {
  display: block;
  width: 100%;
  padding: 14px;
  margin-top: 8px;
  background: #fff;
  border: none;
  font-size: 16px;
  color: var(--primary);
  cursor: pointer;
  text-align: center;
}

/* 句子音色选择器（微信 ActionSheet 风格，底部弹层） */
.voice-sheet {
  width: 100%;
  max-width: 480px;
  background: #f7f7f7;
  border-radius: 12px 12px 0 0;
  overflow: hidden;
  align-self: flex-end;
}
.voice-sheet-title {
  background: #fff;
  padding: 14px;
  text-align: center;
  font-size: 14px;
  color: var(--text-sub);
  border-bottom: 0.5px solid #e5e5e5;
  margin: 0;
}
.voice-sheet-list {
  background: #fff;
  max-height: 52vh;
  overflow-y: auto;
}
.voice-option {
  display: flex;
  align-items: center;
  padding: 0 16px;
  height: 52px;
  border-bottom: 0.5px solid #e5e5e5;
  cursor: pointer;
  user-select: none;
}
.voice-option:active { background: #f5f5f5; }
.voice-option.active .voice-name { color: var(--primary); }
.voice-name {
  flex: 1;
  font-size: 16px;
  color: var(--text-main);
}
.voice-desc {
  margin-left: 8px;
  font-size: 12px;
  color: var(--text-sub);
}
.voice-check {
  color: var(--primary);
  display: flex;
  margin-right: 6px;
}
.voice-preview {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: #576b95;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.voice-preview:active { background: #f0f3f8; }
.voice-cancel {
  display: block;
  width: 100%;
  padding: 14px;
  margin-top: 8px;
  background: #fff;
  border: none;
  font-size: 16px;
  color: var(--text-main);
  cursor: pointer;
  text-align: center;
}
.voice-cancel:active { background: #f5f5f5; }
.voice-option .spk-eq { display: inline-flex; align-items: flex-end; gap: 2px; height: 16px; }
.voice-option .spk-eq i {
  width: 3px;
  border-radius: 2px;
  background: #576b95;
  animation: eq-bounce 0.9s ease-in-out infinite;
}
.voice-option .spk-eq i:nth-child(1) { height: 6px; animation-delay: 0s; }
.voice-option .spk-eq i:nth-child(2) { height: 14px; animation-delay: 0.18s; }
.voice-option .spk-eq i:nth-child(3) { height: 9px; animation-delay: 0.36s; }
@keyframes eq-bounce {
  0%, 100% { transform: scaleY(0.5); }
  50% { transform: scaleY(1); }
}

.fade-enter-active,
.fade-leave-active { transition: opacity 0.25s; }
.fade-enter-from,
.fade-leave-to { opacity: 0; }

.threshold-input {
  width: 60px;
  text-align: right;
  border: none;
  outline: none;
  font-size: 15px;
  color: var(--primary);
  background: transparent;
}

/* cell 右侧当前值 */
.menu-value {
  margin-left: auto;
  font-size: 14px;
  color: var(--text-sub);
  margin-right: 2px;
}

/* 微信风格开关 */
.menu-switch {
  position: relative;
  width: 51px;
  height: 31px;
  border-radius: 16px;
  background: #e5e5e5;
  transition: background 0.2s;
  flex-shrink: 0;
}

.menu-switch i {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 27px;
  height: 27px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  transition: transform 0.2s;
}

.menu-switch.on {
  background: var(--primary);
}

.menu-switch.on i {
  transform: translateX(20px);
}

.menu-item:active .menu-switch,
.menu-item .menu-switch:active {
  opacity: 0.9;
}
.cell-desc {
  padding: 8px 16px 12px;
  font-size: 13px;
  color: #999;
  line-height: 1.4;
}

/* 微信风格菜单组 */
.menu-group {
  background: #fff;
  margin: 0;
  overflow: hidden;
}
.menu-group:first-child {
  margin-top: 0;
}
.menu-item {
  display: flex;
  align-items: center;
  padding: 14px 16px;
  cursor: pointer;
  border-bottom: 0.5px solid #f0f0f0;
  transition: background 0.15s;
}
.menu-item:last-child { border-bottom: none; }
.menu-item:active { background: #f5f5f5; }
.menu-item.danger {
  color: var(--danger);
  justify-content: center;
  padding: 16px;
  font-size: 16px;
}
.menu-item.danger .menu-label {
  color: var(--danger);
  text-align: center;
  flex: none;
}
.menu-icon {
  width: 24px;
  margin-right: 12px;
  color: var(--text-sub);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.menu-label { flex: 1; font-size: 16px; color: var(--text-main); }
.menu-arrow { color: #c8c8c8; font-size: 18px; }
.menu-desc {
  padding: 4px 16px 14px;
  font-size: 13px;
  color: var(--text-sub);
}
</style>
