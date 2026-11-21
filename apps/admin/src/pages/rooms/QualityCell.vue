<script setup lang="ts">
import type { VoiceQuality } from '@voiceroom/shared/contracts/admin';
import { qualityAlarming, qualityLong, qualityShort } from './quality.ts';
import QualityBar from './QualityBar.vue';

withDefaults(defineProps<{ quality: VoiceQuality | null; long?: boolean; none?: string }>(), { none: 'нет данных' });
</script>

<template>
  <span v-if="quality" class="admin-quality-cell">
    <QualityBar :quality="quality" separated />
    <span class="admin-quality-cell__text" :class="{ 'admin-quality-cell__text--alarm': qualityAlarming(quality) }">
      {{ long ? qualityLong(quality) : qualityShort(quality) }}
    </span>
  </span>
  <span v-else class="admin-quality-cell__none">{{ none }}</span>
</template>
