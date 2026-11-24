<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { errMessage, http } from '../api'
import type { CategoriesResponse } from '../api'
import type { CategoryRow } from '../../shared/types'

const categories = ref<CategoryRow[]>([])
const loading = ref(true)
const error = ref('')

const topCategories = computed(() => categories.value.filter((c) => c.parentId === null))
const childrenOf = (id: number) => categories.value.filter((c) => c.parentId === id)

/** A parent's feed carries its sub-boards, so show the combined count. */
const countOf = (category: CategoryRow): number =>
  (category.threadCount ?? 0) +
  childrenOf(category.id).reduce((sum, child) => sum + (child.threadCount ?? 0), 0)

onMounted(async () => {
  try {
    categories.value = await http.get<CategoriesResponse>('/categories')
  } catch (err) {
    error.value = errMessage(err, '加载失败')
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="page">
    <section class="home-hero">
      <div class="home-hero-text">
        <p class="home-kicker">RSS</p>
        <h1 class="welcome-title">订阅源</h1>
        <p class="welcome-lead">
          把下面的链接添加到 RSS 阅读器，就能跟进全站或任意版块的更新。父版块的订阅包含它的子版块。
        </p>
      </div>
    </section>

    <p v-if="error" class="form-error">{{ error }}</p>
    <div v-else-if="loading" class="empty">加载中…</div>

    <template v-else>
      <h2 class="feed-section-title">全站</h2>
      <div class="card feed-source">
        <div class="feed-source-main">
          <div class="feed-source-name">最新主题</div>
          <div class="feed-source-url">/feed.xml</div>
        </div>
        <a
          class="btn btn-sm"
          href="/feed.xml"
          target="_blank"
          rel="alternate"
          type="application/rss+xml"
        >
          RSS
        </a>
      </div>

      <h2 class="feed-section-title">按版块</h2>
      <div v-if="!topCategories.length" class="empty">还没有版块。</div>

      <div v-else class="feed-source-list">
        <div v-for="category in topCategories" :key="category.id" class="feed-source-group">
          <div class="card feed-source">
            <div class="feed-source-main">
              <div class="feed-source-name">
                {{ category.name }}
                <span class="faint feed-source-count">{{ countOf(category) }} 主题</span>
              </div>
              <div class="feed-source-url">/c/{{ category.id }}/feed.xml</div>
            </div>
            <a
              class="btn btn-sm"
              :href="`/c/${category.id}/feed.xml`"
              target="_blank"
              rel="alternate"
              type="application/rss+xml"
            >
              RSS
            </a>
          </div>

          <div
            v-for="child in childrenOf(category.id)"
            :key="child.id"
            class="card feed-source feed-source-child"
          >
            <div class="feed-source-main">
              <div class="feed-source-name">
                {{ child.name }}
                <span class="faint feed-source-count">{{ child.threadCount ?? 0 }} 主题</span>
              </div>
              <div class="feed-source-url">/c/{{ child.id }}/feed.xml</div>
            </div>
            <a
              class="btn btn-sm"
              :href="`/c/${child.id}/feed.xml`"
              target="_blank"
              rel="alternate"
              type="application/rss+xml"
            >
              RSS
            </a>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
