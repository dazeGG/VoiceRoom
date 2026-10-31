<script setup lang="ts">
import { computed, ref } from 'vue';

import { avatarInitial } from '@/shared/utils/avatar-initial';
import { getAvatarColor } from '@/visual/tokens';

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
  afk: false,
  ring: 'var(--vr-bg)'
});

const fontSize = computed(() => Math.round(props.size * 0.39));
// 11px on list-sized avatars, 17px on the big profile one.
const large = computed(() => props.size >= 56);
const dotSize = computed(() => (large.value ? 17 : 11));
const presence = computed(() => (props.dnd ? 'dnd' : props.afk ? 'afk' : props.online ? 'online' : 'offline'));
const initial = computed(() => avatarInitial(props.name));
const palette = computed(() => getAvatarColor(props.colorKey));
// A new src gets a fresh attempt: only the src that failed stays hidden.
const failedSrc = ref<string | null>(null);
const imageFailed = computed(() => failedSrc.value !== null && failedSrc.value === props.src);
</script>

<template>
  <span
    :class="['ui-avatar', { 'ui-avatar--squircle': shape === 'squircle' }]"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      fontSize: `${fontSize}px`,
      background: background || palette.background,
      color: foreground || (background ? 'var(--vr-text)' : palette.foreground)
    }"
    aria-hidden="true"
  >
    <img v-if="src && !imageFailed" :src="src" alt="" @error="failedSrc = src" />
    <template v-else>{{ initial }}</template>
    <span
      v-if="showDot"
      :class="['ui-avatar__dot', `ui-avatar__dot--${presence}`, { 'ui-avatar__dot--large': large }]"
      :style="{ width: `${dotSize}px`, height: `${dotSize}px`, borderColor: ring }"
    />
  </span>
</template>
