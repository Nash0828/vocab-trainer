<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { useWords, refreshAll } from '../composables/useWords'
import { api } from '../api/index.js'
import { defineOptions } from 'vue'

defineOptions({ name: 'InputView' })

const { words, addWord, checkDuplicate } = useWords()
const saving = ref(false)
const showExampleTip = ref(false)
const showPhraseTip = ref(false)
const showLinkWordTip = ref(false)
const showLinkPhraseTip = ref(false)

const form = reactive({
  chinese: '',
  english: '',
  type: 'word',
  pos: '',
  caseSensitive: false,
  remark: '',
  phrases: [],
  examples: [''],
  linkWords: [],
  linkPhrases: [],
})

const typeOptions = [
  { value: 'word', label: '单词' },
  { value: 'phrase', label: '短语' },
  { value: 'sentence', label: '句子' },
]
const showTypePicker = ref(false)
// 备注：初始单行高度，聚焦后展开为多行
const remarkFocused = ref(false)
function pickType(t) {
  form.type = t
  form.linkWords = []
  form.linkPhrases = []
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
  showPhraseTip.value = false
  showLinkWordTip.value = false
  showLinkPhraseTip.value = false
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
function duplicateTip() {  const dup = checkDuplicate({ chinese: form.chinese, english: form.english })
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
  // 带例句/相关短语/关联词：先端保存（AI 包含校验 + 查重 + AI 翻译 + 自动入库 + 关联词解析），成功后再写入本地
  const exList = form.examples.map((x) => String(x || '').trim()).filter(Boolean)
  const phList = form.phrases.map((x) => String(x || '').trim()).filter(Boolean)
  const linkWordList = form.linkWords.map((x) => String(x || '').trim()).filter(Boolean)
  const linkPhraseList = form.linkPhrases.map((x) => String(x || '').trim()).filter(Boolean)
  if (exList.length || phList.length || linkWordList.length || linkPhraseList.length) {
    saving.value = true
    try {
      const real = await api.addWord({
        chinese: form.chinese.trim(),
        english: form.english.trim(),
        pos: form.pos.trim(),
        type: form.type,
        caseSensitive: form.caseSensitive,
        remark: form.remark.trim(),
        phrases: phList,
        examples: exList,
        linkWords: linkWordList,
        linkPhrases: linkPhraseList,
      })
      words.value.push({ ...real, count: 0 })
      showTip(`已保存：${real.english}（${real.chinese}）`, 'ok')
      resetForm()
      refreshAll() // 刷新关联词句的反向可见性（如该词被关联为相关短语/例句）
    } catch (err) {
      const msg = err.code === 'TRANSLATE_FAIL' ? '翻译失败，请稍后重试'
        : err.code === 'EXAMPLE_NOT_CONTAIN' ? '相关短语/例句需包含当前单词（含变形形式）'
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
  form.remark = ''
  form.phrases = []
  form.examples = ['']
  form.linkWords = []
  form.linkPhrases = []
  posInput.value = ''
}

function clearAllFields() {
  form.chinese = ''
  form.english = ''
  form.type = 'word'
  form.pos = ''
  form.remark = ''
  form.phrases = []
  form.examples = ['']
  form.linkWords = []
  form.linkPhrases = []
}

// 例句/相关短语：最多5条
function addExample() {
  if (form.examples.length >= 5) return
  form.examples.push('')
}
function removeExample(i) {
  form.examples.splice(i, 1)
}
function addPhrase() {
  if (form.phrases.length >= 5) return
  form.phrases.push('')
}
function removePhrase(i) {
  form.phrases.splice(i, 1)
}
// 主动关联（短语/句子的关联单词、句子的关联短语）：默认不显示输入框，点按钮添加，最多5条
function addLinkWord() {
  if (form.linkWords.length >= 5) return
  form.linkWords.push('')
}
function removeLinkWord(i) {
  form.linkWords.splice(i, 1)
}
function addLinkPhrase() {
  if (form.linkPhrases.length >= 5) return
  form.linkPhrases.push('')
}
function removeLinkPhrase(i) {
  form.linkPhrases.splice(i, 1)
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
          <label><em class="req">*</em>中文</label>
          <input
            v-if="form.type !== 'sentence'"
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
          <label><em class="req">*</em>英文</label>
          <input
            v-if="form.type !== 'sentence'"
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
        <!-- 备注：label 常显，输入框初始单行高度，聚焦后展开为多行 -->
        <div v-if="form.type === 'word'" class="form-item">
          <label>备注</label>
          <textarea
            v-model="form.remark"
            class="remark-area"
            :class="{ expanded: remarkFocused || form.remark }"
            placeholder="补充说明（选填）"
            autocomplete="off"
            maxlength="500"
            @focus="remarkFocused = true"
            @blur="remarkFocused = false"
            @keydown.ctrl.enter.prevent="submit"
            @keydown.meta.enter.prevent="submit"
          ></textarea>
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
        <div v-if="form.type !== 'word'" class="form-item">
          <label>备注</label>
          <textarea
            v-model="form.remark"
            class="remark-area"
            :class="{ expanded: remarkFocused || form.remark }"
            placeholder="补充说明（选填）"
            autocomplete="off"
            maxlength="500"
            @focus="remarkFocused = true"
            @blur="remarkFocused = false"
            @keydown.ctrl.enter.prevent="submit"
            @keydown.meta.enter.prevent="submit"
          ></textarea>
        </div>
        <div v-if="form.type === 'word'" class="form-item ex-item">
          <label>
            相关短语
            <span class="ex-help" @click.stop="showPhraseTip = !showPhraseTip">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#b2b2b2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <transition name="fade">
                <div v-if="showPhraseTip" class="ex-tip">保存时将自动翻译成中文并作为短语加入词句库，最多可添加5条</div>
              </transition>
            </span>
          </label>
          <div v-for="(ph, i) in form.phrases" :key="'ph' + i" class="ex-row">
            <input
              v-model="form.phrases[i]"
              type="text"
              :placeholder="`短语${i + 1}`"
              autocomplete="off"
            />
            <button class="ex-del" type="button" @click="removePhrase(i)" title="删除该短语">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <button v-if="form.phrases.length < 5" type="button" class="ex-add" @click="addPhrase">+ 添加短语</button>
        </div>
        <div v-if="form.type !== 'sentence'" class="form-item ex-item">
          <label>
            例句
            <span class="ex-help" @click.stop="showExampleTip = !showExampleTip">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#b2b2b2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <transition name="fade">
                <div v-if="showExampleTip" class="ex-tip">保存时将自动翻译成中文并作为句子加入词句库，最多可添加5条</div>
              </transition>
            </span>
          </label>
          <div v-for="(ex, i) in form.examples" :key="i" class="ex-row">
            <textarea
              v-model="form.examples[i]"
              rows="2"
              :placeholder="`例句${i + 1}`"
              autocomplete="off"
            ></textarea>
            <button class="ex-del" type="button" @click="removeExample(i)" title="删除该例句">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <button v-if="form.examples.length < 5" type="button" class="ex-add" @click="addExample">+ 添加例句</button>
        </div>
        <div v-if="form.type !== 'word'" class="form-item ex-item">
          <label>
            关联单词
            <span class="ex-help" @click.stop="showLinkWordTip = !showLinkWordTip">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#b2b2b2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <transition name="fade">
                <div v-if="showLinkWordTip" class="ex-tip">从词句库中关联已有的单词，不存在的将自动忽略</div>
              </transition>
            </span>
          </label>
          <div v-for="(lw, i) in form.linkWords" :key="'lw' + i" class="ex-row">
            <input
              v-model="form.linkWords[i]"
              type="text"
              :placeholder="`关联单词${i + 1}`"
              autocomplete="off"
            />
            <button class="ex-del" type="button" @click="removeLinkWord(i)" title="删除该关联">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <button v-if="form.linkWords.length < 5" type="button" class="ex-add" @click="addLinkWord">+ 添加关联单词</button>
        </div>
        <div v-if="form.type === 'sentence'" class="form-item ex-item">
          <label>
            关联短语
            <span class="ex-help" @click.stop="showLinkPhraseTip = !showLinkPhraseTip">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#b2b2b2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <transition name="fade">
                <div v-if="showLinkPhraseTip" class="ex-tip">从词句库中关联已有的短语，不存在的将自动忽略</div>
              </transition>
            </span>
          </label>
          <div v-for="(lp, i) in form.linkPhrases" :key="'lp' + i" class="ex-row">
            <input
              v-model="form.linkPhrases[i]"
              type="text"
              :placeholder="`关联短语${i + 1}`"
              autocomplete="off"
            />
            <button class="ex-del" type="button" @click="removeLinkPhrase(i)" title="删除该关联">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <button v-if="form.linkPhrases.length < 5" type="button" class="ex-add" @click="addLinkPhrase">+ 添加关联短语</button>
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

/* 必填标记：微信风格红色星号 */
.form-item label .req {
  color: #fa5151;
  font-style: normal;
  font-weight: 400;
  margin-right: 2px;
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
  /* 覆盖 .form-item 的横向 flex：例句框纵向堆叠 */
  flex-direction: column;
  align-items: stretch;
}
.ex-item label {
  width: auto;
  margin-bottom: 10px;
}
/* 多条例句：每条输入框右侧带删除按钮（微信风格） */
.ex-row {
  position: relative;
  margin-bottom: 10px;
}
.ex-row textarea,
.ex-row input {
  width: 100%;
  padding-right: 34px;
  box-sizing: border-box;
}
.ex-row input {
  height: 40px;
}
.ex-del {
  position: absolute;
  top: 8px;
  right: 6px;
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  color: #b2b2b2;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.ex-del:active {
  background: #f2f2f2;
}
.ex-add {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  color: #576b95;
  font-size: 14px;
  padding: 6px 2px;
  cursor: pointer;
}
.remark-plus {
  font-size: 15px;
  line-height: 1;
  font-weight: 500;
}
/* 备注输入框：初始与普通 input 同高，聚焦或有内容时展开为多行 */
.remark-area {
  width: 100%;
  box-sizing: border-box;
  height: 36px;
  min-height: 36px;
  padding: 8px 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
  line-height: 1.4;
  outline: none;
  background: #fff;
  resize: none;
  overflow-y: hidden;
  transition: height 0.18s ease;
}
.remark-area.expanded {
  height: 76px;
  min-height: 76px;
}
.remark-area:focus {
  border-color: #576b95;
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
  bottom: calc(100% + 6px); /* 气泡底边距图标 6px，三角伸出后仍留 2px 间隙 */
  left: -34px; /* 气泡左缘贴到表单左侧内边距 16px */
  z-index: 20;
  width: 280px;
  padding: 8px 10px;
  background: #fff;
  border: none;
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  font-size: 12px;
  color: #333;
  line-height: 1.6;
}
/* 实心白三角：与气泡同色无描边，从气泡底边伸出，完全融为一体 */
.ex-tip::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 38px; /* 三角中心=38+4=42，页面位置=16+42=58px，对准图标中心57.5 */
  border: 4px solid transparent;
  border-top-color: #fff;
  z-index: 22;
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

/* 遮罩：进入时视觉上瞬间遮盖（opacity 恒 1，无淡入），
   但保留 0.25s 的 transition 时长声明——Vue 靠根元素的 transition 时长决定何时移除过渡类，
   遮罩必须有足够时长，面板的上滑动画才有时间播完 */
.sheet-mask.sheet-enter-active { transition: opacity 0.25s; }
.sheet-mask.sheet-enter-from { opacity: 1; }
/* 关闭：遮罩淡出 */
.sheet-mask.sheet-leave-active { transition: opacity 0.25s; }
.sheet-mask.sheet-leave-to { opacity: 0; }
/* 面板：独立上滑/下滑；forwards 保持终态，避免动画结束后回弹原位闪现 */
.sheet-enter-active .sheet { animation: sheet-up 0.25s ease forwards; }
.sheet-leave-active .sheet { animation: sheet-down 0.25s ease forwards; }
@keyframes sheet-up {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
@keyframes sheet-down {
  from { transform: translateY(0); }
  to { transform: translateY(100%); }
}



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
