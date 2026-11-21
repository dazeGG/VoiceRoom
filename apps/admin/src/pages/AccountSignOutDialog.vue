<script setup lang="ts">
import { Button, Callout } from '@voiceroom/ui-kit/components';
import Dialog from '../ui/Dialog.vue';

defineProps<{ name: string; busy: boolean; error: string }>();
const emit = defineEmits<{ close: []; confirm: [] }>();
</script>

<template>
  <Dialog open title="Разлогинить везде" initial-focus=".ui-dialog__foot button" @close="emit('close')">
    <p>
      Все сеансы <strong>{{ name }}</strong> завершатся, звонок прервётся. Войти снова можно будет с паролем — это не
      блокировка.
    </p>
    <Callout v-if="error" :title="error" tone="danger" role="alert" />
    <template #footer>
      <Button variant="ghost" @click="emit('close')">Отмена</Button>
      <Button variant="danger" :disabled="busy" @click="emit('confirm')">Разлогинить</Button>
    </template>
  </Dialog>
</template>
