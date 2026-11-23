<script setup lang="ts">
import { Dialog as UiDialog, type DialogProps } from '@voiceroom/ui-kit/components';

withDefaults(defineProps<Omit<DialogProps, 'onClose'>>(), {
  initialFocus: '.ui-dialog__body :is(input, textarea, select, button):not(:disabled)',
  size: 'md',
  closable: true
});
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <UiDialog
    :open="open"
    :title="title"
    :size="size"
    :closable="closable"
    :close-disabled="closeDisabled"
    :initial-focus="initialFocus"
    v-bind="description === undefined ? {} : { description }"
    :on-close="() => emit('close')"
  >
    <slot />
    <template v-if="$slots.footer" #footer><slot name="footer" /></template>
  </UiDialog>
</template>
