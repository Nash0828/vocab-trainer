<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { useWords } from '../composables/useWords'
import { api } from '../api/index.js'

const { words, addWord, checkDuplicate } = useWords()
const saving = ref(false)
const showExampleTip = ref(false)

const form = reactive({
  chinese: '',
  english: '',
  type: 'word',
  pos: '',
  caseSensitive: false,
  example: '',
})

const typeOptions = [
  { value: 'word', label: '单词' },
  { value: 'phrase', label: '短语' },
  { value: 'sentence', label: '句子' },
]
const showTypePicker = ref(false)
function pickType(t) {
  form.type = t
  showTypePicker.value = false
}

const posOptions = ['n.', 'v.', 'adj.', 'adv.', 'prep.', 'pron.', 'conj.', 'num.', 'art.']
const showPosPicker = ref(false)
const posInput = ref('')
const selectedPos = ref([])

// 多选词性：始终显示全部选项，不匹配用户输入
const filteredPosOptions = computed(() => posOptions)

function syncSelectedFromInput() {
  const parts = posInput.value.trim().split(/\s+/).filter(Boolean)
  selectedPos.value = posOptions.filter((o) => parts.includes(o))
}

function onPosFocus() {
  posInput.value = form.pos
  syncSelectedFromInput()
  showPosPicker.value = true
}

function togglePos(opt) {
  const idx = selectedPos.value.indexOf(opt)
  if (idx >= 0) {
    selectedPos.value.splice(idx, 1)
  } else {
    selectedPos.value.push(opt)
  }
  form.pos = selectedPos.value.join(' ')
  posInput.value = form.pos
}

function closePosPicker() {
  showPosPicker.value = false
  showExampleTip.value = false
}
onMounted(() => document.addEventListener('click', closePosPicker))
onUnmounted(() => document.removeEventListener('click', closePosPicker))

const message = ref(null) // { text, kind: 'warn' | 'ok' | 'err' }
const showMessage = ref(false)
let messageTimer = null

const wordCount = computed(() => words.value.length)

function showTip(text, kind = 'warn') {
  message.value = { text, kind }
  showMessage.value = true
  clearTimeout(messageTimer)
  messageTimer = setTimeout(() => {
    showMessage.value = false
  }, 3200)
}

function validate() {
  if (!form.chinese.trim()) {
    showTip('请填写中文')
    return false
  }
  if (!form.english.trim()) {
    showTip('请填写英文')
    return false
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9\s.,!?;:'"()\-’'']*$/.test(form.english.trim())) {
    showTip('英文只允许字母、数字、空格和常见标点')
    return false
  }
  return true
}

// 重复校验：中文/英文与词句库已有条目重复时阻止提交，并区分提示
function duplicateTip() {
  const dup = checkDuplicate({ chinese: form.chinese, english: form.english })
  const parts = []
  if (dup.duplicateChinese) parts.push(`中文「${form.chinese.trim()}」`)
  if (dup.duplicateEnglish) parts.push(`英文「${form.english.trim()}」`)
  if (!parts.length) return null
  return `⛔ ${parts.join(' 与 ')}已在词句库中，不能重复录入`
}

async function submit() {
  if (saving.value) return
  if (!validate()) return
  const dupMsg = duplicateTip()
  if (dupMsg) {
    showTip(dupMsg, 'err')
    return
  }
  // 带例句：先端保存（查重 + AI 翻译 + 例句自动入库），成功后再写入本地
  const ex = (form.example || '').trim()
  if (ex) {
    saving.value = true
    try {
      const real = await api.addWord({
        chinese: form.chinese.trim(),
        english: form.english.trim(),
        pos: form.pos.trim(),
        type: form.type,
        caseSensitive: form.caseSensitive,
        example: ex,
      })
      words.value.push({ ...real, count: 0 })
      showTip(`已保存：${real.english}（${real.chinese}）`, 'ok')
      resetForm()
    } catch (err) {
      const msg = err.code === 'TRANSLATE_FAIL' ? '例句翻译失败，请稍后重试'
        : '保存失败，请检查输入'
      showTip(msg, 'err')
    } finally {
      saving.value = false
    }
    return
  }
  const word = addWord({ ...form })
  if (word) {
    showTip(`已保存：${word.english}（${word.chinese}）`, 'ok')
    resetForm()
  } else {
    showTip('保存失败，请检查输入')
  }
}

function resetForm() {
  form.chinese = ''
  form.english = ''
  form.type = 'word'
  form.pos = ''
  form.caseSensitive = false
  form.example = ''
  posInput.value = ''
}

function clearAllFields() {
  form.chinese = ''
  form.english = ''
  form.type = 'word'
  form.pos = ''
  form.example = ''
}
</script>

<template>
  <div class="input-view">
    <form class="word-form" @submit.prevent="submit">
      <div class="form-group">
        <div class="form-item">
          <label>类型</label>
          <div class="type-row" @click="showTypePicker = true">
            <span class="type-value" :class="{ placeholder: !form.type }">
              {{ typeOptions.find((o) => o.value === form.type)?.label || '请选择' }}
            </span>
            <svg class="type-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#b2b2b2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
        </div>
        <div class="form-item">
          <label>中文</label>
          <input
            v-if="form.type === 'word'"
            v-model="form.chinese"
            type="text"
            placeholder="请输入中文"
            autocomplete="off"
            @keydown.ctrl.enter.prevent="submit"
            @keydown.meta.enter.prevent="submit"
          />
          <textarea
            v-else
            v-model="form.chinese"
            rows="2"
            placeholder="请输入中文"
            autocomplete="off"
            @keydown.ctrl.enter.prevent="submit"
            @keydown.meta.enter.prevent="submit"
          ></textarea>
        </div>
        <div class="form-item">
          <label>英文</label>
          <input
            v-if="form.type === 'word'"
            v-model="form.english"
            type="text"
            placeholder="请输入英文"
            autocomplete="off"
            @keydown.ctrl.enter.prevent="submit"
            @keydown.meta.enter.prevent="submit"
          />
          <textarea
            v-else
            v-model="form.english"
            rows="2"
            placeholder="请输入英文"
            autocomplete="off"
            @keydown.ctrl.enter.prevent="submit"
            @keydown.meta.enter.prevent="submit"
          ></textarea>
        </div>
        <template v-if="form.type === 'word'">
        <div class="form-item">
          <label>词性</label>
          <div class="pos-row" style="position: relative;" @click.stop>
            <input
              v-model="form.pos"
              type="text"
              placeholder="如 n. / v. / adj."
              autocomplete="off"
              @focus="onPosFocus"
              @input="posInput = form.pos"
            />
            <transition name="fade">
              <div v-if="showPosPicker && filteredPosOptions.length > 0" class="pos-suggest">
                <div
                  v-for="opt in filteredPosOptions"
                  :key="opt"
                  class="pos-suggest-item"
                  :class="{ active: selectedPos.includes(opt) }"
                  @click="togglePos(opt)"
                >
                  <span>{{ opt }}</span>
                  <span v-if="selectedPos.includes(opt)" class="pos-check">✓</span>
                </div>
              </div>
            </transition>
          </div>
        </div>
        <div class="form-item">
          <label>区分大小写</label>
          <div class="switch-row">
            <div class="switch" :class="{ on: form.caseSensitive }" @click="form.caseSensitive = !form.caseSensitive">
              <div class="switch-knob"></div>
            </div>
          </div>
        </div>
        </template>
        <div v-if="form.type !== 'sentence'" class="form-item ex-item">
          <label>
            例句
            <span class="ex-help" @click.stop="showExampleTip = !showExampleTip">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#b2b2b2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <transition name="fade">
                <div v-if="showExampleTip" class="ex-tip">保存时将自动翻译成中文并作为句子加入词句库</div>
              </transition>
            </span>
          </label>
          <textarea
            v-model="form.example"
            rows="2"
            placeholder="输入一个包含该词/短语的英文例句"
            autocomplete="off"
          ></textarea>
        </div>
      </div>

      <!-- 类型选择底部弹层 -->
      <transition name="sheet">
        <div v-if="showTypePicker" class="sheet-mask" @click.self="showTypePicker = false" @touchmove.prevent>
          <div class="sheet" @touchmove.stop>
            <div class="sheet-title">选择类型</div>
            <div class="sheet-options">
              <div
                v-for="opt in typeOptions"
                :key="opt.value"
                class="sheet-option"
                :class="{ active: form.type === opt.value }"
                @click="pickType(opt.value)"
              >
                {{ opt.label }}
              </div>
            </div>
            <div class="sheet-cancel" @click="showTypePicker = false">取消</div>
          </div>
        </div>
      </transition>

      <transition name="fade">
        <p v-if="showMessage && message" class="tip" :class="message.kind">{{ message.text }}</p>
      </transition>

      <div class="form-actions">
        <button type="submit" class="btn primary" :disabled="saving">{{ saving ? '保存中…' : '保存' }}</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.input-view {
  padding: 8px 0 16px;
}

.form-group {
  background: #fff;
  margin: 0 16px;
  border-radius: 12px;
}

.form-item {
  display: flex;
  align-items: flex-start;
  padding: 12px 16px;
  position: relative;
}

.form-item + .form-item::before {
  content: '';
  position: absolute;
  left: 16px;
  top: 0;
  height: 0.5px;
  background: #e5e5e5;
}

.form-item label {
  width: 84px;
  font-size: 15px;
  color: var(--text-main);
  flex-shrink: 0;
  line-height: 1.5;
  padding-top: 6px;
}

.form-item input,
.form-item textarea {
  flex: 1;
  border: none;
  outline: none;
  font-size: 15px;
  color: var(--text-main);
  background: transparent;
  padding: 4px 0;
}

.form-item textarea {
  min-height: 60px;
  resize: none;
  line-height: 1.5;
  font-family: inherit;
  box-sizing: border-box;
}

.form-item input::placeholder,
.form-item textarea::placeholder {
  color: #b2b2b2;
}

.form-item .optional {
  color: #b2b2b2;
  font-size: 12px;
  font-weight: 400;
  margin-left: 4px;
}

/* 例句帮助：icon + tooltip */
.ex-item {
  position: relative;
}
.ex-help {
  position: relative;
  display: inline-flex;
  align-items: center;
  margin-left: 4px;
  cursor: pointer;
  vertical-align: -2px;
}
.ex-tip {
  position: absolute;
  bottom: calc(100% + 4px); /* 贴紧图标上方 4px */
  left: -34px; /* 气泡左缘贴到表单左侧内边距 16px */
  z-index: 20;
  width: 280px;
  padding: 8px 10px;
  background: #fff;
  border: 1px solid #e5e5e5;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
  font-size: 12px;
  color: #333;
  line-height: 1.6;
}
.ex-tip::before {
  content: '';
  position: absolute;
  bottom: -3px;
  left: 38px; /* 箭头中心=38+4=42，页面位置=16+42=58px，对准图标中心57.5 */
  width: 8px;
  height: 8px;
  background: #fff;
  border-right: 1px solid #e5e5e5;
  border-bottom: 1px solid #e5e5e5;
  transform: rotate(45deg);
}

.pos-row {
  display: flex;
  align-items: center;
}
.pos-row input {
  width: 100%;
  border: none;
  outline: none;
  font-size: 15px;
  color: var(--text-main);
  background: transparent;
  padding: 4px 0;
}

.type-row {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
  cursor: pointer;
}
.type-value {
  font-size: 15px;
  color: var(--text-main);
}
.type-value.placeholder {
  color: #b2b2b2;
}
.type-arrow {
  flex-shrink: 0;
}

.pos-suggest {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 100;
  margin-top: 4px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  overflow: hidden;
  max-height: 220px;
  overflow-y: auto;
}
.pos-suggest-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  font-size: 14px;
  background: #fff;
  border-bottom: 1px solid #f0f0f0;
}
.pos-suggest-item.active { color: var(--primary); }
.pos-check {
  color: var(--primary);
  font-size: 15px;
  font-weight: 600;
}
.pos-suggest-empty {
  padding: 10px 12px;
  font-size: 13px;
  color: #999;
  background: #fff;
  text-align: center;
}

.sheet-mask {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 1000;
  display: flex;
  align-items: flex-end;
}
.sheet {
  width: 100%;
  background: #f7f7f7;
  border-radius: 12px 12px 0 0;
  padding-bottom: env(safe-area-inset-bottom);
}
.sheet-title {
  text-align: center;
  padding: 14px;
  font-size: 16px;
  font-weight: 500;
  background: #fff;
  border-bottom: 1px solid #e5e5e5;
}
.sheet-options {
  background: #fff;
  max-height: 50vh;
  overflow-y: auto;
}
.sheet-option {
  padding: 14px;
  text-align: center;
  font-size: 16px;
  border-bottom: 1px solid #f0f0f0;
}
.sheet-option.active { color: var(--primary); }
.sheet-cancel {
  margin-top: 8px;
  padding: 14px;
  text-align: center;
  font-size: 16px;
  background: #fff;
}

.sheet-enter-active, .sheet-leave-active { transition: transform 0.25s ease; }
.sheet-enter-from, .sheet-leave-to { transform: translateY(100%); }
.sheet-mask.fade-enter-active, .sheet-mask.fade-leave-active { transition: opacity 0.25s; }
.sheet-mask.fade-enter-from, .sheet-mask.fade-leave-to { opacity: 0; }



.form-actions {
  margin: 16px;
}
.form-actions .btn {
  width: 100%;
}

.fade-enter-active, .fade-leave-active { transition: opacity 0.25s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 1;
}
.switch-desc {
  font-size: 13px;
  color: #999;
}
.switch {
  position: relative;
  width: 50px;
  height: 30px;
  border-radius: 30px;
  background-color: #ccc;
  transition: background-color 0.3s;
  cursor: pointer;
  flex-shrink: 0;
}
.switch.on {
  background-color: var(--primary);
}
.switch-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background-color: #fff;
  transition: left 0.3s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
.switch.on .switch-knob {
  left: 22px;
}
</style>
