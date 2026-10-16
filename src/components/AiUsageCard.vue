<script setup>
import { ref, computed, onMounted } from 'vue'

const props = defineProps({
  word: { type: String, required: true },
})

const status = ref('loading') // loading | done | error
const usage = ref('')
const expanded = ref(false)

const hasMore = computed(() => usage.value.length > 80)

async function load() {
  status.value = 'loading'
  try {
    const res = await fetch(`/api/usage?word=${encodeURIComponent(props.word)}`)
    if (!res.ok) throw new Error('AI 查询失败')
    const j = await res.json()
    usage.value = j.usage || ''
    status.value = usage.value ? 'done' : 'error'
  } catch (e) {
    status.value = 'error' // AI 不可用时整个卡片隐藏，不影响词典查询
  }
}

onMounted(load)
</script>

<template>
  <!-- AI 日常用法卡片（微信风格白卡） -->
  <div v-if="status === 'loading'" class="ai-card">
    <p class="ai-label">AI 日常用法</p>
    <p class="ai-loading">释义生成中…</p>
  </div>
  <div v-else-if="status === 'done'" class="ai-card">
    <p class="ai-label">AI 日常用法</p>
    <p class="ai-text" :class="{ clamped: !expanded && hasMore }">{{ usage }}</p>
    <button v-if="hasMore" class="ai-toggle" @click="expanded = !expanded">
      {{ expanded ? '收起' : '展开释义' }}
    </button>
  </div>
</template>

<style scoped>
.ai-card {
  background: #f7f7f7;
  border-radius: 10px;
  padding: 12px 14px;
  margin: 10px 0 16px;
}
.ai-label {
  font-size: 11px;
  color: var(--text-sub);
  margin: 0 0 8px 0;
  font-weight: 500;
}
.ai-loading {
  font-size: 13px;
  color: var(--text-sub);
  margin: 0;
}
.ai-text {
  font-size: 14px;
  line-height: 1.7;
  color: var(--text-main);
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}
.ai-text.clamped {
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.ai-toggle {
  border: none;
  background: transparent;
  color: var(--primary);
  font-size: 13px;
  padding: 0;
  margin-top: 8px;
  cursor: pointer;
}
</style>
