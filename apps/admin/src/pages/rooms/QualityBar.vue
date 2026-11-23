<script setup lang="ts">
import { computed } from 'vue';
import type { VoiceQuality } from '@voiceroom/shared/contracts/admin';
import { qualityShares } from './quality.ts';

const props = defineProps<{ quality: VoiceQuality; large?: boolean; separated?: boolean }>();
const shares = computed(() => qualityShares(props.quality));
const levels = ['good', 'unstable', 'bad'] as const;
</script>

<template>
  <span
    class="admin-quality-bar"
    :class="{ 'admin-quality-bar--large': large, 'admin-quality-bar--separated': separated }"
    role="img"
    :aria-label="`Минуты связи: в порядке ${shares.good}%, нестабильно ${shares.unstable}%, плохо ${shares.bad}%`"
  >
    <template v-for="level in levels" :key="level">
      <span v-if="quality[level]" :class="`admin-network--${level}`" :style="{ flexGrow: quality[level] }" />
    </template>
  </span>
</template>
