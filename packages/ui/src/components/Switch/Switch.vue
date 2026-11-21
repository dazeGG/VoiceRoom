<script setup lang="ts">
import { SwitchRoot, SwitchThumb } from 'reka-ui';
import type { SwitchProps } from './types';

withDefaults(defineProps<SwitchProps>(), { disabled: false, size: 'md' });

const checked = defineModel<boolean>({ required: true });
</script>

<template>
  <SwitchRoot
    v-model="checked"
    class="ui-switch"
    :class="`ui-switch--${size}`"
    :aria-label="ariaLabel"
    :disabled="disabled"
  >
    <SwitchThumb class="ui-switch__thumb" />
  </SwitchRoot>
</template>
