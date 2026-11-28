<script setup lang="ts">
import { AlertDialog } from '@voiceroom/ui-kit/components';
import { t } from '@/shared/i18n';

defineProps<{ login: string }>();
const emit = defineEmits<{ close: []; confirm: [] }>();
</script>

<template>
  <AlertDialog
    open
    tone="danger"
    :title="t('Удалить переписку?')"
    :description="t('Все сообщения и файлы исчезнут у вас и у @{login}. Отменить это нельзя.', { login })"
    :confirm-label="t('Удалить')"
    @cancel="emit('close')"
    @confirm="emit('confirm')"
  />
</template>
