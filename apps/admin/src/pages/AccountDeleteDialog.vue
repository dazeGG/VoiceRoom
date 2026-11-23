<script setup lang="ts">
import { computed, ref } from 'vue';
import { ADMIN_REASON_MAX_LENGTH } from '@voiceroom/shared/contracts/admin';
import { Button, Callout, Field, Textarea, TextField } from '@voiceroom/ui-kit/components';
import Dialog from '../ui/Dialog.vue';

const props = defineProps<{
  login: string;
  /** Resolves to an error message, or null once the deletion is scheduled. */
  onConfirm: (input: { login: string; reason: string }) => Promise<string | null>;
}>();
const emit = defineEmits<{ close: [] }>();
const typed = ref('');
const reason = ref('');
const busy = ref(false);
const error = ref('');
const matches = computed(() => typed.value.trim().toLowerCase() === props.login);

async function submit(): Promise<void> {
  if (busy.value || !matches.value || !reason.value.trim()) return;
  busy.value = true;
  try {
    error.value = (await props.onConfirm({ login: typed.value.trim(), reason: reason.value.trim() })) ?? '';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Dialog
    open
    title="Удалить аккаунт"
    description="Аккаунт сразу заблокируется навсегда и скроется под именем «Удалённый аккаунт». Через 7 дней удаление станет окончательным: комнаты перейдут участникам, сообщения останутся без автора. До этого его можно отменить здесь же."
    @close="emit('close')"
  >
    <form class="admin-account-dialog" @submit.prevent="submit">
      <Field label="Причина">
        <Textarea v-model="reason" :maxlength="ADMIN_REASON_MAX_LENGTH" :show-count="false" :rows="2" />
      </Field>
      <Field :label="`Введите логин ${login}, чтобы подтвердить`">
        <TextField v-model="typed" autocomplete="off" :spellcheck="false" />
      </Field>
      <Callout v-if="error" :title="error" tone="danger" role="alert" />
      <div class="admin-account-dialog__actions">
        <Button variant="ghost" @click="emit('close')">Отмена</Button>
        <Button variant="danger" type="submit" :disabled="busy || !matches || !reason.trim()">
          {{ busy ? 'Удаляем…' : 'Удалить аккаунт' }}
        </Button>
      </div>
    </form>
  </Dialog>
</template>
