<script setup lang="ts">
import { useTemplateRef, watchPostEffect } from 'vue';
import type { NativeDialogProps } from './types';

const props = withDefaults(defineProps<NativeDialogProps>(), { open: true, modal: true });
const emit = defineEmits<{ close: []; opened: [] }>();
const dialog = useTemplateRef<HTMLDialogElement>('dialog');
defineExpose({ dialog });

function close(): void {
  dialog.value?.close();
}

function onBackdropClick(event: MouseEvent): void {
  if (props.modal && event.target === event.currentTarget) close();
}

function onClose(): void {
  if (!dialog.value?.open) emit('close');
}

watchPostEffect(() => {
  const element = dialog.value;
  if (!element) return;
  if (element.open && (!props.open || element.matches(':modal') !== props.modal)) element.close();
  if (!props.open || element.open) return;
  if (props.modal) element.showModal();
  else element.show();
  emit('opened');
});
</script>

<template>
  <dialog ref="dialog" class="ui-native-dialog" :aria-label="label" @click="onBackdropClick" @close="onClose">
    <slot :close="close" />
  </dialog>
</template>
