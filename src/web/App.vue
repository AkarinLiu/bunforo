<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import NavBar from './components/NavBar.vue'
import SideNav from './components/SideNav.vue'
import { connectLive, disconnectLive, onLiveEvent } from './events'
import { setup } from './setup'
import {
  auth,
  dmUnread,
  loadDmUnread,
  loadNotifications,
  pushNotification,
  resetRealtimeState,
} from './store'
import type { DmMessageRow, NotificationRow } from '../shared/types'

// Desktop starts with the sidebar open; phones keep it closed until the menu
// button is tapped (it becomes an off-canvas drawer there).
const sidebarOpen = ref(window.innerWidth > 860)

// The first-run wizard owns the whole screen: no header, no sidebar to wander off in.
const route = useRoute()
const isSetup = computed(() => route.name === 'setup')

/** One line under the header for a restricted account. */
const banNote = computed(() => {
  const user = auth.user
  if (!user?.banned) return ''
  const reason = user.banReason ? '理由：' + user.banReason : '未填写理由'
  const until = user.bannedUntil
    ? '至 ' + user.bannedUntil.replace('T', ' ').slice(0, 16)
    : '永久封禁'
  return reason + ' · ' + until
})

// The session guard fills `auth.user` after the first navigation resolves, so
// the live channel and the inbox badges start as soon as it is known.
watch(
  () => auth.user?.id ?? null,
  (id) => {
    if (id) {
      connectLive(id)
      void loadNotifications()
      void loadDmUnread()
    } else {
      disconnectLive()
      resetRealtimeState()
    }
  },
  { immediate: true },
)

onLiveEvent('notification', (data) => pushNotification(data as NotificationRow))

// Unread DM badge. When the recipient is already reading that conversation the
// page marks it read, so counting it first would only cause a flicker.
onLiveEvent('dm:message', (data) => {
  const payload = data as { threadId: number; message: DmMessageRow }
  if (!payload?.message || payload.message.authorId === auth.user?.id) return
  const viewing =
    route.name === 'messages' && Number(route.params.id) === Number(payload.threadId)
  if (!viewing) dmUnread.count += 1
})
</script>

<template>
  <template v-if="!isSetup">
    <NavBar @toggle-menu="sidebarOpen = !sidebarOpen" />
    <div v-if="auth.user?.banned" class="ban-notice">
      <strong>账号已被封禁</strong>
      <span>仅可浏览，且只能与管理员私信 · {{ banNote }}</span>
    </div>
    <div class="app-body">
      <SideNav :open="sidebarOpen" />
      <main class="app-main">
        <router-view />
      </main>
    </div>
    <footer v-if="setup.siteFooter" class="site-footer">{{ setup.siteFooter }}</footer>
  </template>
  <router-view v-else />
</template>
