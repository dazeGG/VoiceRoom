<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import { ADMIN_REASON_MAX_LENGTH, type BlockDuration } from '@voiceroom/shared/contracts/admin';
import { Button, Callout, Field, Textarea, SegmentControl } from '@voiceroom/ui-kit/components';
import { BLOCK_DURATIONS } from '../accounts.ts';
import { useCan } from '../staff.store.ts';
import Dialog from '../ui/Dialog.vue';

const props = defineProps<{
  name: string;
  /** Resolves to an error message, or null once the block is in place. */
  onConfirm: (input: { duration: BlockDuration; reason: string }) => Promise<string | null>;
}>();
const emit = defineEmits<{ close: [] }>();
const canForever = useCan('accounts.manage');
const durations = computed(() => BLOCK_DURATIONS.filter((option) => canForever.value || option.value !== 'forever'));
const duration = ref<BlockDuration>('week');
const reason = ref('');
const busy = ref(false);
const error = ref('');
const reasonId = useId();

function chooseDuration(value: string): void {
  const next = durations.value.find((option) => option.value === value);
  if (next) duration.value = next.value;
}

async function submit(): Promise<void> {
  if (busy.value || !reason.value.trim()) return;
  busy.value = true;
  try {
    error.value = (await props.onConfirm({ duration: duration.value, reason: reason.value.trim() })) ?? '';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Dialog
    open
    :title="`Заблокировать ${name}`"
    :initial-focus="`#${reasonId}`"
    description="Аккаунт сразу выйдет со всех устройств и из войса. При входе он увидит срок и причину."
    @close="emit('close')"
  >
    <form class="admin-account-dialog" @submit.prevent="submit">
      <fieldset class="admin-account-dialog__duration">
        <legend>Срок</legend>
        <SegmentControl
          :options="durations"
          :value="duration"
          v-bind="{ ariaLabel: 'Срок блокировки' }"
          @change="chooseDuration"
        />
      </fieldset>
      <Field :id="reasonId" label="Причина">
        <Textarea
          v-model="reason"
          :maxlength="ADMIN_REASON_MAX_LENGTH"
          :show-count="false"
          placeholder="Например: спам в чатах комнат"
          :rows="3"
        />
      </Field>
      <Callout v-if="error" :title="error" tone="danger" role="alert" />
      <div class="admin-account-dialog__actions">
        <Button variant="ghost" @click="emit('close')">Отмена</Button>
        <Button variant="danger" type="submit" :disabled="busy || !reason.trim()">
          {{ busy ? 'Блокируем…' : 'Заблокировать' }}
        </Button>
      </div>
    </form>
  </Dialog>
</template>
