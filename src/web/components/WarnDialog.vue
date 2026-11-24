<script setup lang="ts">
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import { ref, watch } from 'vue'
import { errMessage, http } from '../api'

const props = defineProps<{
  open: boolean
  userId: number
  displayName: string
  /** warnings already issued, shown as context for this one */
  warningCount: number
}>()
const emit = defineEmits<{ close: []; done: [] }>()

const reason = ref('')
const error = ref('')
const submitting = ref(false)

watch(
  () => props.open,
  (open) => {
    if (open) {
      reason.value = ''
      error.value = ''
    }
  },
)

async function submit(): Promise<void> {
  error.value = ''
  const text = reason.value.trim()
  if (!text) {
    error.value = '请填写警告理由'
    return
  }
  submitting.value = true
  try {
    await http.post(`/admin/users/${props.userId}/warn`, { reason: text })
    emit('done')
    emit('close')
  } catch (err) {
    error.value = errMessage(err)
  } finally {
    submitting.value = false
  }
}

function onOpenChange(value: boolean): void {
  if (!value) emit('close')
}
</script>

<template>
  <DialogRoot :open="open" @update:open="onOpenChange">
    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <DialogContent class="dialog-content">
        <DialogTitle class="dialog-title">警告 {{ displayName }}</DialogTitle>
        <DialogDescription class="dialog-desc">
          警告会记录在案，并作为通知发送到该账号的通知箱。
          {{ warningCount ? `该账号此前已被警告 ${warningCount} 次。` : '这是第一次警告。' }}
        </DialogDescription>

        <p v-if="error" class="form-error">{{ error }}</p>

        <label class="field">
          <span>理由</span>
          <textarea
            v-model="reason"
            rows="3"
            maxlength="200"
            placeholder="写明违规行为与需要改正的地方"
          ></textarea>
        </label>

        <div class="dialog-actions">
          <button class="btn" type="button" @click="emit('close')">取消</button>
          <button class="btn btn-primary" type="button" :disabled="submitting" @click="submit">
            {{ submitting ? '发送中…' : '发送警告' }}
          </button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
