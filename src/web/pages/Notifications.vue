<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { NotificationRow } from '../../shared/types'
import UserAvatar from '../components/UserAvatar.vue'
import { loadNotifications, markNotificationsRead, notifications } from '../store'

const router = useRouter()
const loading = ref(true)

onMounted(async () => {
  await loadNotifications()
  loading.value = false
})

const time = (iso: string): string => iso.replace('T', ' ').slice(0, 16)

/** Notifications carry their target; the server decided which one it is. */
async function open(n: NotificationRow): Promise<void> {
  if (!n.readAt) void markNotificationsRead([n.id])
  if (n.dmThreadId) await router.push(`/messages/${n.dmThreadId}`)
  else if (n.threadId) await router.push(`/t/${n.threadId}`)
}
</script>

<template>
  <div class="page">
    <div class="toolbar feed-head">
      <h1 class="notif-title">通知</h1>
      <span class="feed-count muted">{{ notifications.unread }} 条未读</span>
      <span class="spacer"></span>
      <button
        v-if="notifications.unread"
        class="btn btn-sm"
        type="button"
        @click="markNotificationsRead()"
      >
        全部标为已读
      </button>
    </div>

    <div v-if="loading" class="empty">加载中…</div>
    <div v-else-if="!notifications.items.length" class="empty">
      还没有通知。有人回复、提到你或赞你时，会出现在这里。
    </div>

    <div v-else class="notif-list card">
      <button
        v-for="n in notifications.items"
        :key="n.id"
        class="notif-row"
        type="button"
        :class="{ unread: !n.readAt }"
        @click="open(n)"
      >
        <UserAvatar v-if="n.actor" :user="n.actor" :size="32" />
        <span class="notif-row-main">
          <span class="notif-row-body">{{ n.body }}</span>
          <span v-if="n.excerpt" class="notif-row-excerpt">{{ n.excerpt }}</span>
          <span class="notif-row-time">{{ time(n.createdAt) }}</span>
        </span>
        <span v-if="!n.readAt" class="notif-dot" aria-label="未读"></span>
      </button>
    </div>
  </div>
</template>
