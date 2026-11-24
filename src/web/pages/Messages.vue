<script setup lang="ts">
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { errMessage, http } from '../api'
import type { DmThreadDetailResponse, DmThreadsResponse } from '../api'
import type { DmMessageRow, DmThreadRow } from '../../shared/types'
import MarkdownEditor from '../components/MarkdownEditor.vue'
import UserAvatar from '../components/UserAvatar.vue'
import UserGroupBadge from '../components/UserGroupBadge.vue'
import { renderMarkdown } from '../markdown'
import { meta } from '../meta'
import { auth, groupById, loadDmUnread, loadNotifications } from '../store'
import { onLiveEvent } from '../events'

const route = useRoute()
const router = useRouter()

const threads = ref<DmThreadRow[]>([])
const detail = ref<DmThreadDetailResponse | null>(null)
const loading = ref(true)
const error = ref('')
const notice = ref('')
const replyBody = ref('')

const creating = ref(false)
const form = ref({ title: '', participants: '', body: '' })
const formError = ref('')

const selectedId = computed(() => Number(route.params.id) || 0)
// Credit gate: mirrors the server check so the composer is not offered in vain.
const dmLocked = computed(
  () =>
    !!auth.user &&
    !auth.user.banned &&
    auth.user.role !== 'admin' &&
    meta.dmMinCredit > 0 &&
    auth.user.credit < meta.dmMinCredit,
)
const messagesBox = ref<HTMLElement | null>(null)

async function scrollToBottom(): Promise<void> {
  await nextTick()
  const box = messagesBox.value
  if (box) box.scrollTop = box.scrollHeight
}
const canDelete = computed(
  () =>
    !!detail.value &&
    (detail.value.thread.creatorId === auth.user?.id || auth.user?.role === 'admin'),
)

async function loadList(): Promise<void> {
  threads.value = await http.get<DmThreadsResponse>('/dm')
}

async function loadDetail(id: number): Promise<void> {
  if (!id) {
    detail.value = null
    return
  }
  try {
    detail.value = await http.get<DmThreadDetailResponse>(`/dm/threads/${id}`)
    // Opening a conversation clears its unread count for this viewer.
    await http.post(`/dm/threads/${id}/read`)
    const row = threads.value.find((t) => t.id === id)
    if (row) row.unreadCount = 0
    void loadDmUnread()
    void loadNotifications()
    await scrollToBottom()
  } catch (err) {
    detail.value = null
    error.value = errMessage(err, '私信不存在或无权访问')
  }
}

async function init(): Promise<void> {
  loading.value = true
  try {
    await loadList()
    // `?to=alice` (from a profile) pre-fills a new conversation.
    const to = typeof route.query.to === 'string' ? route.query.to : ''
    if (selectedId.value) await loadDetail(selectedId.value)
    else if (to && !dmLocked.value) openNew(to)
  } catch (err) {
    error.value = errMessage(err, '加载失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => void init())
watch(
  () => route.params.id,
  (id) => {
    if (id) void loadDetail(Number(id))
    else detail.value = null
  },
)

function openNew(prefill = ''): void {
  form.value = { title: '', participants: prefill, body: '' }
  formError.value = ''
  creating.value = true
}

async function createThread(): Promise<void> {
  formError.value = ''
  const participants = form.value.participants
    .split(/[\s,，、]+/)
    .map((name) => name.trim())
    .filter(Boolean)
  if (!form.value.title.trim()) return void (formError.value = '请填写标题')
  if (!participants.length) return void (formError.value = '请填写收件人用户名')
  if (!form.value.body.trim()) return void (formError.value = '请填写内容')
  try {
    const { id } = await http.post<{ id: number }>('/dm/threads', {
      title: form.value.title.trim(),
      participants,
      body: form.value.body.trim(),
    })
    creating.value = false
    await loadList()
    await router.push(`/messages/${id}`)
  } catch (err) {
    formError.value = errMessage(err)
  }
}

async function sendReply(): Promise<void> {
  const id = selectedId.value
  const body = replyBody.value.trim()
  if (!id || !body) return
  try {
    await http.post(`/dm/threads/${id}/messages`, { body })
    replyBody.value = ''
    await loadDetail(id)
    await loadList()
    await scrollToBottom()
  } catch (err) {
    notice.value = errMessage(err)
  }
}

async function deleteThread(): Promise<void> {
  const id = selectedId.value
  if (!id || !window.confirm('删除该私信话题及其全部消息？此操作不可撤销。')) return
  try {
    await http.del(`/dm/threads/${id}`)
    await loadList()
    await router.push('/messages')
  } catch (err) {
    notice.value = errMessage(err)
  }
}

const onCreatingChange = (value: boolean): void => {
  creating.value = value
}

/** A message pushed by the server: append in-place, or refresh a closed list. */
async function onIncoming(payload: { threadId: number; message: DmMessageRow }): Promise<void> {
  const { threadId, message } = payload
  if (detail.value && detail.value.thread.id === threadId) {
    if (!detail.value.messages.some((m) => m.id === message.id)) {
      detail.value.messages.push(message)
      await scrollToBottom()
    }
    if (message.authorId !== auth.user?.id) {
      await http.post(`/dm/threads/${threadId}/read`).catch(() => {})
      void loadNotifications()
    }
    await loadList()
    void loadDmUnread()
    return
  }
  await loadList()
  void loadDmUnread()
}

const offLive = onLiveEvent('dm:message', (data) => {
  const payload = data as { threadId: number; message: DmMessageRow }
  if (payload?.message) void onIncoming(payload)
})
onUnmounted(offLive)

const time = (iso: string) => iso.replace('T', ' ').slice(0, 16)
const names = (thread: DmThreadRow | null | undefined): string =>
  (thread?.participants ?? []).map((p) => p.displayName).join('、') || '—'
const preview = (thread: DmThreadRow): string => (thread.lastMessage?.body ?? '').slice(0, 48)
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <div>
        <h1>私信</h1>
        <p class="muted" style="margin: 6px 0 0">与站内成员一对一或多方交流。</p>
      </div>
      <span class="spacer"></span>
      <button v-if="!dmLocked" class="btn btn-primary btn-sm" type="button" @click="openNew()">
        新建私信
      </button>
    </div>

    <p v-if="auth.user?.banned" class="form-error">
      账号已被封禁：只能与管理员私信，无法向其他成员发起或回复私信。
    </p>
    <p v-if="dmLocked" class="form-error">
      私信需要信用分不低于 {{ meta.dmMinCredit }} 分（当前 {{ auth.user?.credit }} 分），暂时无法发起或发送私信。
    </p>

    <p v-if="error" class="form-error">{{ error }}</p>
    <div v-if="loading" class="empty">加载中…</div>

    <div v-else class="dm-layout">
      <aside class="dm-list card">
        <p v-if="!threads.length" class="dm-empty">还没有私信，点右上角新建一个。</p>
        <router-link
          v-for="thread in threads"
          :key="thread.id"
          :to="`/messages/${thread.id}`"
          class="dm-item"
          :class="{ active: thread.id === selectedId }"
        >
          <div class="dm-item-head">
            <span class="dm-item-title">{{ thread.title }}</span>
            <span v-if="thread.unreadCount" class="dm-unread">{{ thread.unreadCount }}</span>
          </div>
          <div class="dm-item-sub">{{ names(thread) }}</div>
          <div class="dm-item-preview">{{ preview(thread) || '（暂无消息）' }}</div>
        </router-link>
      </aside>

      <section class="dm-panel card">
        <template v-if="detail">
          <div class="dm-panel-head">
            <div style="min-width: 0">
              <h2 style="font-size: 18px">{{ detail.thread.title }}</h2>
              <div class="faint" style="font-size: 13px">
                {{ names(detail.thread) }} · {{ detail.messages.length }} 条消息
              </div>
            </div>
            <span class="spacer"></span>
            <button v-if="canDelete" class="btn btn-danger btn-sm" type="button" @click="deleteThread">
              删除话题
            </button>
          </div>

          <p v-if="notice" class="form-error">{{ notice }}</p>

          <div ref="messagesBox" class="dm-messages">
            <article v-for="message in detail.messages" :key="message.id" class="dm-message">
              <router-link
                v-if="message.author"
                :to="`/u/${message.author.username}`"
                class="post-avatar"
              >
                <UserAvatar :user="message.author" :size="30" />
              </router-link>
              <div class="dm-message-body">
                <div class="post-head">
                  <router-link v-if="message.author" :to="`/u/${message.author.username}`" class="name">
                    {{ message.author.displayName }}
                  </router-link>
                  <UserGroupBadge :group="groupById(message.author?.groupId)" />
                  <span class="faint mono">{{ time(message.createdAt) }}</span>
                </div>
                <div class="markdown-body" v-html="renderMarkdown(message.body)"></div>
              </div>
            </article>
          </div>

          <div v-if="dmLocked" class="dm-compose">
            <p class="dm-empty">信用分不足，暂时无法发送私信。</p>
          </div>
          <div v-else class="dm-compose">
            <MarkdownEditor v-model="replyBody" :rows="4" placeholder="写下你的消息…" />
            <div style="display: flex; justify-content: flex-end; margin-top: 10px">
              <button
                class="btn btn-primary"
                type="button"
                :disabled="!replyBody.trim()"
                @click="sendReply"
              >
                发送
              </button>
            </div>
          </div>
        </template>

        <p v-else class="dm-empty">选择左侧的私信话题，或新建一个。</p>
      </section>
    </div>

    <DialogRoot :open="creating" @update:open="onCreatingChange">
      <DialogPortal>
        <DialogOverlay class="dialog-overlay" />
        <DialogContent class="dialog-content">
          <DialogTitle class="dialog-title">新建私信</DialogTitle>
          <DialogDescription class="dialog-desc">
            填写标题、收件人用户名和内容，即可开启一个私信话题。
          </DialogDescription>

          <p v-if="formError" class="form-error">{{ formError }}</p>

          <form @submit.prevent="createThread">
            <label class="field">
              <span>标题</span>
              <input v-model="form.title" type="text" maxlength="100" required />
            </label>
            <label class="field">
              <span>收件人</span>
              <input
                v-model="form.participants"
                type="text"
                placeholder="用户名，多个用逗号分隔"
              />
            </label>
            <label class="field">
              <span>内容</span>
              <textarea v-model="form.body" rows="4" placeholder="支持 Markdown"></textarea>
            </label>
            <div class="dialog-actions">
              <button class="btn" type="button" @click="creating = false">取消</button>
              <button class="btn btn-primary" type="submit">发送</button>
            </div>
          </form>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  </div>
</template>
