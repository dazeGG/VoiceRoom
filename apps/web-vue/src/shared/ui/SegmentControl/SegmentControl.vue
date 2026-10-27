<script setup lang="ts" generic="T extends string">
import { ToggleGroupItem, ToggleGroupRoot } from 'reka-ui';
import type { SegmentControlProps, SegmentOption } from './types';

const props = withDefaults(defineProps<SegmentControlProps<T>>(), { kind: 'radio', size: 'md' });

const emit = defineEmits<{ change: [value: T] }>();

defineSlots<{ suffix?: (props: { option: SegmentOption }) => unknown }>();

// Choosing the selected segment again deselects it in Reka; the segment stays and reports itself, as before.
function choose(next: unknown): void {
  const option = props.options.find((candidate) => candidate.value === next);
  emit('change', option?.value ?? props.value);
}

function move(event: KeyboardEvent, index: number): void {
  if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
  event.preventDefault();
  const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
  const segment = event.currentTarget;
  const buttons =
    segment instanceof HTMLElement ? segment.parentElement?.querySelectorAll<HTMLElement>('button') : undefined;
  const { options } = props;
  for (let offset = 1; offset <= options.length; offset += 1) {
    const nextIndex = (index + step * offset + options.length * offset) % options.length;
    const next = options[nextIndex];
    if (!next || next.disabled) continue;
    emit('change', next.value);
    queueMicrotask(() => buttons?.[nextIndex]?.focus());
    return;
  }
}
</script>

<template>
  <ToggleGroupRoot as-child type="single" :model-value="value" :roving-focus="false" @update:model-value="choose">
    <div
      class="ui-segment"
      :class="`ui-segment--${size}`"
      :role="kind === 'tabs' ? 'tablist' : 'radiogroup'"
      :aria-label="ariaLabel"
    >
      <ToggleGroupItem
        v-for="(option, index) in options"
        :key="option.value"
        class="ui-segment__item"
        :value="option.value"
        :role="kind === 'tabs' ? 'tab' : 'radio'"
        :aria-selected="kind === 'tabs' ? option.value === value : undefined"
        :aria-checked="kind === 'radio' ? option.value === value : undefined"
        :aria-pressed="undefined"
        :tabindex="option.value === value ? 0 : -1"
        :disabled="option.disabled ?? false"
        @keydown="move($event, index)"
      >
        <span v-if="option.dot" class="ui-segment__dot" aria-hidden="true"></span>
        <span>{{ option.label }}</span>
        <slot name="suffix" :option="option" />
      </ToggleGroupItem>
    </div>
  </ToggleGroupRoot>
</template>
