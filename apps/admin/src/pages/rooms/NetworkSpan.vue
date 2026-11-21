<script setup lang="ts">
import { computed } from 'vue';
import { describeStretch, stayStretches, type StayVoice } from './network-bar.ts';

const props = defineProps<{ from: number; to: number; voice: StayVoice }>();
const stretches = computed(() => stayStretches(props, props.voice));
</script>

<template>
  <span class="admin-network-span">
    <span
      v-for="stretch in stretches"
      :key="stretch.from"
      class="admin-network-span__stretch"
      :class="`admin-network--${stretch.level ?? 'unknown'}`"
      :title="describeStretch(stretch)"
      :style="{ flexGrow: Math.max(1, stretch.to - stretch.from) }"
    />
  </span>
</template>
