<script setup lang="ts">
import { AvatarFallback, AvatarImage, AvatarRoot } from 'reka-ui';
import { computed } from 'vue';

import { avatarInitial } from '@voiceroom/ui-kit/avatar-initial';
import { getAvatarColor } from '@voiceroom/ui-kit/avatar-colors';

import type { AvatarProps } from './types';

const props = withDefaults(defineProps<AvatarProps>(), {
  src: null,
  colorKey: '',
  size: 36,
  shape: 'circle',
  background: null,
  foreground: null,
  online: null,
  showDot: false,
  dnd: false,
  afk: false
});

const presence = computed(() => (props.dnd ? 'dnd' : props.afk ? 'afk' : props.online ? 'online' : 'offline'));
const palette = computed(() => getAvatarColor(props.colorKey));

defineSlots<{ fallback?(): unknown }>();
</script>

<template>
  <AvatarRoot
    :key="src ?? ''"
    as="span"
    :class="['ui-avatar', { 'ui-avatar--squircle': shape === 'squircle' }]"
    :style="{
      '--avatar-dimension': size === 80 ? undefined : `var(--size-${size}, ${size}px)`,
      '--ring': ring,
      background: background || palette.background,
      color: foreground || (background ? 'var(--vr-text)' : palette.foreground)
    }"
    aria-hidden="true"
  >
    <AvatarImage v-if="src" :src="src" alt="" />
    <AvatarFallback
      ><slot name="fallback">{{ avatarInitial(name) }}</slot></AvatarFallback
    >
    <span
      v-if="showDot"
      :class="[
        'ui-avatar__dot',
        `ui-avatar__dot--${presence}`,
        { 'ui-avatar__dot--small': size <= 28, 'ui-avatar__dot--large': size >= 56 }
      ]"
    />
  </AvatarRoot>
</template>
