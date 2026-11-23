<script setup lang="ts">
import { computed, ref } from 'vue';
import { ArrowLeft, History } from '@lucide/vue';
import type { RoomCall, VoiceMinute } from '@voiceroom/shared/contracts/admin';
import { fetchLiveCall, fetchRoomCall } from '../api/admin.ts';
import { ApiError } from '../api/client.ts';
import {
  formatClock,
  formatCount,
  formatDayHeading,
  formatDuration,
  formatMs,
  formatPeople,
  formatPercent,
  plural
} from '../format.ts';
import { useRefreshStatus } from '../frame.ts';
import Notice from '../Notice.vue';
import type { CallRef } from '../tabs.ts';
import { useAdminResource } from '../use-admin-resource.ts';
import { Button, Callout, EmptyState, IconButton, Panel, Pill, RoomAvatar, Stat, Stats } from '../ui';
import CallAxis from './call/CallAxis.vue';
import CallEvents from './call/CallEvents.vue';
import CallFeedback from './call/CallFeedback.vue';
import CallPersonPanel from './call/CallPersonPanel.vue';
import MinuteChart from './call/MinuteChart.vue';
import { minutesOfPerson, personName } from './call/call-people.ts';
import {
  CONCEALED_LIMIT_PCT,
  DELAY_LIMIT_MS,
  LOSS_LIMIT_PCT,
  RTT_LIMIT_MS,
  delayOf,
  seriesOf,
  worstOf
} from './call/verdict.ts';
import CallPeople from './rooms/CallPeople.vue';
import type { HistoryRoom } from './rooms/history-room.ts';
import NetworkLegend from './rooms/NetworkLegend.vue';
import NetworkSpan from './rooms/NetworkSpan.vue';
import { qualityOfMinutes, qualityShares } from './rooms/quality.ts';
import { peopleOf, type CallPerson } from './rooms/room-bits.ts';

const LIVE_REFRESH_MS = 5000;
const TROUBLE_PCT = 5;
/** The most people in the call at once, and when that first happened. */
function peakOf(call: RoomCall): { people: number; at: number } {
  const moves = call.stays
    .flatMap((stay) => [
      { at: stay.joinedAt, delta: 1 },
      { at: stay.leftAt, delta: -1 }
    ])
    .sort((a, b) => a.at - b.at || a.delta - b.delta);
  let inside = 0;
  let peak = { people: 0, at: call.startedAt };
  for (const { at, delta } of moves) {
    inside += delta;
    if (inside > peak.people) peak = { people: inside, at };
  }
  return peak;
}

/** Those who came from the address another person in the call came from: a key is the same address, never the address itself. */
function sharedAddresses(people: readonly CallPerson[]): Map<string, CallPerson[]> {
  const byKey = new Map<string, CallPerson[]>();
  for (const person of people) {
    const key = person.seat.ipKey;
    if (key) byKey.set(key, [...(byKey.get(key) ?? []), person]);
  }
  return new Map([...byKey].filter(([, sharing]) => sharing.length > 1));
}

const props = defineProps<{ call: CallRef }>();
const emit = defineEmits<{ back: []; openAccount: [accountId: string]; openRoomHistory: [room: HistoryRoom] }>();
const live = computed(() => props.call.kind === 'live');
const ended = ref(false);
const polling = computed(() => live.value && !ended.value);
const { data, failure, busy, loadedAt, reload } = useAdminResource(
  async () => {
    const reference = props.call;
    if (reference.kind === 'finished') return fetchRoomCall(reference.callId);
    try {
      return await fetchLiveCall(reference.roomId);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'call_not_found') ended.value = true;
      throw cause;
    }
  },
  [() => props.call],
  { failureText: 'Не удалось загрузить звонок', refreshMs: () => (polling.value ? LIVE_REFRESH_MS : undefined) }
);
useRefreshStatus(() =>
  polling.value ? { at: loadedAt.value, everyMs: LIVE_REFRESH_MS, busy: busy.value, reload } : null
);
const selected = ref<string | null>(null);
const stats = computed(() => {
  const call = data.value?.call;
  if (!call) return null;
  const people = peopleOf(call);
  const allMinutes = call.stays.flatMap((stay) => stay.minutes ?? []);
  const quality = qualityOfMinutes(allMinutes);
  const shares = quality ? qualityShares(quality) : null;
  const judgedMinutes = quality ? quality.good + quality.unstable + quality.bad : 0;
  const peak = peakOf(call);
  const accounts = people.filter((one) => one.account).length;
  const guests = people.length - accounts;
  const rtt = seriesOf(allMinutes.map((minute) => minute.rttMs));
  const loss = seriesOf(allMinutes.map((minute) => minute.uplinkLossPct));
  const rttByPerson = people
    .map((one) => ({ name: personName(one), avg: seriesOf(minutesOfPerson(one).map((minute) => minute.rttMs)).avg }))
    .filter((one): one is { name: string; avg: number } => one.avg !== null)
    .sort((a, b) => b.avg - a.avg);
  const overloaded = people.filter((one) => minutesOfPerson(one).some((minute) => minute.cpuPressure === 'critical'));
  const shared = sharedAddresses(people);

  const named = Boolean(call.roomName) && call.roomName !== call.roomId;
  return {
    people,
    quality,
    shares,
    judgedMinutes,
    peak,
    accounts,
    guests,
    rtt,
    loss,
    worstRtt: rttByPerson[0],
    overloaded,
    shared,
    sharedKeys: new Set(shared.keys()),
    named
  };
});
const currentCall = computed(() => data.value?.call);
const person = computed(
  () => stats.value?.people.find((one) => one.key === selected.value) ?? stats.value?.people[0] ?? null
);
const minutes = computed(() => (person.value ? minutesOfPerson(person.value) : []));
const trouble = computed(() => Boolean(stats.value?.shares && stats.value.shares.bad >= TROUBLE_PCT));
const fm = (value: number | null) => (value === null ? '—' : formatMs(Math.round(value)));

const metrics: {
  label: string;
  limit: number;
  format: (value: number | null) => string;
  read: (minute: VoiceMinute) => number | null | undefined;
}[] = [
  { label: 'Задержка (RTT)', limit: RTT_LIMIT_MS, format: fm, read: (minute) => minute.rttMs },
  { label: 'Задержка голоса: пинг, буфер и кодек', limit: DELAY_LIMIT_MS, format: fm, read: delayOf },
  {
    label: 'Потери от участника к серверу',
    limit: LOSS_LIMIT_PCT,
    format: formatPercent,
    read: (minute) => minute.uplinkLossPct
  },
  {
    label: 'Как его слышали: додуманная речь, худшие 15 с минуты',
    limit: CONCEALED_LIMIT_PCT,
    format: formatPercent,
    read: (minute) => worstOf(minute.heardBy)
  },
  {
    label: 'Как он слышал: додуманная речь, худшие 15 с минуты',
    limit: CONCEALED_LIMIT_PCT,
    format: formatPercent,
    read: (minute) => worstOf(minute.heard)
  }
];
const charts = computed(() =>
  metrics.map(({ read, ...metric }) => ({
    ...metric,
    points: minutes.value.map((minute) => ({ at: minute.at, value: read(minute) }))
  }))
);
function spanStyle(from: number, to: number, call: RoomCall) {
  const length = Math.max(1, call.endedAt - call.startedAt);
  return {
    left: `${((from - call.startedAt) / length) * 100}%`,
    width: `${Math.max(1, ((to - from) / length) * 100)}%`
  };
}
</script>

<template>
  <div class="admin-call">
    <template v-if="failure && !data">
      <div class="admin-call__head">
        <IconButton label="Назад к комнатам" :size="32" @click="emit('back')"
          ><ArrowLeft aria-hidden="true"
        /></IconButton>
      </div>
      <EmptyState v-if="ended" :title="failure.message" compact />
      <Notice v-else :failure="failure" @retry="reload" />
    </template>
    <template v-else-if="data && currentCall && stats">
      <Callout v-if="failure && !ended" :title="failure.message" tone="danger" role="alert" />
      <section class="admin-call__head" aria-label="Звонок">
        <IconButton label="Назад к комнатам" :size="32" @click="emit('back')"
          ><ArrowLeft aria-hidden="true"
        /></IconButton>
        <RoomAvatar
          :room-id="currentCall.roomId"
          :name="stats.named ? currentCall.roomName : null"
          :src="currentCall.avatarUrl ?? null"
          :size="48"
        />
        <div class="admin-call__head-text">
          <div class="admin-call__title">
            <h2 :class="{ 'admin-rooms-mono': !stats.named }">
              {{ stats.named ? currentCall.roomName : currentCall.roomId }}
            </h2>
            <Pill v-if="currentCall.roomName === null" tone="danger" compact>удалена</Pill>
            <Pill v-else-if="currentCall.isStatic" tone="accent" compact>постоянная</Pill>
            <Pill v-else compact>временная</Pill>
            <Pill v-if="ended" compact>звонок закончился</Pill>
            <Pill v-else-if="live" tone="success" dot compact>идёт сейчас</Pill>
            <Pill v-if="trouble" tone="danger" dot compact>связь хуже нормы</Pill>
          </div>
          <span class="admin-call__note">
            {{ formatDayHeading(currentCall.startedAt, loadedAt ?? currentCall.endedAt) }},
            <span class="admin-rooms-mono"
              >{{ formatClock(currentCall.startedAt) }}–{{ live ? 'сейчас' : formatClock(currentCall.endedAt) }}</span
            >
            · {{ formatDuration(currentCall.endedAt - currentCall.startedAt) }} ·
            {{ formatPeople(stats.people.length) }}
            <template v-if="data.owner">
              · владелец <span class="admin-rooms-mono">@{{ data.owner.login }}</span></template
            >
            · код <span class="admin-rooms-mono">{{ currentCall.roomId }}</span>
          </span>
        </div>
        <div class="admin-call__actions">
          <Button
            size="sm"
            @click="currentCall && emit('openRoomHistory', { id: currentCall.roomId, name: currentCall.roomName })"
          >
            <template #icon><History aria-hidden="true" /></template>Все звонки комнаты
          </Button>
          <a v-if="data.feedback" class="admin-call__feedback-link" href="#feedback"
            >Отзывы · {{ formatCount(data.feedback.length) }}</a
          >
        </div>
      </section>

      <Stats label="Цифры звонка">
        <Stat label="Длительность" :note="`пик — ${formatPeople(stats.peak.people)} в ${formatClock(stats.peak.at)}`">
          {{ formatDuration(currentCall.endedAt - currentCall.startedAt) }}
        </Stat>
        <Stat
          label="Участников"
          :note="`${formatCount(stats.accounts)} ${plural(stats.accounts, ['аккаунт', 'аккаунта', 'аккаунтов'])} · ${formatCount(stats.guests)} ${plural(stats.guests, ['гость', 'гостя', 'гостей'])}`"
        >
          {{ formatCount(stats.people.length) }}
        </Stat>
        <Stat
          label="Плохих минут"
          :dot="trouble ? 'danger' : undefined"
          :tone="trouble ? 'danger' : undefined"
          :note="
            stats.quality
              ? `${formatCount(stats.quality.bad)} из ${formatCount(stats.judgedMinutes)} минут участников`
              : 'нет данных'
          "
        >
          {{ stats.shares ? formatCount(stats.shares.bad) + ' %' : '—' }}
        </Stat>
        <Stat
          label="Средний RTT"
          :note="stats.worstRtt ? `хуже всех — ${stats.worstRtt.name}, ${fm(stats.worstRtt.avg)}` : undefined"
        >
          {{ fm(stats.rtt.avg) }}
        </Stat>
        <Stat label="Потери на сервере" note="аудио, от участников к LiveKit">{{ formatPercent(stats.loss.avg) }}</Stat>
        <Stat
          label="Процессор перегружен"
          :dot="stats.overloaded.length ? 'warning' : undefined"
          :note="stats.overloaded.length ? stats.overloaded.map(personName).join(', ') : undefined"
        >
          {{ formatPeople(stats.overloaded.length) }}
        </Stat>
      </Stats>

      <Panel title="Кто и когда был в звонке" flush>
        <template #aside><NetworkLegend /></template>
        <div class="admin-rooms-scroll">
          <CallPeople
            :call="currentCall"
            :selected="person?.key ?? null"
            :shared-keys="stats.sharedKeys"
            selectable
            wide
            @select="selected = $event"
            @open-account="emit('openAccount', $event)"
          >
            <template #axis><CallAxis :from="currentCall.startedAt" :to="currentCall.endedAt" /></template>
          </CallPeople>
        </div>
        <p v-for="[key, sharing] in stats.shared" :key="key" class="admin-call__shared">
          {{
            `Одинаковый ключ адреса — один и тот же IP: ${sharing.map(personName).join(', ')}. Сам адрес не хранится.`
          }}
        </p>
      </Panel>

      <div v-if="person" class="admin-call__pair">
        <Panel class="admin-call__wide" :title="'Связь по минутам: ' + personName(person)">
          <template #aside><span class="admin-call__note">выберите участника в таблице выше</span></template>
          <EmptyState v-if="!minutes.length" title="Клиент не присылал статистику" compact />
          <template v-else>
            <MinuteChart
              v-for="chart in charts"
              :key="chart.label"
              v-bind="chart"
              :from="currentCall.startedAt"
              :to="currentCall.endedAt"
            />
            <div class="admin-call__levels">
              <span class="admin-minute-chart__label">Уровень связи</span>
              <span class="admin-call-bar admin-call__levels-bar" aria-hidden="true">
                <NetworkSpan
                  v-for="span in person.spans"
                  :key="span.from"
                  :from="span.from"
                  :to="span.to"
                  :voice="span"
                  :style="spanStyle(span.from, span.to, currentCall)"
                />
              </span>
              <CallAxis :from="currentCall.startedAt" :to="currentCall.endedAt" />
            </div>
          </template>
        </Panel>
        <CallPersonPanel :person="person" :events="data.events ?? []" @open-account="emit('openAccount', $event)" />
      </div>

      <div class="admin-call__pair">
        <CallEvents
          :events="data.events ?? []"
          :stays="currentCall.stays"
          :ended-at="live ? null : currentCall.endedAt"
        />
        <CallFeedback v-if="data.feedback" :entries="data.feedback" />
      </div>
    </template>
    <p v-else class="admin-rooms-loading" aria-busy="true">Загружаем…</p>
  </div>
</template>
