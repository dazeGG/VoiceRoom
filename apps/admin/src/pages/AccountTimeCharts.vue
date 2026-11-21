<script setup lang="ts">
import { onBeforeUnmount, useTemplateRef, watchEffect } from 'vue';
import { createElement, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AccountDetail } from '@voice-room/shared/contracts/admin';
import { TimeChart } from '../charts/TimeChart.tsx';
import { formatDay, formatHours } from '../format.ts';

const props = defineProps<{ days: AccountDetail['days'] }>();
const host = useTemplateRef<HTMLElement>('host');
// The chart itself moves to Vue with the rooms and calls phase.
let root: Root | undefined;
watchEffect(
  () => {
    if (!host.value) return;
    root ??= createRoot(host.value);
    const days = props.days;
    const labels = days.map((day) => formatDay(day.day));
    const common = { labels, kind: 'bar', height: 152 } as const;
    root.render(
      createElement(
        Fragment,
        null,
        createElement(TimeChart, {
          ...common,
          title: 'Сообщения за 90 дней',
          series: [{ name: 'Сообщения', values: days.map((day) => day.messages), color: 'var(--vr-accent)' }],
          note: `Активных дней: ${days.filter((day) => day.active).length} из ${days.length}.`
        }),
        createElement(TimeChart, {
          ...common,
          title: 'Войс за 90 дней',
          format: formatHours,
          series: [{ name: 'В войсе', values: days.map((day) => day.voiceMinutes / 60), color: 'var(--vr-success)' }]
        })
      )
    );
  },
  { flush: 'post' }
);
onBeforeUnmount(() => root?.unmount());
</script>

<template>
  <div ref="host" class="admin-account-card__charts" />
</template>
