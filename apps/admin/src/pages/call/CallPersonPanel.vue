<script setup lang="ts">
import { computed } from 'vue';
import type { CallEvent } from '@voiceroom/shared/contracts/admin';
import { CONCEALMENT_THRESHOLDS } from '@voiceroom/shared/network-quality';
import { formatClock, formatCount, formatDuration, formatMs, formatPercent } from '../../format.ts';
import { Avatar, Button, Panel } from '../../ui';
import type { CallPerson } from '../rooms/room-bits.ts';
import { minutesOfPerson, personName } from './call-people.ts';
import {
  DELAY_LIMIT_MS,
  LOSS_LIMIT_PCT,
  RTT_LIMIT_MS,
  delayOf,
  heardSummary,
  seriesOf,
  verdictOf,
  type HeardSummary
} from './verdict.ts';

const props = defineProps<{ person: CallPerson; events: readonly CallEvent[] }>();
const emit = defineEmits<{ openAccount: [accountId: string] }>();
const name = computed(() => personName(props.person));
const minutes = computed(() => minutesOfPerson(props.person));
const verdict = computed(() => verdictOf(minutes.value));

const TRANSPORTS: Record<string, string> = { udp: 'UDP', tcp: 'TCP', relay: 'через ретранслятор (TURN)' };

/** How one side of a voice went over the call: its whole share, and its worst moment, which the share waters down. */
function heardFact(
  label: string,
  summary: HeardSummary
): { label: string; value: string; tone?: 'warning' | 'danger' } {
  const { noticeablePct, badPct } = CONCEALMENT_THRESHOLDS;
  const { concealedPct, worstConcealedPct, worstGaps } = summary;
  if (concealedPct < 1 && worstConcealedPct < noticeablePct) return { label, value: 'в порядке' };
  const gaps = worstGaps === null ? '' : `, разрывов до ${formatCount(worstGaps)}`;
  const value = `додумано ${formatPercent(Math.round(concealedPct * 10) / 10)} речи · худшие 15 с: до ${formatPercent(worstConcealedPct)}${gaps}`;
  if (concealedPct >= badPct) return { label, value, tone: 'danger' };
  return concealedPct >= noticeablePct || worstConcealedPct >= noticeablePct
    ? { label, value, tone: 'warning' }
    : { label, value };
}

const facts = computed(() => {
  const { person, events } = props;
  const samples = minutes.value;
  const ids = new Set(person.stayIds);
  const own = events.filter((event) => event.stayId !== null && ids.has(event.stayId));
  const spansOf = (on: CallEvent['kind'], off: CallEvent['kind']) =>
    own
      .filter((event) => event.kind === on || event.kind === off)
      .map((event) => `${event.kind === on ? 'с' : 'до'} ${formatClock(event.at)}`)
      .join(', ');
  const heard = heardSummary(samples.map((minute) => minute.heard));
  const heardBy = heardSummary(samples.map((minute) => minute.heardBy));
  const rtt = seriesOf(samples.map((minute) => minute.rttMs));
  const buffer = seriesOf(samples.map((minute) => minute.jitterBufferMs));
  const delay = seriesOf(samples.map(delayOf));
  const loss = seriesOf(samples.map((minute) => minute.uplinkLossPct));
  const app = seriesOf(samples.map((minute) => minute.cpuAppPct));
  const system = seriesOf(samples.map((minute) => minute.cpuSystemPct));
  const firstCritical = own.find((event) => event.kind === 'cpu_critical');
  const firstRelief = own.find(
    (event) =>
      event.kind === 'relieved_ns' ||
      (event.kind === 'relief' && event.relief?.kind === 'noise' && event.relief.outcome === 'applied')
  );
  const transport = samples.at(-1)?.transport ?? null;
  const screen = spansOf('screen_on', 'screen_off');
  const camera = spansOf('camera_on', 'camera_off');
  const facts: { label: string; value: string; tone?: 'warning' | 'danger' }[] = [
    {
      label: 'Был в звонке',
      value: `${person.spans.map((span) => `${formatClock(span.from)}–${formatClock(span.to)}`).join(', ')} · ${formatDuration(person.total)}`
    }
  ];
  const clientLine = [
    person.seat.client === 'desktop_app' ? 'приложение' : person.seat.client ? 'браузер' : '',
    person.seat.os,
    person.seat.browser
  ]
    .filter(Boolean)
    .join(' · ');
  if (clientLine) facts.push({ label: 'Клиент', value: clientLine });
  if (person.seat.location) facts.push({ label: 'Откуда', value: person.seat.location });
  if (transport) facts.push({ label: 'Транспорт', value: TRANSPORTS[transport] ?? transport });
  if (screen) facts.push({ label: 'Показ экрана', value: screen });
  if (camera) facts.push({ label: 'Камера', value: camera });
  if (rtt.avg !== null) {
    facts.push({
      label: 'Средний RTT',
      value: formatMs(Math.round(rtt.avg)),
      ...(rtt.avg >= RTT_LIMIT_MS ? { tone: 'danger' as const } : {})
    });
  }
  if (buffer.avg !== null) facts.push({ label: 'Буфер', value: formatMs(Math.round(buffer.avg)) });
  if (delay.avg !== null) {
    facts.push({
      label: 'Задержка голоса',
      value: `около ${formatMs(Math.round(delay.avg))}`,
      ...(delay.avg >= DELAY_LIMIT_MS ? { tone: 'warning' as const } : {})
    });
  }
  if (loss.avg !== null) {
    facts.push({
      label: 'Потери от него',
      value: `${formatPercent(loss.avg)}${loss.peak === null ? '' : ` · до ${formatPercent(loss.peak)}`}`,
      ...(loss.avg >= LOSS_LIMIT_PCT ? { tone: 'danger' as const } : {})
    });
  }
  if (app.avg !== null || system.avg !== null) {
    facts.push({
      label: 'Процессор',
      value: `VoiceRoom ${formatPercent(app.avg === null ? null : Math.round(app.avg))} · всё ${formatPercent(system.avg === null ? null : Math.round(system.avg))}`,
      ...((system.avg ?? 0) >= 90 ? { tone: 'danger' as const } : {})
    });
  }
  if (firstCritical) {
    facts.push({ label: 'Нагрузка системы', value: `critical с ${formatClock(firstCritical.at)}`, tone: 'danger' });
  }
  if (firstRelief) facts.push({ label: 'Шумодав', value: `облегчённый с ${formatClock(firstRelief.at)}` });
  if (heardBy) facts.push(heardFact('Как его слышали', heardBy));
  if (heard) facts.push(heardFact('Как он слышал', heard));

  return facts;
});
</script>

<template>
  <Panel class="admin-call-person" role="complementary" :aria-label="`Участник: ${name}`">
    <div class="admin-call-person__head">
      <Avatar
        :name="name"
        :src="person.account?.avatarUrl ?? null"
        :color-key="person.account?.avatarColorKey ?? ''"
        :background="person.account?.avatarAccent ?? null"
        :size="40"
      />
      <span class="admin-call-person__title">
        <span>{{ name }}</span>
        <span class="admin-call-person__login admin-rooms-mono">{{
          person.account ? '@' + person.account.login : 'гость'
        }}</span>
      </span>
      <Button
        v-if="person.account"
        size="sm"
        variant="plain"
        @click="person.account && emit('openAccount', person.account.id)"
        >Аккаунт</Button
      >
    </div>
    <div class="admin-call-person__verdict" :class="'admin-tone--' + verdict.tone">
      <span class="admin-call-person__verdict-title">{{ verdict.title }}</span>
      <span class="admin-call-person__verdict-text">{{ verdict.text }}</span>
    </div>
    <dl class="admin-call-person__facts">
      <div v-for="fact in facts" :key="fact.label">
        <dt>{{ fact.label }}</dt>
        <dd :class="fact.tone && 'admin-tone--' + fact.tone">{{ fact.value }}</dd>
      </div>
    </dl>
  </Panel>
</template>
