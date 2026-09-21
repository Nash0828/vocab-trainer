<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { useWords } from '../composables/useWords'

const { words, addWord, checkDuplicate } = useWords()

const form = reactive({
  chinese: '',
  english: '',
  pos: '',
  caseSensitive: false,
})

const posOptions = ['n.', 'v.', 'adj.', 'adv.', 'prep.', 'pron.', 'conj.', 'num.', 'art.', '其他']
const showPosPicker = ref(false)
const posInput = ref('')
const filteredPosOptions = computed(() => {
  const q = posInput.value.trim().toLowerCase()
  if (!q) return posOptions
  return posOptions.filter(o => o.toLowerCase().includes(q))
})

function closePosPicker() {
  showPosPicker.value = false
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
    showTip('⚠️ 请填写中文释义')
    return false
  }
  if (!form.english.trim()) {
    showTip('⚠️ 请填写英文单词')
    return false
  }
  if (!/^[A-Za-z][A-Za-z\s\-'’]*$/.test(form.english.trim())) {
    showTip('⚠️ 英文单词只允许字母（可含空格、连字符）')
    return false
  }
  return true
}

// 重复校验：中文/英文与词库已有条目重复时阻止提交，并区分提示
function duplicateTip() {
  const dup = checkDuplicate({ chinese: form.chinese, english: form.english })
  const parts = []
  if (dup.duplicateChinese) parts.push(`中文释义「${form.chinese.trim()}」`)
  if (dup.duplicateEnglish) parts.push(`英文单词「${form.english.trim()}」`)
  if (!parts.length) return null
  return `⛔ ${parts.join(' 与 ')}已在词库中，不能重复录入`
}

function submit() {
  if (!validate()) return
  const dupMsg = duplicateTip()
  if (dupMsg) {
    showTip(dupMsg, 'err')
    return
  }
  const word = addWord({ ...form })
  if (word) {
    showTip(`✅ 已保存：${word.english}（${word.chinese}）`, 'ok')
    form.chinese = ''
    form.english = ''
    form.pos = ''
  } else {
    showTip('⚠️ 保存失败，请检查输入')
  }
}

function clearAllFields() {
  form.chinese = ''
  form.english = ''
  form.pos = ''
}
</script>

<template>
  <div class="input-view">
    <form class="word-form" @submit.prevent="submit">
      <div class="form-group">
        <div class="form-item">
          <label>中文释义</label>
          <input
            v-model="form.chinese"
            type="text"
            placeholder="请输入中文释义"
            autocomplete="off"
          />
        </div>
        <div class="form-item">
          <label>英文单词</label>
          <input
            v-model="form.english"
            type="text"
            placeholder="请输入英文单词"
            autocomplete="off"
          />
        </div>
        <div class="form-item">
          <label>词性</label>
          <div class="pos-row" style="position: relative;" @click.stop>
            <input
              v-model="form.pos"
              type="text"
              placeholder="如 n. / v. / adj."
              autocomplete="off"
              @focus="showPosPicker = true"
              @input="posInput = form.pos"
            />
            <transition name="fade">
              <div v-if="showPosPicker && filteredPosOptions.length > 0" class="pos-suggest">
                <div
                  v-for="opt in filteredPosOptions"
                  :key="opt"
                  class="pos-suggest-item"
                  :class="{ active: form.pos === opt }"
                  @click="form.pos = opt; showPosPicker = false"
                >{{ opt }}</div>
              </div>
            </transition>
          </div>
        </div>
        <div class="form-item">
          <label>区分大小写</label>
          <div class="switch-row">
            <label class="switch">
              <input type="checkbox" v-model="form.caseSensitive" />
              <span class="slider"></span>
            </label>
          </div>
        </div>
      </div>

      <transition name="fade">
        <p v-if="showMessage && message" class="tip" :class="message.kind">{{ message.text }}</p>
      </transition>

      <div class="form-actions">
        <button type="submit" class="btn primary">保存单词</button>
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
  align-items: center;
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
}

.form-item input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 15px;
  color: var(--text-main);
  background: transparent;
  padding: 4px 0;
}

.form-item input::placeholder {
  color: #b2b2b2;
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
  padding: 10px 12px;
  font-size: 14px;
  background: #fff;
  border-bottom: 1px solid #f0f0f0;
}
.pos-suggest-item.active { color: var(--primary); }
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

.tip {
  margin: 10px 16px 0;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 14px;
}

.tip.ok { background: #e8f8ef; color: #07c160; }
.tip.err { background: #fdecec; color: #fa5151; }

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
  display: inline-block;
  width: 51px;
  height: 31px;
  flex-shrink: 0;
}
.switch input {
  position: absolute;
  opacity: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  cursor: pointer;
}
.switch .slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #ccc;
  border-radius: 31px;
  transition: 0.3s;
}
.switch .slider:before {
  position: absolute;
  content: "";
  height: 27px;
  width: 27px;
  left: 2px;
  bottom: 2px;
  background-color: white;
  border-radius: 50%;
  transition: 0.3s;
}
.switch input:checked + .slider {
  background-color: var(--primary);
}
.switch input:checked + .slider:before {
  transform: translateX(20px);
}
</style>
