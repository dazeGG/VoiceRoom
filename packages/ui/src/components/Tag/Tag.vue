<script setup lang="ts">
import { X } from '@lucide/vue';
import { Toggle as RekaToggle } from 'reka-ui';
import { computed } from 'vue';
import { t } from '../../i18n';
import type { TagProps } from './types';

const props = withDefaults(defineProps<TagProps>(), { size: 'md', variant: 'default' });
const pressed = defineModel<boolean>('pressed', { default: false });
const emit = defineEmits<{ remove: [] }>();
const content = computed(() => (props.selectable ? RekaToggle : 'span'));
</script>

<template>
  <span
    :class="['ui-tag', `ui-tag--${size}`, { 'ui-tag--selected': !selectable && variant === 'reaction' && pressed }]"
  >
    <component
      :is="content"
      class="ui-tag__content"
      v-bind="selectable ? { modelValue: pressed, disabled, 'aria-label': label } : {}"
      @update:model-value="pressed = $event"
    >
      <span v-if="variant === 'reaction'" class="ui-tag__emoji">
        <slot name="emoji">{{ emoji }}</slot>
      </span>
      <slot />
      <span v-if="variant === 'reaction' && count !== undefined && !$slots.count" class="ui-tag__count">{{
        count
      }}</span>
    </component>
    <slot name="count" />
    <button
      v-if="removable"
      class="ui-tag__remove"
      type="button"
      :aria-label="t('Удалить')"
      :disabled="disabled"
      @click="emit('remove')"
    >
      <X aria-hidden="true" />
    </button>
  </span>
</template>
