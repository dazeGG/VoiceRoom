<script setup lang="ts">
import type { SettingRowProps } from './types';

defineProps<SettingRowProps>();
</script>

<template>
  <div class="ui-setting" :class="{ 'ui-setting--stacked': stacked }">
    <div v-if="$slots.leading" class="ui-setting__leading"><slot name="leading" /></div>
    <div class="ui-setting__text">
      <div v-if="label || $slots.title" class="ui-setting__title">
        <slot name="title">{{ label }}</slot>
      </div>
      <div v-if="description || $slots.description" class="ui-setting__description">
        <slot name="description">{{ description }}</slot>
      </div>
    </div>
    <div v-if="$slots.control" class="ui-setting__control"><slot name="control" /></div>
  </div>
</template>
