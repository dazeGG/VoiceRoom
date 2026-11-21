<script setup lang="ts">
import { computed } from 'vue';
import { formatClock } from '../../format.ts';

const props = defineProps<{ from: number; to: number }>();
const TICK_MS = 30 * 60_000;
/** The moments an axis marks: every half hour on the hour, or the ends of a short call. */
function ticksOf(from: number, to: number): number[] {
  if (to - from < TICK_MS) return [from, to];
  const first = Math.ceil(from / TICK_MS) * TICK_MS;
  const ticks: number[] = [];
  for (let at = first; at <= to; at += TICK_MS) ticks.push(at);
  return ticks;
}

const marks = computed(() =>
  ticksOf(props.from, props.to).map((at) => {
    const share = ((at - props.from) / Math.max(1, props.to - props.from)) * 100;
    return { at, share, edge: share < 8 ? 'start' : share > 92 ? 'end' : 'middle' };
  })
);
</script>

<template>
  <span class="admin-call-axis admin-rooms-mono" aria-hidden="true">
    <span
      v-for="{ at, share, edge } in marks"
      :key="at"
      class="admin-call-axis__tick"
      :class="'admin-call-axis__tick--' + edge"
      :style="{ left: share + '%' }"
      >{{ formatClock(at) }}</span
    >
  </span>
</template>
