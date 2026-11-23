<script setup lang="ts">
import { ToolbarButton } from 'reka-ui';
import IconButton from '../IconButton/IconButton.vue';
import type { IconButtonProps } from '../IconButton/types';

defineProps<Pick<IconButtonProps, 'label' | 'disabled'> & { pressed?: boolean }>();
const emit = defineEmits<{ click: [event: MouseEvent] }>();
</script>

<template>
  <ToolbarButton as-child :disabled="disabled">
    <IconButton :label="label" :disabled="disabled" :aria-pressed="pressed" :size="32" @click="emit('click', $event)"
      ><slot
    /></IconButton>
  </ToolbarButton>
</template>
