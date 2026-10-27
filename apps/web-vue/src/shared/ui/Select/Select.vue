<script setup lang="ts">
import { ChevronDown } from '@lucide/vue';
import {
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectViewport
} from 'reka-ui';
import { computed } from 'vue';
import { Ellipsis } from '@/shared/ui/Ellipsis';
import { iconSm } from '@/shared/ui/icons';
import { parsePlacement } from '../Popover/popover-placement';
import type { SelectProps } from './types';

const props = withDefaults(defineProps<SelectProps>(), {
  options: () => [],
  label: '',
  disabled: false,
  placement: 'bottom-start',
  flip: false,
  variant: 'field'
});

// Reka's SelectItem throws on an empty value, but a device list starts with one
// (the system default), so '' travels through Reka as this stand-in.
const EMPTY_VALUE = '__select-empty__';
const toItem = (value: string): string => (value === '' ? EMPTY_VALUE : value);
const fromItem = (value: string): string => (value === EMPTY_VALUE ? '' : value);

const emit = defineEmits<{ valueChange: [value: string] }>();

const value = defineModel<string>({ default: '' });

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
  <div class="select">
    <SelectRoot
      :model-value="toItem(value)"
      :disabled="disabled || options.length === 0"
      @update:model-value="(next) => choose(typeof next === 'string' ? fromItem(next) : undefined)"
    >
      <SelectTrigger class="select__trigger" :class="`select__trigger--${variant}`" :aria-label="label || undefined">
        <span class="select__label">
          <Ellipsis :text="selectedLabel" :title="selectedLabel" />
        </span>
        <span class="select__chevron" aria-hidden="true">
          <ChevronDown v-bind="iconSm" />
        </span>
      </SelectTrigger>

      <SelectPortal>
        <SelectContent
          class="select__panel"
          position="popper"
          loop
          :side="axis.vertical"
          :align="axis.horizontal"
          :side-offset="10"
          :avoid-collisions="flip"
          :collision-padding="8"
          :aria-label="label || undefined"
        >
          <SelectViewport>
            <SelectItem
              v-for="option in options"
              :key="option.value"
              class="select__option"
              :value="toItem(option.value)"
            >
              <SelectItemText>
                <Ellipsis :text="option.label" :title="option.label" />
              </SelectItemText>
            </SelectItem>
          </SelectViewport>
        </SelectContent>
      </SelectPortal>
    </SelectRoot>
  </div>
</template>
