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
  <section class="card">
    <div class="card-head">
      <h2>✍️ 录入新单词</h2>
      <p class="muted">填写中文、英文和词性，保存后即可在「背单词」中练习</p>
    </div>

    <form class="word-form" @submit.prevent="submit">
      <div class="form-row">
        <label for="chinese">中文释义 <em>*</em></label>
        <input
          id="chinese"
          v-model="form.chinese"
          type="text"
          placeholder="例如：苹果"
          autocomplete="off"
        />
      </div>

      <div class="form-row">
        <label for="english">英文单词 <em>*</em></label>
        <input
          id="english"
          v-model="form.english"
          type="text"
          placeholder="例如：apple"
          autocomplete="off"
        />
      </div>

      <div class="form-row">
        <label for="pos">词性</label>
        <input
          id="pos"
          v-model="form.pos"
          type="text"
          list="pos-options"
          placeholder="例如：n.（可手输或从列表选择）"
          autocomplete="off"
        />
        <datalist id="pos-options">
          <option v-for="opt in posOptions" :key="opt" :value="opt" />
        </datalist>
      </div>

      <transition name="fade">
        <p v-if="showMessage && message" class="tip" :class="message.kind">{{ message.text }}</p>
      </transition>

      <div class="form-actions">
        <button type="button" class="btn ghost" @click="clearAllFields">清空</button>
        <button type="submit" class="btn primary">保存单词</button>
      </div>
    </form>

    <div class="card-foot muted">
      当前词库共 <strong>{{ wordCount }}</strong> 个单词
    </div>
  </section>
</template>

<style scoped>
.word-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin-top: 18px;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.form-row label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-main);
}

.form-row label em {
  color: var(--danger);
  font-style: normal;
}

.form-row input {
  padding: 11px 14px;
  border: 1.5px solid var(--border);
  border-radius: 10px;
  font-size: 16px;
  color: var(--text-main);
  background: #ffffff;
  transition: border-color 0.2s, box-shadow 0.2s;
  outline: none;
}

.form-row input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(74, 144, 217, 0.15);
}

.tip {
  padding: 10px 14px;
  border-radius: 10px;
  background: #fff7e6;
  border: 1px solid #ffd591;
  color: #ad6800;
  font-size: 14px;
}

.tip.ok {
  background: #e8f7ee;
  border-color: #a8dcc0;
  color: #1f7a4d;
}

.tip.err {
  background: #fdecea;
  border-color: #f2b8b1;
  color: #b3402f;
  font-weight: 600;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 4px;
}

.card-foot {
  margin-top: 22px;
  padding-top: 14px;
  border-top: 1px dashed var(--border);
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
  .word-form {
    gap: 14px;
  }

  .form-actions {
    flex-direction: column-reverse;
    gap: 10px;
  }

  .form-actions .btn {
    width: 100%;
  }
}
</style>
