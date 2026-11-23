<script setup lang="ts">
import { Pressable } from '@voiceroom/ui-kit/components';
import { ThumbsDown } from '@lucide/vue';
import { computed, ref } from 'vue';
import type { AdminOverview, ProductStats, SystemStats } from '@voiceroom/shared/contracts/admin';
import { getAvatarPresentation } from '@voiceroom/ui/avatar-presentation';
import { fetchLiveRooms, fetchOverview, fetchProductStats, fetchRoomCalls, fetchSystemStats } from '../api/admin.ts';
import type { ChartSeries } from '../charts/chart-series.ts';
import TimeChart from '../charts/TimeChart.vue';
import {
  formatClock,
  formatCount,
  formatDay,
  formatShortDay,
  formatDuration,
  formatHours,
  formatPeople,
  formatSampleTime,
  formatSince,
  plural
} from '../format.ts';
import { useRefreshStatus } from '../frame.ts';
import Notice from '../Notice.vue';
import { useCan } from '../staff.store.ts';
import type { AdminTab, CallRef } from '../tabs.ts';
import { PRODUCT_PRESETS, productQuery } from '../time-range.ts';
import { AvatarStack, Button, Card, EmptyState, Pill, RoomAvatar, Section, SegmentControl, Stat, Stats } from '../ui';
import { useAdminResource } from '../use-admin-resource.ts';
import OverviewAttention from './overview/OverviewAttention.vue';
import OverviewDelta from './overview/OverviewDelta.vue';
import OverviewFeedback from './overview/OverviewFeedback.vue';
import OverviewServer from './overview/OverviewServer.vue';
import { roomName } from './overview/overview-details.ts';
import QualityCell from './rooms/QualityCell.vue';
import { troubleOf } from './rooms/live-quality.ts';
import { qualityOfCall } from './rooms/quality.ts';
import { peopleOf } from './rooms/room-bits.ts';
import { percent } from './system-metrics.ts';

const REFRESH_MS = 30_000;
const LIVE_REFRESH_MS = 5000;
const DAY = 24 * 60 * 60 * 1000;
const RECENT_CALLS = 6;
type HoursPeriod = '7d' | '14d' | '30d';
const HOURS_PERIODS: { value: HoursPeriod; label: string }[] = [
  { value: '7d', label: '7 дней' },
  { value: '14d', label: '14 дней' },
  { value: '30d', label: '30 дней' }
];
const wholePercent = (value: number) => `${Math.round(value)}%`;
const voiceHours = (day: ProductStats['days'][number] | undefined) =>
  day ? Math.round((day.voiceAccountHours + day.voiceGuestHours) * 10) / 10 : 0;

function loadDashboard(): Promise<[AdminOverview, ProductStats, SystemStats]> {
  const at = Date.now();
  return Promise.all([
    fetchOverview(),
    fetchProductStats(productQuery({ kind: 'preset', id: '14d' }, PRODUCT_PRESETS, at)),
    fetchSystemStats({ from: String(at - DAY), to: String(at) })
  ]);
}

const emit = defineEmits<{
  openReports: [];
  openTab: [tab: AdminTab];
  openAccount: [accountId: string];
  openCall: [call: CallRef];
  openLiveRoom: [roomId: string];
}>();
const canReview = useCan('reports.review');
const canRooms = useCan('rooms.view');
const dashboard = useAdminResource(loadDashboard, [], {
  failureText: 'Не удалось загрузить обзор',
  refreshMs: REFRESH_MS
});
const live = useAdminResource(() => (canRooms.value ? fetchLiveRooms() : Promise.resolve(null)), [canRooms], {
  failureText: 'Не удалось загрузить звонки',
  refreshMs: LIVE_REFRESH_MS
});
const recent = useAdminResource(() => (canRooms.value ? fetchRoomCalls({}) : Promise.resolve(null)), [canRooms], {
  failureText: 'Не удалось загрузить звонки',
  refreshMs: REFRESH_MS
});
const period = ref<HoursPeriod>('14d');
const hours = useAdminResource(
  () => fetchProductStats(productQuery({ kind: 'preset', id: period.value }, PRODUCT_PRESETS, Date.now())),
  [period],
  { failureText: 'Не удалось загрузить часы в войсе', refreshMs: REFRESH_MS }
);

function reload(): void {
  dashboard.reload();
  live.reload();
  recent.reload();
  hours.reload();
}
useRefreshStatus(() =>
  canRooms.value
    ? { at: live.loadedAt.value, everyMs: LIVE_REFRESH_MS, busy: live.busy.value, reload, what: 'звонки' }
    : { at: dashboard.loadedAt.value, everyMs: REFRESH_MS, busy: dashboard.busy.value, reload }
);

const now = computed(() => Math.max(dashboard.heardAt.value ?? 0, live.heardAt.value ?? 0));
const overview = computed(() => dashboard.data.value?.[0]);
const system = computed(() => dashboard.data.value?.[2]);
const days = computed(() => dashboard.data.value?.[1].days ?? []);
const samples = computed(() => system.value?.samples ?? []);
const dayLabels = computed(() => days.value.map((day) => formatDay(day.day)));
const sampleLabels = computed(() => samples.value.map((sample) => formatSampleTime(sample.at, false)));
const today = computed(() => days.value.at(-1));
const yesterday = computed(() => days.value.at(-2));
const newThisWeek = computed(() => days.value.slice(-7).reduce((sum, day) => sum + day.newAccounts, 0));
const finishedToday = computed(() => overview.value?.today.calls);
const rooms = computed(() => live.data.value?.rooms ?? null);
const liveRows = computed(() =>
  rooms.value?.map((room) => ({
    room,
    trouble: troubleOf(room.peers),
    avatars: room.peers.map((peer) => ({
      id: peer.peerId,
      ...getAvatarPresentation({
        name: peer.name,
        avatarUrl: peer.account?.avatarUrl ?? undefined,
        avatarColorKey: peer.account?.avatarColorKey ?? peer.avatarColorKey,
        avatarAccent: peer.account?.avatarAccent ?? undefined,
        isLocal: false
      })
    }))
  }))
);
const liveCount = computed(() => rooms.value?.length ?? overview.value?.live.voiceRooms ?? 0);
const peopleInVoice = computed(() => rooms.value?.reduce((sum, room) => sum + room.peers.length, 0) ?? 0);
const calls = computed(() => recent.data.value?.calls.slice(0, RECENT_CALLS) ?? null);
const callsToday = computed(() =>
  (recent.data.value?.calls ?? []).filter((call) => formatShortDay(call.startedAt, now.value) === 'сегодня')
);
const callsTodayMs = computed(() => callsToday.value.reduce((sum, call) => sum + (call.endedAt - call.startedAt), 0));
const callsTodayCount = computed(() => finishedToday.value ?? callsToday.value.length);

const hoursChart = computed(() => {
  const stats = hours.data.value;
  if (!stats) return null;
  const { days } = stats;
  const total = days.reduce((sum, day) => sum + day.voiceAccountHours + day.voiceGuestHours, 0);
  return {
    title: `${formatHours(total)} за ${formatCount(days.length)} ${plural(days.length, ['день', 'дня', 'дней'])}`,
    labels: days.map((day) => formatDay(day.day)),
    series: [
      { name: 'Аккаунты', values: days.map((day) => day.voiceAccountHours), color: 'var(--vr-success)' },
      { name: 'Гости', values: days.map((day) => day.voiceGuestHours), color: 'var(--vr-warning)' }
    ] satisfies ChartSeries[],
    today: voiceHours(days.at(-1)),
    yesterday: voiceHours(days.at(-2))
  };
});
</script>

<template>
  <Notice v-if="dashboard.failure.value && !overview" :failure="dashboard.failure.value" @retry="dashboard.reload" />
  <p v-else-if="!overview || !system" class="admin-metric-note" aria-busy="true">Загружаем…</p>
  <template v-else>
    <OverviewAttention
      :overview="overview"
      :rooms="rooms"
      :calls="calls"
      :can-review="canReview"
      :now="now"
      @open-reports="emit('openReports')"
      @open-tab="emit('openTab', $event)"
      @open-account="emit('openAccount', $event)"
      @open-call="emit('openCall', $event)"
    />

    <Stats label="Главное сейчас">
      <Stat
        label="Онлайн сейчас"
        dot="accent"
        :note="`и ${formatCount(overview.live.guestConnections)} гостевых подключений`"
      >
        {{ formatCount(overview.live.onlineAccounts) }}
      </Stat>
      <Stat label="В войсе сейчас" dot="success" :note="`в ${formatCount(overview.live.voiceRooms)} комнатах`">
        {{ formatCount(overview.live.voicePeers) }}
      </Stat>
      <Stat label="Часов в войсе сегодня" dot="success">
        {{ formatHours(voiceHours(today)) }}
        <template #note
          ><OverviewDelta :current="voiceHours(today)" :previous="voiceHours(yesterday)" unit="ч к вчера"
        /></template>
      </Stat>
      <Stat v-if="finishedToday !== undefined" label="Звонков сегодня">
        {{ formatCount(finishedToday + liveCount) }}
        <template #note
          ><OverviewDelta :current="finishedToday" :previous="overview.today.callsYesterday ?? 0" unit="к вчера" /> ·
          {{ formatCount(liveCount) }} идут</template
        >
      </Stat>
      <Stat label="Активны сегодня" dot="accent">
        {{ formatCount(overview.today.activeAccounts) }}
        <template #note
          ><OverviewDelta
            :current="overview.today.activeAccounts"
            :previous="yesterday?.activeAccounts ?? 0"
            unit="к вчера"
        /></template>
      </Stat>
      <Stat label="Новых сегодня" dot="info">
        {{ formatCount(overview.today.newAccounts) }}
        <template #note
          ><OverviewDelta
            :current="overview.today.newAccounts"
            :previous="yesterday?.newAccounts ?? 0"
            unit="к вчера"
          />
          · {{ formatCount(newThisWeek) }} за неделю</template
        >
      </Stat>
    </Stats>

    <div class="admin-overview__pair">
      <Section v-if="canRooms" id="live" page="overview" title="Сейчас в звонках">
        <template #summary>
          <Pill v-if="rooms?.length" tone="success" dot>
            {{ formatCount(rooms.length) }} {{ plural(rooms.length, ['комната', 'комнаты', 'комнат']) }} ·
            {{ formatPeople(peopleInVoice) }}
          </Pill>
        </template>
        <template #link
          ><Button size="sm" variant="plain" @click="emit('openTab', 'rooms')">Все комнаты</Button></template
        >
        <Notice v-if="!liveRows && live.failure.value" :failure="live.failure.value" @retry="live.reload" />
        <Card v-else-if="!liveRows"><p class="admin-metric-note" aria-busy="true">Загружаем…</p></Card>
        <Card v-else-if="!liveRows.length"><EmptyState title="Сейчас никто не в звонке" compact /></Card>
        <ul v-else class="admin-overview-list" aria-label="Сейчас в звонках">
          <li v-for="{ room, trouble, avatars } in liveRows" :key="room.roomId">
            <Pressable inset class="admin-overview-list__row" @click="emit('openLiveRoom', room.roomId)">
              <span class="admin-overview-list__room">
                <RoomAvatar :room-id="room.roomId" :name="room.name" :src="room.avatarUrl" />
                <span class="admin-overview-list__room-text">
                  <span class="admin-overview-list__room-name">{{ roomName(room) }}</span>
                  <span class="admin-metric-note">
                    {{ room.isStatic ? 'постоянная' : 'временная'
                    }}{{ room.since ? ` · идёт ${formatSince(room.since, now)}` : '' }}
                  </span>
                </span>
              </span>
              <span class="admin-overview-list__people">
                <AvatarStack :items="avatars" :max-avatars="4" :size="24" aria-hidden="true" />
                <span>{{ formatPeople(room.peers.length) }}</span>
              </span>
              <Pill v-if="trouble" :tone="trouble.tone" dot compact>{{ trouble.count }} со связью</Pill>
              <span v-else class="admin-metric-note">связь в порядке</span>
            </Pressable>
          </li>
        </ul>
      </Section>
      <Section id="hours" page="overview" title="Часы в войсе">
        <template #link
          ><SegmentControl
            size="sm"
            v-bind="{ ariaLabel: 'Период' }"
            :value="period"
            :options="HOURS_PERIODS"
            @change="period = $event"
        /></template>
        <template v-if="hoursChart">
          <TimeChart
            :title="hoursChart.title"
            kind="bar"
            :height="170"
            :labels="hoursChart.labels"
            :series="hoursChart.series"
          />
          <p class="admin-metric-note">
            Сегодня {{ formatHours(hoursChart.today) }} · вчера {{ formatHours(hoursChart.yesterday) }}. Заход относится
            к дню, в который начался.
            <Button size="sm" variant="plain" @click="emit('openTab', 'product')">Подробнее в «Продукте»</Button>
          </p>
        </template>
        <Notice v-else-if="hours.failure.value" :failure="hours.failure.value" @retry="hours.reload" />
        <Card v-else><p class="admin-metric-note" aria-busy="true">Загружаем…</p></Card>
      </Section>
    </div>

    <div class="admin-overview__pair">
      <Section v-if="canRooms" id="calls" page="overview" title="Последние звонки">
        <template #summary>
          <span class="admin-metric-note">{{
            callsTodayCount
              ? `сегодня ${formatCount(callsTodayCount)}${callsTodayMs ? ` · ${formatDuration(callsTodayMs)}` : ''}`
              : 'сегодня не было'
          }}</span>
        </template>
        <template #link
          ><Button size="sm" variant="plain" @click="emit('openTab', 'rooms')">Вся история</Button></template
        >
        <Notice v-if="!calls && recent.failure.value" :failure="recent.failure.value" @retry="recent.reload" />
        <Card v-else-if="!calls"><p class="admin-metric-note" aria-busy="true">Загружаем…</p></Card>
        <Card v-else-if="!calls.length"><EmptyState title="Завершённых звонков пока нет" compact /></Card>
        <ul v-else class="admin-overview-list" aria-label="Последние звонки">
          <li v-for="call in calls" :key="call.id">
            <Pressable
              inset
              class="admin-overview-list__row admin-overview-list__row--finished"
              @click="emit('openCall', { kind: 'finished', callId: call.id })"
            >
              <span class="admin-overview-list__when">
                <span class="admin-metric-mono">{{ formatClock(call.startedAt) }}–{{ formatClock(call.endedAt) }}</span>
                <span class="admin-metric-note"
                  >{{ formatShortDay(call.startedAt, now) }} · {{ formatDuration(call.endedAt - call.startedAt) }}</span
                >
              </span>
              <span class="admin-overview-list__room">
                <RoomAvatar :room-id="call.roomId" :name="call.roomName" :src="call.avatarUrl ?? null" :size="28" />
                <span class="admin-overview-list__room-name">{{ call.roomName || call.roomId }}</span>
              </span>
              <span class="admin-overview-list__people">{{ formatPeople(peopleOf(call).length) }}</span>
              <QualityCell :quality="qualityOfCall(call)" />
              <span v-if="call.badFeedback" class="admin-overview-list__bad" title="Плохие отзывы об этом звонке">
                <ThumbsDown aria-label="Плохих отзывов" />{{ formatCount(call.badFeedback) }}
              </span>
            </Pressable>
          </li>
        </ul>
      </Section>
      <div class="admin-overview__stack">
        <Section id="server" page="overview" title="Сервер">
          <template #summary
            ><Pill :tone="overview.livekit ? 'success' : 'danger'" dot
              >LiveKit {{ overview.livekit ? 'работает' : 'выключен' }}</Pill
            ></template
          >
          <template #link
            ><Button size="sm" variant="plain" @click="emit('openTab', 'system')">Подробнее</Button></template
          >
          <OverviewServer :overview="overview" :system="system" :now="now" />
        </Section>
        <Section v-if="overview.feedback" id="feedback" page="overview" title="Отзывы за 7 дней">
          <template #link
            ><Button size="sm" variant="plain" @click="emit('openTab', 'feedback')">Все отзывы</Button></template
          >
          <OverviewFeedback :feedback="overview.feedback" />
        </Section>
      </div>
    </div>

    <Section id="growth" page="overview" title="Рост и активность" :default-open="false">
      <template #summary><span class="admin-metric-note">активные, новые и онлайн за сутки</span></template>
      <div class="admin-metric-grid">
        <TimeChart
          title="Активность за 14 дней"
          :height="220"
          :labels="dayLabels"
          :series="[
            { name: 'Активные аккаунты', values: days.map((day) => day.activeAccounts), color: 'var(--vr-accent)' },
            { name: 'В войсе', values: days.map((day) => day.voiceAccounts), color: 'var(--vr-success)' },
            { name: 'Новые', values: days.map((day) => day.newAccounts), color: 'var(--vr-info)' }
          ]"
        />
        <TimeChart
          title="Онлайн за сутки"
          :height="220"
          :labels="sampleLabels"
          :series="[
            {
              name: 'Вкладки и приложения',
              values: samples.map((sample) => sample.wsConnections),
              color: 'var(--vr-accent)'
            },
            { name: 'Гости', values: samples.map((sample) => sample.guestConnections), color: 'var(--vr-warning)' },
            { name: 'В войсе', values: samples.map((sample) => sample.voicePeers), color: 'var(--vr-success)' }
          ]"
        />
        <TimeChart
          title="Нагрузка за сутки"
          :height="220"
          :labels="sampleLabels"
          :format="wholePercent"
          :series="[
            { name: 'Процессор', values: samples.map((sample) => sample.cpuPct), color: 'var(--vr-accent)' },
            {
              name: 'Память',
              values: samples.map((sample) => percent(sample.memUsedBytes, sample.memTotalBytes)),
              color: 'var(--vr-warning)'
            }
          ]"
        />
      </div>
    </Section>
  </template>
</template>
