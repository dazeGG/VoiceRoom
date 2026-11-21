<script setup lang="ts">
import { t } from '../../i18n';
import { SliderRoot, SliderThumb, SliderTrack } from 'reka-ui';
import { computed, ref } from 'vue';
import type { SliderProps } from './types';

const props = withDefaults(defineProps<SliderProps>(), {
  min: 0,
  max: 100,
  orientation: 'horizontal',
  snap: false,
  snapThreshold: 0,
  disabled: false,
  showFill: true,
  ariaLabel: ''
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

function handleArrow(event: KeyboardEvent): void {
  if (props.disabled || (!event.shiftKey && props.step !== undefined)) return;
  if (!['ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown'].includes(event.key)) return;
  const increasing = event.key === 'ArrowRight' || event.key === 'ArrowUp';
  const step = props.step ?? 1;
  const fraction = event.shiftKey ? 0.1 : 0.05;
  const increment = Math.max(1, Math.round(((props.max - props.min) * fraction) / step));
  const current = Math.round((value.value - props.min) / step);
  const next = props.min + (current + (increasing ? increment : -increment)) * step;
  event.preventDefault();
  event.stopPropagation();
  commit(Number(next.toPrecision(15)));
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
    :class="['vr-slider', { 'vr-slider--vertical': orientation === 'vertical' }]"
    :orientation="orientation"
    :aria-disabled="disabled || undefined"
    :style="{ '--slider-fraction': fraction }"
    :model-value="[value]"
    :min="min"
    :max="max"
    :step="step ?? 1"
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
      <SliderThumb
        class="vr-slider__input"
        :aria-label="ariaLabel || t('Значение')"
        :aria-valuetext="ariaValueText"
        :aria-disabled="disabled || undefined"
        @keydown="handleArrow"
      />
    </div>
  </SliderRoot>
</template>
