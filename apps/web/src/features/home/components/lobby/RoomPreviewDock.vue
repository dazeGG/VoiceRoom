<script setup lang="ts">
// Where the call dock sits in the room, before the viewer has joined: no
// audio or video yet, and one way in.
import { LogIn, VolumeX } from '@lucide/vue';
import { Button } from '@/shared/ui';
import { iconMd, iconSm } from '@/shared/ui/icons';

const emit = defineEmits<{ enter: [] }>();
</script>

<template>
  <div class="room-preview-dock">
    <span class="room-preview-dock__note">
      <VolumeX v-bind="iconSm" aria-hidden="true" />
      Звук и видео включатся после входа
    </span>
    <Button variant="primary" size="lg" @click="emit('enter')">
      <template #icon><LogIn v-bind="iconMd" aria-hidden="true" /></template>
      Войти в комнату
    </Button>
  </div>
</template>
