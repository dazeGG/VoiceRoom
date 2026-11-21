<script setup lang="ts">
import { Search } from '@lucide/vue';
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxRoot,
  ComboboxViewport,
  type ComboboxRootEmits
} from 'reka-ui';
import { ref } from 'vue';
import { t } from '../../i18n';
import Field from '../Field/Field.vue';
import SuggestionRow from './SuggestionRow.vue';
import type { ComboboxOption, ComboboxProps } from './types';

const props = withDefaults(defineProps<ComboboxProps>(), { size: 'md', autoFocus: false });
const value = defineModel<string>({ default: '' });
const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{ select: [option: ComboboxOption] }>();
defineSlots<{
  avatar?(props: { option: ComboboxOption }): unknown;
  option?(props: { option: ComboboxOption }): unknown;
}>();

const highlighted = ref<unknown>();
type Highlight = ComboboxRootEmits['highlight'][0];

function updateHighlight(item: Highlight): void {
  highlighted.value = item?.value;
}

function select(next: unknown): void {
  if (next === '') value.value = '';
  const option = props.options.find((option) => option.value === next);
  if (!option) return;
  value.value = option.value;
  emit('select', option);
}

function displayValue(next: unknown): string {
  return props.options.find((option) => option.value === next)?.label ?? '';
}
</script>

<template>
  <Field v-slot="{ control }" :label="label">
    <ComboboxRoot
      v-model:open="open"
      class="ui-combobox"
      :model-value="value"
      :open-on-focus="true"
      :open-on-click="true"
      highlight-on-hover
      loop
      @update:model-value="select"
      @highlight="updateHighlight"
    >
      <ComboboxAnchor class="ui-input" :class="`ui-input--${size}`">
        <span class="ui-input__icon" aria-hidden="true"><Search /></span>
        <ComboboxInput
          v-bind="control"
          class="ui-input__control"
          :auto-focus="autoFocus"
          :display-value="displayValue"
          :placeholder="placeholder"
        />
      </ComboboxAnchor>
      <ComboboxContent class="ui-combobox__panel ui-menu">
        <ComboboxViewport class="ui-combobox__viewport">
          <ComboboxItem
            v-for="option in options"
            :key="option.value"
            class="ui-menu__item"
            :class="{
              'ui-menu__item--two-line': option.description || $slots.avatar,
              'ui-combobox__option--highlighted': highlighted === option.value
            }"
            :value="option.value"
            :text-value="option.searchText ?? option.label"
            :disabled="option.disabled ?? false"
            :aria-disabled="option.disabled || undefined"
            @mousedown.prevent
          >
            <SuggestionRow :label="option.label" :description="option.description">
              <template v-if="$slots.avatar" #avatar><slot name="avatar" :option="option" /></template>
              <slot name="option" :option="option">{{ option.label }}</slot>
            </SuggestionRow>
          </ComboboxItem>
          <ComboboxEmpty class="ui-combobox__empty" role="status">{{ t('Ничего не найдено') }}</ComboboxEmpty>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxRoot>
  </Field>
</template>
