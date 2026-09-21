<script setup>
import { ref, reactive, computed } from 'vue'
import { useWords } from '../composables/useWords'

const { words, addWord, checkDuplicate } = useWords()

const form = reactive({
  chinese: '',
  english: '',
  pos: '',
})

const posOptions = ['n.', 'v.', 'adj.', 'adv.', 'prep.', 'pron.', 'conj.', 'num.', 'art.', '其他']

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
          <input
            v-model="form.pos"
            type="text"
            list="pos-options"
            placeholder="如 n. / v. / adj."
            autocomplete="off"
          />
          <datalist id="pos-options">
            <option v-for="opt in posOptions" :key="opt" :value="opt" />
          </datalist>
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
  overflow: hidden;
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
  width: 70px;
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
</style>
