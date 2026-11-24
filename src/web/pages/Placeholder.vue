<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

// One page backs every entry that the sidebar advertises but the forum does
// not implement yet; the title and blurb come from the route meta.
const route = useRoute()
const title = computed(() => String(route.meta.title ?? '功能'))
const description = computed(() =>
  String(route.meta.description ?? '该功能还在开发中，敬请期待。'),
)
</script>

<template>
  <div class="page">
    <section class="empty placeholder-panel">
      <h1>{{ title }}</h1>
      <p class="muted">{{ description }}</p>
      <router-link to="/" class="btn btn-sm">返回首页</router-link>
    </section>
  </div>
</template>
