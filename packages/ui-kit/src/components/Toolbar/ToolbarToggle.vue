<script setup lang="ts">
import { ToolbarButton as RekaToolbarButton } from 'reka-ui';
import Toggle from '../Toggle/Toggle.vue';
import Tooltip from '../Tooltip/Tooltip.vue';
import type { ToolbarActionProps } from './types';

defineOptions({ inheritAttrs: false });
defineProps<ToolbarActionProps>();
const pressed = defineModel<boolean>('pressed', { default: false });
</script>

<template>
  <Tooltip :text="label" :shortcut="shortcut" :portal-target="tooltipTarget">
    <RekaToolbarButton as-child :disabled="disabled ?? false">
      <Toggle
        v-bind="$attrs"
        v-model:pressed="pressed"
        :aria-label="label"
        :disabled="disabled ?? false"
        class="ui-toolbar__toggle"
      >
        <slot />
      </Toggle>
    </RekaToolbarButton>
  </Tooltip>
</template>
