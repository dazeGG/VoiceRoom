<script setup lang="ts">
import { ListboxContent, ListboxItem, ListboxRoot } from 'reka-ui';
import { watchPostEffect } from 'vue';
import { t } from '../../i18n';
import SuggestionRow from './SuggestionRow.vue';
import type { ComboboxOption } from './types';

const props = defineProps<{
  id: string;
  label: string;
  active: string | undefined;
  options: readonly ComboboxOption[];
}>();
const emit = defineEmits<{ select: [option: ComboboxOption] }>();
defineSlots<{
  avatar?(props: { option: ComboboxOption }): unknown;
  option?(props: { option: ComboboxOption }): unknown;
}>();

// The input and its caret stay with the host composer. Scroll within this
// popup when the composer changes its active descendant.
watchPostEffect(() => {
  if (!props.active) return;
  const list = document.getElementById(props.id);
  const option = document.getElementById(props.id + '-' + props.active);
  if (!list || !option) return;
  const top = option.offsetTop;
  const bottom = top + option.offsetHeight;
  if (top < list.scrollTop) list.scrollTop = top;
  else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
});
</script>

<template>
  <ListboxRoot>
    <ListboxContent as-child>
      <div :id="id" class="ui-combobox__panel ui-combobox__viewport ui-menu" :aria-label="label" tabindex="-1">
        <ListboxItem
          v-for="option in options"
          :key="option.value"
          :value="option.value"
          :disabled="option.disabled ?? false"
          as-child
          @mousedown.prevent
          @select.prevent="option.disabled || emit('select', option)"
        >
          <div
            :id="id + '-' + option.value"
            class="ui-menu__item"
            :class="{ 'ui-menu__item--two-line': option.description || $slots.avatar }"
            :aria-selected="active === option.value"
            :aria-disabled="option.disabled || undefined"
            tabindex="-1"
          >
            <SuggestionRow :label="option.label" :description="option.description">
              <template v-if="$slots.avatar" #avatar><slot name="avatar" :option="option" /></template>
              <slot name="option" :option="option">{{ option.label }}</slot>
            </SuggestionRow>
          </div>
        </ListboxItem>
        <p v-if="options.length === 0" class="ui-combobox__empty" role="status">{{ t('Ничего не найдено') }}</p>
      </div>
    </ListboxContent>
  </ListboxRoot>
</template>
