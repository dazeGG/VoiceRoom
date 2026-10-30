<script setup lang="ts">
import { ImagePlus } from '@lucide/vue';
import { iconLg } from '@/shared/ui/icons';
</script>

<template>
  <div class="attachment-drop-overlay" role="status" aria-live="polite">
    <span class="attachment-drop-overlay__icon"><ImagePlus v-bind="iconLg" aria-hidden="true" /></span>
    <strong class="attachment-drop-overlay__title">Перетащите фото сюда</strong>
    <span class="attachment-drop-overlay__hint">JPEG, PNG или WebP до 10 МБ</span>
  </div>
</template>
