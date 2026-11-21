<script setup lang="ts">
import { ParticipantTileFace } from '@voiceroom/ui-kit/components';
import EmojiText from '@/shared/chat/EmojiText.vue';

defineProps<{
  name: string;
  initials: string;
  avatarSrc?: string | null;
  local?: boolean;
  statusLabel?: string | undefined;
}>();
</script>

<template>
  <ParticipantTileFace v-bind="$props">
    <template #name><EmojiText :text="name" /></template>
    <template #badge><slot name="badge" /></template>
    <slot />
  </ParticipantTileFace>
</template>
