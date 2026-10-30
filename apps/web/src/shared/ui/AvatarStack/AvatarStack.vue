<script setup lang="ts">
import { computed } from 'vue';

import Avatar from '../Avatar/Avatar.vue';
import type { AvatarStackProps } from './types';

const props = withDefaults(defineProps<AvatarStackProps>(), { maxAvatars: 3, size: 24, ariaLabel: 'Участники' });

const visibleItems = computed(() => {
  const { items, maxAvatars } = props;
  if (!Number.isFinite(Number(maxAvatars)) || maxAvatars == null || maxAvatars <= 0) return items;
  return items.slice(0, Math.max(0, Math.floor(maxAvatars)));
});
const rest = computed(() => Math.max(0, props.items.length - visibleItems.value.length));
const fontSize = computed(() => Math.max(10, Math.round(props.size * 0.42)));
</script>

<template>
  <span
    v-if="items.length > 0"
    class="avatar-stack"
    :style="{ '--avatar-stack-size': `${size}px`, '--avatar-stack-font': `${fontSize}px` }"
    :aria-label="`${ariaLabel}: ${items.map((item) => item.label).join(', ')}`"
  >
    <span
      v-for="item in visibleItems"
      :key="item.id"
      class="avatar-stack__item"
      :title="item.label"
      role="img"
      :aria-label="item.label"
      :style="{
        '--avatar-bg': item.background,
        '--avatar-fg': item.foreground,
        '--avatar-shadow': item.shadow || 'none'
      }"
      ><Avatar
        :name="item.label"
        :src="item.src"
        :size="size - 4"
        :background="item.background"
        :foreground="item.foreground"
        class="avatar-stack__avatar"
    /></span>
    <span v-if="rest > 0" class="avatar-stack__rest" :aria-label="`Ещё ${rest}`">+{{ rest }}</span>
  </span>
  <slot v-else name="empty" />
</template>
