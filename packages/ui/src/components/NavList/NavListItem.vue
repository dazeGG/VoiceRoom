<script setup lang="ts">
import { computed } from 'vue';
import type { NavListItemProps } from './types';

const props = withDefaults(defineProps<NavListItemProps>(), { tone: 'default', current: undefined });
const emit = defineEmits<{ click: [event: MouseEvent] }>();

const target = computed(() => (props.to !== undefined ? 'RouterLink' : props.href !== undefined ? 'a' : 'button'));
const attrs = computed(() => {
  const current = props.current ? 'page' : undefined;
  if (props.to !== undefined) return { to: props.to, ...(props.current !== undefined && { 'aria-current': current }) };
  if (props.href !== undefined) return { href: props.href, 'aria-current': current };
  return { type: 'button', disabled: props.disabled, 'aria-current': current };
});
</script>

<template>
  <component
    :is="target"
    v-bind="attrs"
    class="ui-nav__item"
    :class="{ 'ui-nav__item--danger': tone === 'danger' }"
    @click="emit('click', $event)"
  >
    <span v-if="$slots.icon" class="ui-nav__icon" aria-hidden="true"><slot name="icon" /></span>
    <span class="ui-nav__text">{{ label }}</span>
    <slot name="trailing" />
  </component>
</template>
