<script setup lang="ts">
import { Check, ChevronDown } from '@lucide/vue';
import {
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectViewport
} from 'reka-ui';
import { computed } from 'vue';
import { useFieldControl } from '../Field/context';
import { parsePlacement } from '../Popover/popover-placement';
import NativeSelect from './NativeSelect.vue';
import type { SelectProps } from './types';

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<SelectProps>(), {
  options: () => [],
  label: '',
  disabled: false,
  placement: 'bottom-start',
  flip: false,
  size: 'md',
  variant: 'default'
});

// Reka's SelectItem throws on an empty value, but a device list starts with one
// (the system default), so '' travels through Reka as this stand-in.
const EMPTY_VALUE = '__select-empty__';
const toItem = (value: string): string => (value === '' ? EMPTY_VALUE : value);
const fromItem = (value: string): string => (value === EMPTY_VALUE ? '' : value);

const emit = defineEmits<{ valueChange: [value: string] }>();

const value = defineModel<string>({ default: '' });
const controlAttrs = useFieldControl();

const selectedLabel = computed(
  () => props.options.find((option) => option.value === value.value)?.label ?? props.options[0]?.label ?? '—'
);
const axis = computed(() => parsePlacement(props.placement));

function choose(next: string | undefined): void {
  if (props.disabled || next === undefined) return;
  const changed = next !== value.value;
  value.value = next;
  if (changed) emit('valueChange', next);
}
</script>

<template>
  <NativeSelect
    v-if="native"
    v-bind="{ ...$attrs, options, label, disabled, size, variant, name, iconOnly }"
    :model-value="value"
    @value-change="choose"
  />
  <SelectRoot
    v-else
    v-bind="name ? { name } : {}"
    :model-value="toItem(value)"
    :disabled="disabled || options.length === 0"
    @update:model-value="(next) => choose(typeof next === 'string' ? fromItem(next) : undefined)"
  >
    <SelectTrigger
      v-bind="controlAttrs({ ...$attrs, 'aria-label': label || $attrs['aria-label'] })"
      class="ui-select"
      :class="[`ui-select--${size}`, { 'ui-select--ghost': variant === 'ghost' }]"
    >
      <span class="ui-select__value" :title="selectedLabel || undefined">
        <slot name="option-label" :text="selectedLabel">{{ selectedLabel }}</slot>
      </span>
      <span class="ui-select__chevron" aria-hidden="true">
        <ChevronDown />
      </span>
    </SelectTrigger>

    <SelectPortal>
      <SelectContent
        class="ui-menu ui-select__panel"
        position="popper"
        loop
        :side="axis.vertical"
        :align="axis.horizontal"
        :side-offset="4"
        :avoid-collisions="flip"
        :collision-padding="8"
        :aria-label="label || undefined"
      >
        <SelectViewport class="ui-select__viewport">
          <SelectItem
            v-for="option in options"
            :key="option.value"
            class="ui-menu__item"
            :lang="option.lang"
            :value="toItem(option.value)"
          >
            <SelectItemText class="ui-menu__text">
              <span class="ellipsis" :title="option.label || undefined"
                ><slot name="option-label" :text="option.label">{{ option.label }}</slot></span
              >
            </SelectItemText>
            <SelectItemIndicator class="ui-menu__indicator" aria-hidden="true"><Check /></SelectItemIndicator>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
