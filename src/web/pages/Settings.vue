<script setup lang="ts">
import { SwitchRoot, SwitchThumb } from 'reka-ui'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { errMessage, http, uploadFile } from '../api'
import type { BlockedUser, SelfUser, UserSettings } from '../../shared/types'
import EmailBindCard from '../components/EmailBindCard.vue'
import UserAvatar from '../components/UserAvatar.vue'
import { auth, logout } from '../store'

const router = useRouter()

// Profile form
const displayName = ref(auth.user?.displayName ?? '')
const bio = ref(auth.user?.bio ?? '')
const avatarUrl = ref(auth.user?.avatarUrl ?? '')
const avatarPicker = ref<HTMLInputElement | null>(null)
const uploadingAvatar = ref(false)
const profileBusy = ref(false)
const profileError = ref('')
const profileNotice = ref('')

// Password form
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const passwordBusy = ref(false)
const passwordError = ref('')
const passwordNotice = ref('')

// Notification switches
const prefs = ref<UserSettings>({
  notifyReply: true,
  notifyMention: true,
  notifyLike: true,
  notifyDm: true,
})
const prefsBusy = ref(false)
const prefsError = ref('')
const prefsNotice = ref('')

// Blacklist
const blocks = ref<BlockedUser[]>([])
const blockName = ref('')
const blockBusy = ref(false)
const blockError = ref('')
const blockNotice = ref('')

/** Preview the draft, so an upload is visible before 保存资料 is clicked. */
const previewUser = computed(() => ({
  displayName: displayName.value || auth.user?.displayName || '?',
  avatarUrl: avatarUrl.value,
}))

onMounted(async () => {
  void loadBlocks()
  try {
    prefs.value = await http.get<UserSettings>('/users/me/settings')
  } catch (err) {
    prefsError.value = errMessage(err, '通知设置加载失败')
  }
})

async function loadBlocks(): Promise<void> {
  try {
    blocks.value = await http.get<BlockedUser[]>('/users/me/blocks')
  } catch (err) {
    blockError.value = errMessage(err, '黑名单加载失败')
  }
}

async function addBlock(): Promise<void> {
  blockError.value = ''
  blockNotice.value = ''
  const name = blockName.value.trim().replace(/^@/, '')
  if (!name) return
  blockBusy.value = true
  try {
    await http.post('/users/me/blocks', { username: name })
    blockName.value = ''
    blockNotice.value = '已加入黑名单'
    await loadBlocks()
  } catch (err) {
    blockError.value = errMessage(err)
  } finally {
    blockBusy.value = false
  }
}

async function removeBlock(user: BlockedUser): Promise<void> {
  blockError.value = ''
  blockNotice.value = ''
  try {
    await http.del(`/users/me/blocks/${user.id}`)
    blocks.value = blocks.value.filter((b) => b.id !== user.id)
  } catch (err) {
    blockError.value = errMessage(err)
  }
}

async function onAvatarPick(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  uploadingAvatar.value = true
  profileError.value = ''
  try {
    const { url } = await uploadFile(file)
    // Fills the field only; 保存资料 still has to be clicked.
    avatarUrl.value = url
    profileNotice.value = '头像已上传，保存资料后生效'
  } catch (err) {
    profileError.value = errMessage(err, '上传失败')
  } finally {
    uploadingAvatar.value = false
  }
}

async function saveProfile(): Promise<void> {
  profileError.value = ''
  profileNotice.value = ''
  profileBusy.value = true
  try {
    const { user } = await http.patch<{ user: SelfUser }>('/users/me', {
      displayName: displayName.value.trim(),
      bio: bio.value.trim(),
      avatarUrl: avatarUrl.value.trim(),
    })
    auth.user = user
    displayName.value = user.displayName
    bio.value = user.bio
    avatarUrl.value = user.avatarUrl
    profileNotice.value = '资料已保存'
  } catch (err) {
    profileError.value = errMessage(err)
  } finally {
    profileBusy.value = false
  }
}

async function changePassword(): Promise<void> {
  passwordError.value = ''
  passwordNotice.value = ''
  if (newPassword.value !== confirmPassword.value) {
    passwordError.value = '两次输入的新密码不一致'
    return
  }
  passwordBusy.value = true
  try {
    await http.post('/users/me/password', {
      currentPassword: currentPassword.value,
      newPassword: newPassword.value,
    })
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
    passwordNotice.value = '密码已修改，其他设备上的登录已失效'
  } catch (err) {
    passwordError.value = errMessage(err)
  } finally {
    passwordBusy.value = false
  }
}

async function savePrefs(): Promise<void> {
  prefsError.value = ''
  prefsNotice.value = ''
  prefsBusy.value = true
  try {
    prefs.value = await http.patch<UserSettings>('/users/me/settings', prefs.value)
    prefsNotice.value = '通知设置已保存'
  } catch (err) {
    prefsError.value = errMessage(err)
  } finally {
    prefsBusy.value = false
  }
}

async function onLogout(): Promise<void> {
  await logout()
  await router.push('/')
}
</script>

<template>
  <div class="page">
    <section class="settings-head">
      <h1>设置</h1>
      <p class="muted">这些设置只对 @{{ auth.user?.username }} 生效。</p>
    </section>

    <section class="card card-pad settings-section">
      <h2>个人资料</h2>
      <p class="muted settings-hint">在个人主页和帖子里显示的名字、简介与头像。</p>

      <form @submit.prevent="saveProfile">
        <div class="settings-avatar-row">
          <UserAvatar :user="previewUser" :size="54" />
          <div>
            <button
              class="btn btn-sm"
              type="button"
              :disabled="uploadingAvatar"
              @click="avatarPicker?.click()"
            >
              {{ uploadingAvatar ? '上传中…' : '更换头像' }}
            </button>
            <input
              ref="avatarPicker"
              class="hidden-file"
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
              @change="onAvatarPick"
            />
            <div class="faint settings-hint">支持 PNG / JPEG / GIF / WebP / AVIF</div>
          </div>
        </div>

        <label class="field">
          <span>昵称</span>
          <input v-model="displayName" type="text" maxlength="32" required />
        </label>
        <label class="field">
          <span>简介</span>
          <textarea v-model="bio" rows="3" maxlength="500" placeholder="介绍一下自己"></textarea>
        </label>

        <p v-if="profileError" class="form-error">{{ profileError }}</p>
        <p v-if="profileNotice" class="form-ok">{{ profileNotice }}</p>
        <button class="btn btn-primary" type="submit" :disabled="profileBusy">
          {{ profileBusy ? '保存中…' : '保存资料' }}
        </button>
      </form>
    </section>

    <div class="settings-section">
      <EmailBindCard />
    </div>

    <section class="card card-pad settings-section">
      <h2>修改密码</h2>
      <p class="muted settings-hint">
        修改后其他设备上的登录会失效，当前页面保持登录。通过 GitHub 登录的账号没有本地密码。
      </p>

      <form @submit.prevent="changePassword">
        <label class="field">
          <span>当前密码</span>
          <input
            v-model="currentPassword"
            type="password"
            autocomplete="current-password"
            required
          />
        </label>
        <label class="field">
          <span>新密码</span>
          <input
            v-model="newPassword"
            type="password"
            autocomplete="new-password"
            minlength="8"
            required
          />
        </label>
        <label class="field">
          <span>确认新密码</span>
          <input
            v-model="confirmPassword"
            type="password"
            autocomplete="new-password"
            required
          />
        </label>

        <p v-if="passwordError" class="form-error">{{ passwordError }}</p>
        <p v-if="passwordNotice" class="form-ok">{{ passwordNotice }}</p>
        <button class="btn btn-primary" type="submit" :disabled="passwordBusy">
          {{ passwordBusy ? '提交中…' : '修改密码' }}
        </button>
      </form>
    </section>

    <section class="card card-pad settings-section">
      <h2>通知</h2>
      <p class="muted settings-hint">
        关闭后，这类提醒不再出现在通知铃铛和通知页；私信本身仍会收到。
      </p>

      <label class="settings-switch">
        <span>
          <span class="settings-switch-title">有人回复我</span>
          <span class="faint settings-switch-desc">我的主题或帖子收到回复时提醒</span>
        </span>
        <SwitchRoot
          class="switch-root"
          :model-value="prefs.notifyReply"
          @update:model-value="prefs.notifyReply = $event"
        >
          <SwitchThumb class="switch-thumb" />
        </SwitchRoot>
      </label>

      <label class="settings-switch">
        <span>
          <span class="settings-switch-title">有人 @ 我</span>
          <span class="faint settings-switch-desc">在主题或回复里被提到时提醒</span>
        </span>
        <SwitchRoot
          class="switch-root"
          :model-value="prefs.notifyMention"
          @update:model-value="prefs.notifyMention = $event"
        >
          <SwitchThumb class="switch-thumb" />
        </SwitchRoot>
      </label>

      <label class="settings-switch">
        <span>
          <span class="settings-switch-title">有人赞我</span>
          <span class="faint settings-switch-desc">我的回复被点赞时提醒</span>
        </span>
        <SwitchRoot
          class="switch-root"
          :model-value="prefs.notifyLike"
          @update:model-value="prefs.notifyLike = $event"
        >
          <SwitchThumb class="switch-thumb" />
        </SwitchRoot>
      </label>

      <label class="settings-switch">
        <span>
          <span class="settings-switch-title">收到私信</span>
          <span class="faint settings-switch-desc">私信会话里有新消息时提醒</span>
        </span>
        <SwitchRoot
          class="switch-root"
          :model-value="prefs.notifyDm"
          @update:model-value="prefs.notifyDm = $event"
        >
          <SwitchThumb class="switch-thumb" />
        </SwitchRoot>
      </label>

      <p v-if="prefsError" class="form-error" style="margin-top: 14px">{{ prefsError }}</p>
      <p v-if="prefsNotice" class="form-ok" style="margin-top: 14px">{{ prefsNotice }}</p>
      <button
        class="btn btn-primary"
        type="button"
        :disabled="prefsBusy"
        style="margin-top: 14px"
        @click="savePrefs"
      >
        {{ prefsBusy ? '保存中…' : '保存通知设置' }}
      </button>
    </section>

    <section class="card card-pad settings-section">
      <h2>黑名单</h2>
      <p class="muted settings-hint">
        被你拉黑的用户无法 @ 你，也无法给你发送私信；你仍然可以浏览对方的内容。
      </p>

      <form class="block-form" @submit.prevent="addBlock">
        <input v-model="blockName" type="text" maxlength="32" placeholder="输入用户名" />
        <button class="btn btn-primary btn-sm" type="submit" :disabled="blockBusy || !blockName.trim()">
          {{ blockBusy ? '添加中…' : '拉黑' }}
        </button>
      </form>

      <p v-if="blockError" class="form-error" style="margin-top: 12px">{{ blockError }}</p>
      <p v-if="blockNotice" class="form-ok" style="margin-top: 12px">{{ blockNotice }}</p>

      <div v-if="blocks.length" class="block-list">
        <div v-for="blocked in blocks" :key="blocked.id" class="block-row">
          <UserAvatar :user="blocked" :size="28" />
          <router-link :to="`/u/${blocked.username}`" class="block-name">
            {{ blocked.displayName }}<span class="faint"> @{{ blocked.username }}</span>
          </router-link>
          <button class="btn btn-sm" type="button" @click="removeBlock(blocked)">解除</button>
        </div>
      </div>
      <p v-else class="faint" style="margin: 12px 0 0; font-size: 13px">还没有拉黑任何人。</p>
    </section>

    <section class="card card-pad settings-section">
      <h2>登录</h2>
      <p class="muted settings-hint">在共用设备上使用完，记得退出登录。</p>
      <button class="btn btn-danger btn-sm" type="button" @click="onLogout">退出登录</button>
    </section>
  </div>
</template>
