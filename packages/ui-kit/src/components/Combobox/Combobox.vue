<script setup lang="ts">
import { Search } from '@lucide/vue';
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxRoot,
  ComboboxViewport,
  type ComboboxRootEmits
} from 'reka-ui';
import { computed, ref, useTemplateRef, watch } from 'vue';
import { t } from '../../i18n';
import Field from '../Field/Field.vue';
import SuggestionRow from './SuggestionRow.vue';
import type { ComboboxOption, ComboboxProps } from './types';

const props = withDefaults(defineProps<ComboboxProps>(), { size: 'md', autoFocus: false });
const value = defineModel<string>({ default: '' });
const open = defineModel<boolean>('open', { default: false });
const query = defineModel<string>('query', { default: '' });
const emit = defineEmits<{ select: [option: ComboboxOption] }>();
defineSlots<{
  avatar?(props: { option: ComboboxOption }): unknown;
  option?(props: { option: ComboboxOption }): unknown;
  trailing?(): unknown;
}>();

const root = useTemplateRef<{ highlightFirstItem?: () => void }>('root');
const expanded = computed({
  get: () => props.inline || (open.value && (!props.externalFilter || query.value.trim() !== '')),
  set: (next: boolean) => {
    open.value = next;
  }
});
const groups = computed(() => {
  const byLabel = new Map<string, ComboboxOption[]>();
  for (const option of props.options) {
    const label = option.group ?? '';
    const items = byLabel.get(label);
    if (items) items.push(option);
    else byLabel.set(label, [option]);
  }
  return byLabel;
});
watch(
  [expanded, () => props.options],
  ([shown]) => {
    if (props.externalFilter && shown && props.options.length) root.value?.highlightFirstItem?.();
  },
  { flush: 'post' }
);

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

function selectInline(event: Event, option: ComboboxOption): void {
  if (!props.inline) return;
  event.preventDefault();
  emit('select', option);
}

function displayValue(next: unknown): string {
  return props.options.find((option) => option.value === next)?.label ?? '';
}

function updateQuery(next: string): void {
  if (props.externalFilter) query.value = next;
}
</script>

<template>
  <Field v-slot="{ control }" :label="label" :visually-hidden-label="visuallyHiddenLabel">
    <ComboboxRoot
      ref="root"
      v-model:open="expanded"
      class="ui-combobox"
      :class="{ 'ui-combobox--inline': inline }"
      :model-value="value"
      :ignore-filter="externalFilter"
      :reset-search-term-on-blur="!externalFilter"
      :reset-search-term-on-select="!externalFilter"
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
          v-bind="{
            ...control,
            ...(label ? { 'aria-label': label } : {}),
            ...(externalFilter ? { modelValue: query } : {})
          }"
          class="ui-input__control"
          :auto-focus="autoFocus"
          :display-value="displayValue"
          :placeholder="placeholder"
          @update:model-value="updateQuery"
        />
        <slot name="trailing" />
      </ComboboxAnchor>
      <ComboboxContent
        class="ui-combobox__panel"
        :class="{ 'ui-menu': !inline, 'ui-combobox__panel--overlay': overlay && !inline }"
        :aria-label="resultsLabel"
        :aria-busy="loading || undefined"
      >
        <ComboboxViewport class="ui-combobox__viewport">
          <ComboboxGroup v-for="[group, items] in groups" :key="group">
            <ComboboxLabel v-if="group" class="ui-menu__label">{{ group }}</ComboboxLabel>
            <ComboboxItem
              v-for="option in items"
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
              @select="selectInline($event, option)"
            >
              <SuggestionRow :label="option.label" :description="option.description">
                <template v-if="$slots.avatar" #avatar><slot name="avatar" :option="option" /></template>
                <slot name="option" :option="option">{{ option.label }}</slot>
              </SuggestionRow>
            </ComboboxItem>
          </ComboboxGroup>
          <div v-if="loading" class="ui-combobox__empty" role="status">{{ t('Ищем…') }}</div>
          <ComboboxEmpty v-else class="ui-combobox__empty" role="status">{{ t('Ничего не найдено') }}</ComboboxEmpty>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxRoot>
  </Field>
</template>
