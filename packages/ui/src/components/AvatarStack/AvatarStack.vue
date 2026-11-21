<script setup lang="ts">
import { computed } from 'vue';

import { t } from '../../i18n';

import Avatar from '../Avatar/Avatar.vue';
import type { AvatarStackProps } from './types';

const props = withDefaults(defineProps<AvatarStackProps>(), { maxAvatars: 3, size: 24, ariaLabel: '' });

const visibleItems = computed(() => {
  const { items, maxAvatars } = props;
  if (maxAvatars == null || !Number.isFinite(maxAvatars) || maxAvatars <= 0) return items;
  return items.slice(0, Math.floor(maxAvatars));
});
const rest = computed(() => props.items.length - visibleItems.value.length);
const label = computed(() => {
  const names = visibleItems.value.map((item) => item.label).join(', ');
  const people =
    rest.value === 0
      ? names
      : names
        ? t('{p0} и ещё {p1}', { p0: names, p1: rest.value })
        : t('Ещё {p0}', { p0: rest.value });
  return props.ariaLabel ? t('{p0}: {p1}', { p0: props.ariaLabel, p1: people }) : people;
});
</script>

<template>
  <span
    v-if="items.length > 0"
    class="avatar-stack"
    :style="{ '--avatar-stack-size': `var(--size-${size}, ${size}px)` }"
    role="img"
    :aria-label="label"
  >
    <span
      v-for="item in visibleItems"
      :key="item.id"
      class="avatar-stack__item"
      :title="item.label"
      :style="{
        '--avatar-bg': item.background,
        '--avatar-fg': item.foreground,
        '--avatar-shadow': item.shadow || 'none'
      }"
    >
      <Avatar
        :name="item.label"
        :src="item.src"
        :size="size"
        :background="item.background"
        :foreground="item.foreground"
        class="avatar-stack__avatar"
      />
    </span>
    <span v-if="rest > 0" class="avatar-stack__rest">+{{ rest }}</span>
  </span>
  <slot v-else name="empty" />
</template>
