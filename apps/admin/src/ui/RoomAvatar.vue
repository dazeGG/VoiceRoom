<script setup lang="ts">
import visualIdentity from '@voice-room/shared/visual-identity';
import { Avatar } from '@voice-room/ui/components';
import { computed } from 'vue';

const props = withDefaults(defineProps<{ roomId: string; name: string | null; src?: string | null; size?: number }>(), {
  src: null,
  size: 36
});
const name = computed(() => props.name?.trim() || '#');
const palette = computed(() => {
  let hash = 0;
  for (const char of props.roomId) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  const keys = visualIdentity.AVATAR_COLOR_KEYS;
  return keys[hash % keys.length];
});
</script>

<template>
  <Avatar
    :name="name"
    :src="src"
    :size="size"
    shape="squircle"
    :color-key="palette"
    :background="name === '#' ? 'var(--vr-surface-3)' : undefined"
  >
    <template v-if="name === '#'" #fallback>#</template>
  </Avatar>
</template>
