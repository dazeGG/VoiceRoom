<script setup lang="ts">
import { RadioGroupRoot } from 'reka-ui';
import { nextTick } from 'vue';
import RadioGroupItem from './RadioGroupItem.vue';
import type { RadioGroupProps, RadioOption } from './types';

withDefaults(defineProps<RadioGroupProps>(), { variant: 'list' });
defineSlots<{
  item?: (props: { option?: RadioOption; variant: NonNullable<RadioGroupProps['variant']> }) => unknown;
  preview?: (props: { option: RadioOption }) => unknown;
}>();
const value = defineModel<string | null>({ default: null });

function choose(next: unknown): void {
  if (typeof next === 'string') value.value = next;
}

async function selectFocusedOption(event: KeyboardEvent): Promise<void> {
  if (!event.defaultPrevented || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  const group = event.currentTarget;
  if (!(group instanceof HTMLElement)) return;

  // Reka moves focus on the next tick and can miss selection after a quick key release.
  await nextTick();
  const focused = group.ownerDocument.activeElement;
  if (
    focused instanceof HTMLButtonElement &&
    focused !== event.target &&
    focused.closest('[role="radiogroup"]') === group
  ) {
    choose(focused.value);
  }
}
</script>

<template>
  <RadioGroupRoot
    :model-value="value"
    :disabled="disabled"
    :name="name ?? ''"
    :required="required"
    class="ui-choices"
    :class="{ 'ui-choices--cards': variant === 'card' }"
    @update:model-value="choose"
    @keydown="selectFocusedOption"
  >
    <template v-if="options">
      <RadioGroupItem v-for="option in options" :key="option.value" :option="option" :variant="variant">
        <slot name="item" :option="option" :variant="variant">{{ option.label }}</slot>
        <template v-if="$slots.preview" #preview><slot name="preview" :option="option" /></template>
      </RadioGroupItem>
    </template>
    <slot v-else name="item" :variant="variant" />
  </RadioGroupRoot>
</template>
