<script setup lang="ts">
import { computed } from 'vue';
import type { AdminCallFeedbackEntry } from '@voice-room/shared/contracts/feedback';
import { CONCEALMENT_THRESHOLDS, networkLevelOfValue, type NetworkMeasure } from '@voice-room/shared/network-quality';
import { formatCount, formatMs, formatPercent } from '../../format.ts';

const props = defineProps<{ quality: NonNullable<AdminCallFeedbackEntry['quality']> }>();
/**
 * Where a call's numbers turn red, by the thresholds the room's connection pill
 * uses too: an average past unstable, a worst moment past bad (one spike in a
 * long call is normal), audible concealment, any reconnect, and a call through
 * the TURN relay. A busy computer alone is not red: the pressure reading is the
 * whole system's, and a game keeps it high through calls that sound fine.
 */
const averageBad = (measure: NetworkMeasure, value: number | null | undefined) => {
  const level = networkLevelOfValue(measure, value);
  return level === 'unstable' || level === 'bad';
};
const peakBad = (measure: NetworkMeasure, value: number | null | undefined) =>
  networkLevelOfValue(measure, value) === 'bad';

const worse = (a: number | null | undefined, b: number | null | undefined) =>
  a == null && b == null ? null : Math.max(a ?? 0, b ?? 0);

const parts = computed(() => {
  const { quality } = props;
  const loss = Math.max(quality.inboundLossAvgPct ?? 0, quality.outboundLossAvgPct ?? 0);
  const lossPeak = worse(quality.inboundLossMaxPct, quality.outboundLossMaxPct);
  const rttPeak = quality.rttMaxMs ?? null;
  const jitterPeak = quality.jitterMaxMs ?? null;
  const counted = (lost: number | undefined, packets: number | undefined, way: string) =>
    packets === undefined || lost === undefined
      ? null
      : `${way}: потеряно ${formatCount(lost)} из ${formatCount(packets)} пакетов`;
  const lossCounts = [
    counted(quality.inboundLostPackets, quality.inboundPackets, 'к вам'),
    counted(quality.outboundLostPackets, quality.outboundPackets, 'от вас')
  ].filter((line): line is string => line !== null);
  const details: { text: string; bad: boolean; title?: string }[] = [
    {
      text: `пинг ${formatMs(quality.rttAvgMs)}${rttPeak === null ? '' : ` (до ${formatMs(rttPeak)})`}`,
      bad: averageBad('rttMs', quality.rttAvgMs) || peakBad('rttMs', rttPeak)
    },
    {
      text: `потери ${formatPercent(loss)}${lossPeak === null ? '' : ` (до ${formatPercent(lossPeak)})`}`,
      bad: averageBad('lossPct', loss) || peakBad('lossPct', lossPeak),
      ...(lossCounts.length ? { title: lossCounts.join('\n') } : {})
    }
  ];
  const concealed = quality.concealedAvgPct ?? null;
  if (concealed !== null) {
    const peak = quality.concealedMaxPct ?? null;
    details.push({
      text: `звук додуман ${formatPercent(concealed)}${peak === null ? '' : ` (до ${formatPercent(peak)})`}`,
      bad: concealed >= CONCEALMENT_THRESHOLDS.noticeablePct || (peak ?? 0) >= CONCEALMENT_THRESHOLDS.badPct,
      title: 'Доля звука, которую плееру пришлось достроить: пакеты пришли поздно или не пришли'
    });
  }
  if (quality.jitterAvgMs !== null) {
    details.push({
      text: `джиттер ${formatMs(quality.jitterAvgMs)}${jitterPeak === null ? '' : ` (до ${formatMs(jitterPeak)})`}`,
      bad: averageBad('jitterMs', quality.jitterAvgMs) || peakBad('jitterMs', jitterPeak)
    });
  }
  if (quality.reconnects) details.push({ text: `переподкл. ${quality.reconnects}`, bad: true });
  if (quality.micDrops) details.push({ text: `микрофон отключался ${quality.micDrops}`, bad: true });
  if (quality.appCpuAvgPct != null) {
    const peak = quality.appCpuMaxPct;
    details.push({
      text: `процессор: VoiceRoom ${formatPercent(quality.appCpuAvgPct)}${
        peak == null ? '' : ` (до ${formatPercent(peak)})`
      } · всё ${formatPercent(quality.systemCpuAvgPct ?? null)}`,
      bad: false,
      title: 'Доля всего компьютера за звонок: сам VoiceRoom и всё вместе (с играми). Пик VoiceRoom — худшие 15 секунд.'
    });
  }
  if (quality.cpuPressureMax === 'critical' || quality.cpuPressureMax === 'serious') {
    details.push({
      text: quality.cpuRelieved ? 'система загружена · облегчённый шумодав' : 'система загружена',
      bad: false,
      title: 'Загрузка всего компьютера, не только звонка: например, шла игра'
    });
  }
  if (quality.transport === 'relay') details.push({ text: 'TURN', bad: true });
  if (quality.transport === 'tcp') details.push({ text: 'TCP', bad: false });
  return details;
});
</script>

<template>
  <span class="admin-feedback__quality admin-metric-mono">
    <span
      v-for="part in parts"
      :key="part.text"
      :class="{ 'admin-feedback__quality-part--bad': part.bad }"
      :title="part.title"
      >{{ part.text }}</span
    >
  </span>
</template>
