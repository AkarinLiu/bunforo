<script setup lang="ts">
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'reka-ui'
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { auth, logout, markNotificationsRead, notifications } from '../store'
import { setup } from '../setup'
import UserAvatar from './UserAvatar.vue'
import type { NotificationRow } from '../../shared/types'

const emit = defineEmits<{ toggleMenu: [] }>()

const router = useRouter()
const route = useRoute()
const q = ref(typeof route.query.q === 'string' ? route.query.q : '')

function onSearch(): void {
  const term = q.value.trim()
  void router.push(term ? { path: '/', query: { q: term } } : { path: '/' })
}

// Kept in script rather than an inline template expression: Vue templates are
// compiled as plain JS, so a TS non-null assertion (`auth.user!`) would not
// survive compilation.
function goProfile(): void {
  if (auth.user) void router.push(`/u/${auth.user.username}`)
}

function goMessages(): void {
  void router.push('/messages')
}

function goDrafts(): void {
  void router.push('/drafts')
}

function goSettings(): void {
  void router.push('/settings')
}

async function onLogout(): Promise<void> {
  await logout()
  await router.push('/')
}

const time = (iso: string): string => iso.replace('T', ' ').slice(5, 16)

/** Marks the row read and follows its target; notifications carry the link. */
async function openNotification(n: NotificationRow): Promise<void> {
  if (!n.readAt) void markNotificationsRead([n.id])
  if (n.dmThreadId) await router.push(`/messages/${n.dmThreadId}`)
  else if (n.threadId) await router.push(`/t/${n.threadId}`)
  else await router.push('/notifications')
}

function goNotifications(): void {
  void router.push('/notifications')
}

function markAllRead(): void {
  void markNotificationsRead()
}
</script>

<template>
  <header class="site-header">
    <div class="header-inner">
      <button class="icon-btn" type="button" aria-label="切换侧边菜单" @click="emit('toggleMenu')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      <router-link to="/" class="brand">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
        </svg>
        {{ setup.siteName }}
      </router-link>

      <form class="header-search" role="search" @submit.prevent="onSearch">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input v-model="q" type="search" placeholder="搜索主题…" aria-label="搜索主题" />
      </form>

      <div class="header-right">
        <!-- Avoid a flash of "登录" while the session is still loading. -->
        <span v-if="!auth.loaded" class="header-skeleton" aria-hidden="true"></span>

        <template v-else-if="auth.user">
          <DropdownMenuRoot>
            <DropdownMenuTrigger class="icon-btn bell-btn" aria-label="通知">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.7 21a2 2 0 0 1-3.4 0" />
              </svg>
              <span v-if="notifications.unread" class="bell-badge">
                {{ notifications.unread > 99 ? '99+' : notifications.unread }}
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent class="menu-content notif-menu" align="end">
                <div class="notif-head">
                  <span>通知</span>
                  <button
                    v-if="notifications.unread"
                    class="notif-clear"
                    type="button"
                    @click="markAllRead"
                  >
                    全部已读
                  </button>
                </div>

                <p v-if="!notifications.items.length" class="notif-empty">暂无通知</p>

                <DropdownMenuItem
                  v-for="n in notifications.items.slice(0, 8)"
                  :key="n.id"
                  class="menu-item notif-item"
                  :class="{ unread: !n.readAt }"
                  @select="openNotification(n)"
                >
                  <UserAvatar v-if="n.actor" :user="n.actor" :size="28" />
                  <span class="notif-text">
                    <span class="notif-body">{{ n.body }}</span>
                    <span v-if="n.excerpt" class="notif-excerpt">{{ n.excerpt }}</span>
                    <span class="notif-time">{{ time(n.createdAt) }}</span>
                  </span>
                </DropdownMenuItem>

                <DropdownMenuSeparator class="menu-sep" />
                <DropdownMenuItem class="menu-item" @select="goNotifications">
                  查看全部通知
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenuRoot>

          <DropdownMenuRoot>
            <DropdownMenuTrigger class="avatar-btn" aria-label="账户菜单">
              <UserAvatar :user="auth.user" :size="30" />
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent class="menu-content" align="end">
                <DropdownMenuLabel class="menu-label">{{ auth.user.displayName }}</DropdownMenuLabel>
                <DropdownMenuItem class="menu-item" @select="goProfile">个人主页</DropdownMenuItem>
                <DropdownMenuItem class="menu-item" @select="goMessages">私信</DropdownMenuItem>
                <DropdownMenuItem class="menu-item" @select="goDrafts">草稿箱</DropdownMenuItem>
                <DropdownMenuItem class="menu-item" @select="goSettings">设置</DropdownMenuItem>
                <DropdownMenuSeparator class="menu-sep" />
                <DropdownMenuItem class="menu-item" @select="onLogout">退出登录</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenuRoot>
        </template>

        <template v-else>
          <router-link to="/login" class="btn btn-ghost btn-sm">登录</router-link>
          <router-link to="/register" class="btn btn-primary btn-sm">注册</router-link>
        </template>
      </div>
    </div>
  </header>
</template>
