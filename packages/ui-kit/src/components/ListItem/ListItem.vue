<script setup lang="ts">
import { useId } from 'vue';
import Avatar from '../Avatar/Avatar.vue';
import type { ListItemProps } from './types';

defineOptions({ inheritAttrs: false });
defineProps<ListItemProps>();
const emit = defineEmits<{ activate: [event: MouseEvent] }>();
const id = useId();
function describe(hasCaption: boolean, hasMeta: boolean): string | undefined {
  const parts = [];
  if (hasCaption) parts.push(`${id}-caption`);
  if (hasMeta) parts.push(`${id}-meta`);
  return parts.join(' ') || undefined;
}
</script>

<template>
  <div class="ui-list-item" :class="{ 'ui-list-item--dense': dense }">
    <component
      :is="interactive ? 'button' : 'div'"
      :aria-labelledby="interactive && !$attrs['aria-label'] ? `${id}-title` : undefined"
      :aria-describedby="
        interactive ? describe(Boolean(caption || $slots.caption), Boolean(time || $slots.meta)) : undefined
      "
      :aria-current="selected ? 'true' : undefined"
      v-bind="$attrs"
      class="ui-list-item__body"
      :type="interactive ? 'button' : undefined"
      :disabled="interactive ? disabled : undefined"
      @click="interactive && emit('activate', $event)"
    >
      <Avatar v-if="avatar" v-bind="avatar" :size="dense ? 24 : 40" />
      <slot v-else name="leading" />
      <span class="ui-list-item__text">
        <span :id="`${id}-title`" class="ui-list-item__title"
          ><slot name="title">{{ text }}</slot></span
        >
        <span v-if="caption || $slots.caption" :id="`${id}-caption`" class="ui-list-item__caption">
          <slot name="caption">{{ caption }}</slot>
        </span>
      </span>
      <span v-if="time || $slots.meta" :id="`${id}-meta`" class="ui-list-item__meta">
        <slot name="meta">
          <component :is="dateTime ? 'time' : 'span'" class="ui-list-item__time" :datetime="dateTime">{{
            time
          }}</component>
        </slot>
      </span>
    </component>
    <div v-if="$slots.actions" class="ui-list-item__actions"><slot name="actions" /></div>
  </div>
</template>
