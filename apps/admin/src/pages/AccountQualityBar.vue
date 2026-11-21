<script setup lang="ts">
import { computed } from 'vue';
import type { VoiceQuality } from '@voice-room/shared/contracts/admin';
import { qualityShares } from './rooms/quality.ts';

const props = defineProps<{ quality: VoiceQuality; large?: boolean }>();
const levels = ['good', 'unstable', 'bad'] as const;
const shares = computed(() => qualityShares(props.quality));
</script>

<template>
  <span
    class="admin-account-quality"
    :class="{ 'admin-account-quality--large': large }"
    role="img"
    :aria-label="`Минуты связи: в порядке ${shares.good}%, нестабильно ${shares.unstable}%, плохо ${shares.bad}%`"
  >
    <template v-for="level in levels" :key="level">
      <span
        v-if="quality[level]"
        :class="`admin-account-quality__part--${level}`"
        :style="{ flexGrow: quality[level] }"
      />
    </template>
  </span>
</template>
