<script setup lang="ts">
import { t } from '@/shared/i18n';
import { ref, watch } from 'vue';
import { AlertDialog, Checkbox } from '@voice-room/ui/components';

const props = defineProps<{ open: boolean; fromName: string; toName: string }>();

const emit = defineEmits<{ confirm: [dontAskAgain: boolean]; cancel: [] }>();

const dontAskAgain = ref(false);

watch(
  () => props.open,
  (open) => {
    if (open) dontAskAgain.value = false;
  },
  { immediate: true }
);
</script>

<template>
  <AlertDialog
    :open="open"
    :title="t('Перейти в комнату «{p0}»?', { p0: toName })"
    :description="t('Вы покинете звонок в «{p0}».', { p0: fromName })"
    :confirm-label="t('Перейти')"
    @cancel="emit('cancel')"
    @confirm="emit('confirm', dontAskAgain)"
  >
    <Checkbox :model-value="dontAskAgain" @update:model-value="dontAskAgain = $event === true">
      {{ t('Больше не спрашивать') }}
    </Checkbox>
  </AlertDialog>
</template>
