<script setup lang="ts">
import { ToolbarButton as RekaToolbarButton } from 'reka-ui';
import IconButton from '../IconButton/IconButton.vue';
import Tooltip from '../Tooltip/Tooltip.vue';
import type { ToolbarActionProps } from './types';

defineOptions({ inheritAttrs: false });
defineProps<ToolbarActionProps>();
const emit = defineEmits<{ click: [event: MouseEvent] }>();
</script>

<template>
  <Tooltip :text="label" :shortcut="shortcut" :portal-target="tooltipTarget">
    <RekaToolbarButton as-child :disabled="disabled ?? false">
      <IconButton
        v-bind="$attrs"
        :label="label"
        :tooltip="false"
        :disabled="disabled ?? false"
        @click="emit('click', $event)"
      >
        <slot />
      </IconButton>
    </RekaToolbarButton>
  </Tooltip>
</template>
