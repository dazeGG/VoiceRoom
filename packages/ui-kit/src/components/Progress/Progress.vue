<script setup lang="ts">
import { ProgressIndicator, ProgressRoot } from 'reka-ui';
import { computed, useId } from 'vue';
import type { ProgressProps } from './types';

const props = withDefaults(defineProps<ProgressProps>(), { size: 'sm', value: null });
const labelId = useId();
const percent = computed(() =>
  props.value === null || !Number.isFinite(props.value) ? null : Math.max(0, Math.min(100, props.value))
);
</script>

<template>
  <div class="ui-progress-row">
    <div
      v-if="variant !== 'track'"
      class="ui-progress-row__head"
      :class="{ 'ui-progress-row__head--compact': hideLabel }"
    >
      <span :id="labelId" :class="{ 'ui-progress-row__label--hidden': hideLabel }">{{ label }}</span>
      <span v-if="percent !== null" class="ui-progress-row__percent" aria-hidden="true"
        >{{ Math.round(percent) }}%</span
      >
    </div>
    <ProgressRoot
      :class="[
        'ui-progress',
        `ui-progress--${size}`,
        {
          'ui-progress--indeterminate': percent === null,
          'ui-progress--track': variant === 'track',
          'ui-progress--error': error
        }
      ]"
      :model-value="percent"
      :get-value-label="() => undefined"
      :aria-hidden="variant === 'track' || undefined"
      :aria-labelledby="variant === 'track' ? undefined : labelId"
    >
      <ProgressIndicator class="ui-progress__fill" :style="{ '--progress-value': `${percent ?? 0}%` }" />
    </ProgressRoot>
  </div>
</template>
