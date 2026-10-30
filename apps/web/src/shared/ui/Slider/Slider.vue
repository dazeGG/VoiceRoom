<script setup lang="ts">
import { SliderRoot, SliderThumb, SliderTrack } from 'reka-ui';
import { computed, ref } from 'vue';
import type { SliderProps } from './types';

const props = withDefaults(defineProps<SliderProps>(), {
  min: 0,
  max: 100,
  step: 1,
  snap: false,
  snapThreshold: 0,
  disabled: false,
  showFill: true,
  ariaLabel: 'Значение'
});

const emit = defineEmits<{ valueChange: [value: number] }>();

const value = defineModel<number>({ default: 0 });

const fraction = computed(() =>
  props.max > props.min ? Math.min(1, Math.max(0, (value.value - props.min) / (props.max - props.min))) : 0
);

const pointerActive = ref(false);

function commit(next: number): void {
  const clamped = Math.min(props.max, Math.max(props.min, next));
  if (clamped === value.value) return;
  value.value = clamped;
  emit('valueChange', clamped);
}

function handleUpdate(values: number[] | undefined): void {
  const resting = props.defaultValue ?? props.min;
  let next = values?.[0];
  if (next === undefined || !Number.isFinite(next)) next = resting;
  if (props.snap && pointerActive.value && props.snapThreshold > 0 && Math.abs(next - resting) <= props.snapThreshold)
    next = resting;
  commit(next);
}
</script>

<template>
  <SliderRoot
    class="vr-slider"
    :class="{ 'vr-slider--disabled': disabled }"
    :style="{ '--slider-fraction': fraction }"
    :model-value="[value]"
    :min="min"
    :max="max"
    :step="step"
    :disabled="disabled"
    @update:model-value="handleUpdate"
    @pointerdown.capture="pointerActive = true"
    @pointerup="pointerActive = false"
    @pointercancel="pointerActive = false"
    @focusout="pointerActive = false"
  >
    <div class="vr-slider__control">
      <SliderTrack class="vr-slider__track" aria-hidden="true">
        <slot name="background" />
        <span v-if="showFill" class="vr-slider__fill"></span>
        <span class="vr-slider__thumb"></span>
      </SliderTrack>
      <SliderThumb class="vr-slider__input" :aria-label="ariaLabel" :aria-valuetext="ariaValueText" />
    </div>
  </SliderRoot>
</template>
