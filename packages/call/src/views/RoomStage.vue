<script setup lang="ts">
import { t } from '@voiceroom/ui-kit/i18n';

defineProps<{ hidden: boolean }>();

defineSlots<{
  screen?(): unknown;
  tiles?(): unknown;
  dock?(): unknown;
  panel?(): unknown;
}>();
</script>

<template>
  <main id="roomScreen" class="room-layout" :hidden="hidden">
    <section class="stage" :aria-label="t('Голосовая комната')">
      <slot name="screen" />
      <slot name="tiles" />
      <slot name="dock" />
    </section>
    <slot name="panel" />
  </main>
</template>
