<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../api/index.js'

const list = ref([])
const loading = ref(true)
const error = ref('')

function fmtTime(ts) {
  const d = new Date(ts)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

onMounted(async () => {
  try {
    const res = await api.getFeedbacks()
    list.value = res.feedbacks
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="feedback-page">
    <div v-if="loading" class="muted">加载中...</div>
    <div v-else-if="error" class="error">{{ error }}</div>
    <div v-else-if="list.length === 0" class="empty-state">
      <div class="empty-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#c8c8c8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      </div>
      <p class="empty-title">暂无反馈</p>
    </div>
    <div v-else class="feedback-list">
      <div v-for="f in list" :key="f.id" class="feedback-item">
        <div class="feedback-meta">
          <span class="feedback-user">{{ f.username || '访客' }}</span>
          <span class="feedback-time">{{ fmtTime(f.created_at) }}</span>
        </div>
        <div class="feedback-content">{{ f.content }}</div>
        <div v-if="f.contact" class="feedback-contact">联系方式：{{ f.contact }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.feedback-page {
  padding: 8px 0 16px;
}
.empty-state {
  background: #fff;
  margin: 8px 16px;
  border-radius: 12px;
  padding: 48px 20px;
  text-align: center;
}
.empty-icon {
  margin-bottom: 12px;
}
.empty-title {
  color: #666;
  font-size: 15px;
}
.feedback-list {
  background: #fff;
  margin: 8px 16px;
  border-radius: 12px;
  overflow: hidden;
}
.feedback-item {
  padding: 14px 16px;
  border-bottom: 1px solid #f0f0f0;
}
.feedback-item:last-child {
  border-bottom: none;
}
.feedback-meta {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #999;
  margin-bottom: 6px;
}
.feedback-user {
  font-weight: 500;
  color: #333;
}
.feedback-content {
  font-size: 15px;
  color: #333;
  line-height: 1.5;
}
.feedback-contact {
  font-size: 12px;
  color: #666;
  margin-top: 6px;
}
.muted {
  text-align: center;
  padding: 30px;
  color: #999;
}
.error {
  text-align: center;
  padding: 30px;
  color: #fa5151;
}
</style>
