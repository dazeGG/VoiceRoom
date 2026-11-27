<script setup lang="ts">
import type { BadgeProps } from './types';

withDefaults(defineProps<BadgeProps>(), { size: 'md', tone: 'accent', variant: 'pill' });
</script>

<template>
  <span
    :role="label ? 'img' : undefined"
    :aria-label="label"
    :aria-hidden="variant === 'dot' && !label ? true : undefined"
    :class="[
      'ui-badge',
      `ui-badge--${size}`,
      `ui-badge--${tone}`,
      {
        'ui-badge--dot': variant === 'dot',
        'ui-badge--ring': ring
      }
    ]"
  >
    <template v-if="variant !== 'dot'">
      <template v-if="count !== undefined">{{ count > 99 ? '99+' : count }}</template>
      <slot v-else />
    </template>
  </span>
</template>
