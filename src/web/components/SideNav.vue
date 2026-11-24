<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { http } from '../api'
import type { CategoriesResponse, TagsResponse } from '../api'
import type { CategoryRow, TagRow } from '../../shared/types'
import { auth, dmUnread } from '../store'

defineProps<{ open: boolean }>()

const categories = ref<CategoryRow[]>([])
const tags = ref<TagRow[]>([])
// 更多 mirrors the reference layout: the secondary entries stay visible by
// default, but the group can be folded away on small screens.
const moreOpen = ref(true)

const route = useRoute()
// Every tag link points at "/" with a different query, so vue-router would mark
// them all active on the home page. Highlight by hand from ?tag= instead.
const activeTag = computed(() => (typeof route.query.tag === 'string' ? route.query.tag : ''))

const topCategories = computed(() => categories.value.filter((c) => c.parentId === null))
const childrenOf = (id: number) => categories.value.filter((c) => c.parentId === id)
const isAdmin = computed(() => auth.user?.role === 'admin')

onMounted(async () => {
  try {
    categories.value = await http.get<CategoriesResponse>('/categories')
  } catch {
    // Navigation is non-critical — an empty list just hides the 分类 section.
  }
  try {
    tags.value = await http.get<TagsResponse>('/tags')
  } catch {
    // Same for 标签.
  }
})
</script>

<template>
  <aside class="sidenav" :class="{ open }" aria-label="侧边菜单">
    <router-link v-if="auth.user && !auth.user.banned" to="/new" class="side-cta">发表主题</router-link>

    <div class="side-block">
      <nav class="side-nav">
        <router-link to="/" class="side-link">话题</router-link>
        <router-link to="/drafts" class="side-link">我的草稿</router-link>
        <router-link to="/messages" class="side-link">
          <span class="side-name">我的消息</span>
          <span v-if="dmUnread.count" class="side-badge">
            {{ dmUnread.count > 99 ? '99+' : dmUnread.count }}
          </span>
        </router-link>
        <router-link v-if="auth.user" to="/settings" class="side-link">设置</router-link>
        <router-link v-if="isAdmin" to="/admin" class="side-link">管理后台</router-link>

        <button
          class="side-more"
          type="button"
          :aria-expanded="moreOpen"
          aria-controls="side-more-items"
          @click="moreOpen = !moreOpen"
        >
          <span>更多</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        <div v-show="moreOpen" id="side-more-items" class="side-more-items">
          <router-link v-if="isAdmin" to="/review" class="side-link">审核队列</router-link>
          <router-link to="/achievements" class="side-link">成就</router-link>
          <router-link to="/activity" class="side-link">近期活动</router-link>
          <router-link to="/invites" class="side-link">邀请</router-link>
          <router-link to="/ai" class="side-link">AI 机器人</router-link>
          <router-link to="/boards" class="side-link">看板</router-link>
        </div>
      </nav>
    </div>

    <div class="side-block">
      <div class="side-heading">分类</div>
      <nav class="side-nav">
        <template v-for="category in topCategories" :key="category.id">
          <router-link :to="`/c/${category.id}`" class="side-link">
            <span class="side-name">{{ category.name }}</span>
            <span class="side-count">{{ category.threadCount ?? 0 }}</span>
          </router-link>
          <router-link
            v-for="child in childrenOf(category.id)"
            :key="child.id"
            :to="`/c/${child.id}`"
            class="side-link side-link-child"
          >
            <span class="side-name">{{ child.name }}</span>
            <span class="side-count">{{ child.threadCount ?? 0 }}</span>
          </router-link>
        </template>
        <p v-if="!topCategories.length" class="side-empty">暂无版块</p>
      </nav>
    </div>

    <div class="side-block">
      <div class="side-heading">标签</div>
      <nav class="side-nav">
        <router-link
          v-for="tag in tags"
          :key="tag.id"
          :to="`/?tag=${tag.id}`"
          class="side-link"
          active-class=""
          exact-active-class=""
          :class="{ 'is-active': String(tag.id) === activeTag }"
        >
          <span class="side-name"># {{ tag.name }}</span>
          <span class="side-count">{{ tag.threadCount ?? 0 }}</span>
        </router-link>
        <p v-if="!tags.length" class="side-empty">暂无标签</p>
      </nav>
    </div>

    <router-link to="/feeds" class="side-rss">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="M4 11a9 9 0 0 1 9 9" />
        <path d="M4 4a16 16 0 0 1 16 16" />
        <circle cx="5" cy="19" r="1" />
      </svg>
      RSS 订阅
    </router-link>
  </aside>
</template>
