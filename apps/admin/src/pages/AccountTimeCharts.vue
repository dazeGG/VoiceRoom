<script setup lang="ts">
import { computed } from 'vue';
import type { AccountDetail } from '@voice-room/shared/contracts/admin';
import TimeChart from '../charts/TimeChart.vue';
import { formatDay, formatHours } from '../format.ts';

const props = defineProps<{ days: AccountDetail['days'] }>();
const labels = computed(() => props.days.map((day) => formatDay(day.day)));
const messages = computed(() => [
  { name: 'Сообщения', values: props.days.map((day) => day.messages), color: 'var(--vr-accent)' }
]);
const voice = computed(() => [
  { name: 'В войсе', values: props.days.map((day) => day.voiceMinutes / 60), color: 'var(--vr-success)' }
]);
const active = computed(() => props.days.filter((day) => day.active).length);
</script>

<template>
  <div class="admin-account-card__charts">
    <TimeChart
      title="Сообщения за 90 дней"
      :labels="labels"
      kind="bar"
      :height="152"
      :series="messages"
      :note="`Активных дней: ${active} из ${days.length}.`"
    />
    <TimeChart
      title="Войс за 90 дней"
      :labels="labels"
      kind="bar"
      :height="152"
      :series="voice"
      :format="formatHours"
    />
  </div>
</template>
