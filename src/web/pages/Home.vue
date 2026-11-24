<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { http, errMessage } from '../api'
import type { TagsResponse, ThreadsResponse } from '../api'
import type { ThreadRow } from '../../shared/types'
import { auth } from '../store'
import { setup } from '../setup'
import { onLiveEvent } from '../events'
import { renderMarkdown } from '../markdown'
import TagList from '../components/TagList.vue'
import UserAvatar from '../components/UserAvatar.vue'

const route = useRoute()

const threads = ref<ThreadRow[]>([])
const loading = ref(true)
const error = ref('')
const query = ref('')
const tag = ref('')
const tagName = ref('')

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  query.value = typeof route.query.q === 'string' ? route.query.q : ''
  tag.value = typeof route.query.tag === 'string' ? route.query.tag : ''
  try {
    const params = new URLSearchParams({ limit: '20' })
    if (query.value) params.set('q', query.value)
    if (tag.value) params.set('tag', tag.value)
    threads.value = await http.get<ThreadsResponse>(`/threads?${params}`)
    // Resolve the tag name for the heading; the list itself is tiny.
    tagName.value = tag.value
      ? ((await http.get<TagsResponse>('/tags')).find((t) => String(t.id) === tag.value)?.name ?? '')
      : ''
  } catch (err) {
    error.value = errMessage(err, '加载失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => void load())
watch(
  () => [route.query.q, route.query.tag],
  () => void load(),
)

// New threads appear at the top of the unfiltered feed without a reload.
const offLive = onLiveEvent('thread:created', (data) => {
  const created = data as ThreadRow
  if (!created?.id || query.value || tag.value) return
  if (threads.value.some((t) => t.id === created.id)) return
  threads.value.unshift(created)
  if (threads.value.length > 20) threads.value.length = 20
})
onUnmounted(offLive)

const time = (iso: string) => iso.replace('T', ' ').slice(0, 16)
</script>

<template>
  <div class="page home-page">
    <section class="home-hero">
      <div class="home-hero-text">
        <p class="home-kicker">话题</p>
        <h1 class="welcome-title">
          <template v-if="auth.user">
            欢迎回来，<span class="hero-accent">{{ auth.user.displayName }}</span>
          </template>
          <template v-else>欢迎来到 <span class="hero-accent">{{ setup.siteName }}</span></template>
        </h1>
        <p class="welcome-lead">
          {{ setup.siteDescription || '一个跑在 Bun + Hono 上的论坛，同一套代码支持 SQLite、PostgreSQL 和 MySQL。' }}
        </p>
      </div>
      <div class="home-hero-actions">
        <router-link v-if="auth.user && !auth.user.banned" to="/new" class="btn btn-primary">
          发表主题
        </router-link>
        <span v-else-if="auth.user?.banned" class="faint" style="font-size: 13px">
          账号已被封禁，暂时无法发表主题
        </span>
        <template v-else>
          <router-link to="/register" class="btn btn-primary">注册</router-link>
          <router-link to="/login" class="btn btn-ghost">登录</router-link>
        </template>
      </div>
    </section>

    <section v-if="setup.siteNotice" class="card card-pad site-notice">
      <div class="markdown-body" v-html="renderMarkdown(setup.siteNotice)"></div>
    </section>

    <section>
      <div class="toolbar feed-head">
        <h2>
          <template v-if="tag">标签：{{ tagName || `#${tag}` }}</template>
          <template v-else-if="query">搜索结果</template>
          <template v-else>最新主题</template>
        </h2>
        <span class="feed-count muted">
          {{ query || tag ? '共 ' + threads.length + ' 条匹配' : '共 ' + threads.length + ' 条' }}
        </span>
        <span class="spacer"></span>
        <router-link v-if="tag || query" to="/" class="btn btn-sm btn-ghost">清除筛选</router-link>
      </div>

      <p v-if="error" class="form-error">{{ error }}</p>
      <div v-else-if="loading" class="empty">加载中…</div>

      <div v-else-if="!threads.length" class="empty">
        <template v-if="query">没有找到匹配的主题。</template>
        <template v-else-if="tag">这个标签下还没有主题。</template>
        <template v-else>还没有主题。去侧边栏挑一个版块，发表第一帖吧。</template>
      </div>

      <div v-else class="thread-list">
        <div v-for="thread in threads" :key="thread.id" class="thread-row">
          <UserAvatar v-if="thread.author" :user="thread.author" :size="34" />

          <div class="thread-main">
            <div class="thread-title">
              <span v-if="thread.isGlobalPinned" class="pill pill-global">全站置顶</span>
              <span v-if="thread.isPinned" class="pill">置顶</span>
              <span v-if="thread.isLocked" class="pill pill-danger">锁定</span>
              <router-link :to="`/t/${thread.id}`">{{ thread.title }}</router-link>
            </div>
            <div class="thread-sub">
              {{ thread.author?.displayName || '未知用户' }}
              <span class="hide-sm">· 最新 {{ time(thread.lastPostAt) }} · {{ thread.viewCount }} 浏览</span>
            </div>
            <TagList :tags="thread.tags" />
          </div>

          <div class="count">
            <b>{{ thread.postCount ?? 0 }}</b>
            回复
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
