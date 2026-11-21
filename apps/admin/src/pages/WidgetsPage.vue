<script setup lang="ts">
import { ChevronLeft, ChevronRight } from '@lucide/vue';
import { computed, nextTick, shallowRef, useTemplateRef } from 'vue';
import type { RoomCall } from '@voice-room/shared/contracts/admin';
import { fetchLiveRooms, fetchRoomCalls, fetchWidgets } from '../api/admin.ts';
import { formatCount, formatHours, formatPeople, plural } from '../format.ts';
import { useRefreshStatus } from '../frame.ts';
import Notice from '../Notice.vue';
import { useCan } from '../staff.store.ts';
import type { CallRef } from '../tabs.ts';
import { Button, Callout, EmptyState, Panel, Pill, Section, Stat, Stats, useSectionState } from '../ui';
import { useAdminResource } from '../use-admin-resource.ts';
import CallFilters from './rooms/CallFilters.vue';
import CallList from './rooms/CallList.vue';
import LiveCalls from './rooms/LiveCalls.vue';
import type { CallOriginFilters, OriginPick } from './rooms/call-filters.ts';
import WidgetState from './widgets/WidgetState.vue';

const REFRESH_MS = 5000;
const SLOW_REFRESH_MS = 30_000;

/** A page of the history: the filters, and the cursor each page opens with (the first one's empty). */
interface HistoryQuery {
  filters: CallOriginFilters;
  cursors: (string | undefined)[];
  index: number;
}

interface HistoryAnswer extends HistoryQuery {
  keepDays: number;
  calls: RoomCall[];
}

async function fetchHistory({ filters, cursors, index }: HistoryQuery): Promise<HistoryAnswer> {
  const after = index > 0 ? cursors[index] : undefined;
  const page = await fetchRoomCalls({ ...filters, kind: 'widget', ...(after ? { after } : {}) });
  const next = [...cursors.slice(0, index + 1), ...(page.next ? [page.next] : [])];
  return { filters, cursors: next, index, keepDays: page.keepDays, calls: page.calls };
}

const firstPage = (filters: CallOriginFilters = {}): HistoryQuery => ({ filters, cursors: [undefined], index: 0 });

function toggled(set: ReadonlySet<string>, value: string): Set<string> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

const emit = defineEmits<{ openAccount: [accountId: string]; openCall: [call: CallRef] }>();
const canOrigin = useCan('origin.view');
const {
  data: widgets,
  failure: widgetsFailure,
  reload: reloadWidgets
} = useAdminResource(fetchWidgets, [], {
  failureText: 'Не удалось загрузить виджеты',
  refreshMs: SLOW_REFRESH_MS
});
const live = useAdminResource(fetchLiveRooms, [], {
  failureText: 'Не удалось загрузить комнаты',
  refreshMs: REFRESH_MS
});
const rooms = computed(() => live.data.value?.rooms.filter((room) => room.kind === 'widget') ?? null);
const mountedAt = Date.now();
const now = computed(() => live.heardAt.value ?? mountedAt);
const openLive = shallowRef<ReadonlySet<string>>(new Set());
const openCalls = shallowRef<ReadonlySet<string>>(new Set());
const historyQuery = shallowRef(firstPage());
const {
  data: shown,
  failure: historyFailure,
  reload: reloadHistory,
  busy: historyBusy
} = useAdminResource(() => fetchHistory(historyQuery.value), [historyQuery], {
  failureText: 'Не удалось загрузить историю'
});
const { open: historyExpanded, setOpen: setHistoryExpanded } = useSectionState('widgets', 'history');
const historySection = useTemplateRef<{ section: HTMLElement | null }>('historySection');

function showFilters(filters: CallOriginFilters, scroll = false): void {
  historyQuery.value = firstPage(filters);
  if (filters.ipKey || filters.clientId) {
    setHistoryExpanded(true);
    if (scroll)
      void nextTick(() => historySection.value?.section?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }));
  }
}
const historyPick = computed<OriginPick | undefined>(() =>
  canOrigin.value ? { filters: historyQuery.value.filters, onChange: showFilters } : undefined
);
const livePick = computed<OriginPick | undefined>(() =>
  canOrigin.value
    ? { filters: historyQuery.value.filters, onChange: (filters) => showFilters(filters, true) }
    : undefined
);

function reload(): void {
  live.reload();
  reloadHistory();
  reloadWidgets();
}
useRefreshStatus(() => ({ at: live.loadedAt.value, everyMs: REFRESH_MS, busy: live.busy.value, reload }));

const today = computed(() => widgets.value?.today ?? null);
const peers = computed(() => (rooms.value ?? []).flatMap((room) => room.peers));
const people = computed(() => peers.value.length);
const bad = computed(() => peers.value.filter((peer) => peer.network === 'bad').length);
const unstable = computed(() => peers.value.filter((peer) => peer.network === 'unstable').length);
const trouble = computed(() => (bad.value ? 'danger' : unstable.value ? 'warning' : undefined));
const liveCount = computed(() => rooms.value?.length ?? 0);
const roomsText = (count: number) => `${formatCount(count)} ${plural(count, ['комната', 'комнаты', 'комнат'])} виджета`;
const pageIndex = computed(() => shown.value?.index ?? 0);
const hasNextPage = computed(() => !!shown.value && shown.value.cursors.length > pageIndex.value + 1);

function showPage(index: number): void {
  if (shown.value) historyQuery.value = { filters: shown.value.filters, cursors: shown.value.cursors, index };
}
</script>

<template>
  <Stats label="Главное о виджетах">
    <Stat label="В звонках" :note="rooms ? roomsText(rooms.length) : undefined" dot="success">{{
      rooms ? formatPeople(people) : '…'
    }}</Stat>
    <Stat
      label="Связь хуже нормы"
      :tone="trouble"
      :dot="trouble"
      :note="rooms ? `${formatCount(bad)} плохо · ${formatCount(unstable)} нестабильно` : undefined"
    >
      {{ rooms ? formatPeople(bad + unstable) : '…' }}
    </Stat>
    <Stat
      label="Звонков сегодня"
      :note="
        today
          ? `${formatCount(today.calls)} завершены · ${formatCount(liveCount)} ${plural(liveCount, ['идёт', 'идут', 'идут'])}`
          : undefined
      "
    >
      {{ today ? formatCount(today.calls + liveCount) : '…' }}
    </Stat>
    <Stat
      label="Гостей сегодня"
      :note="
        today
          ? `с ${formatCount(today.distinctIpKeys)} ${plural(today.distinctIpKeys, ['разного', 'разных', 'разных'])} IP`
          : undefined
      "
    >
      {{ today ? formatCount(today.guests) : '…' }}
    </Stat>
    <Stat label="Часов в войсе сегодня" note="минуты всех участников">{{
      today ? formatHours(today.voiceMinutes / 60) : '…'
    }}</Stat>
  </Stats>

  <Section id="state" page="widgets" title="Состояние">
    <template #summary>
      <Pill v-if="widgets" :tone="widgets.state.admissionEnabled ? 'success' : 'neutral'" dot>
        {{ widgets.state.admissionEnabled ? 'приём включён' : 'приём выключен' }}
      </Pill>
    </template>
    <template #link>меняется только командой оператора</template>
    <Notice v-if="widgetsFailure && !widgets" :failure="widgetsFailure" @retry="reloadWidgets" />
    <WidgetState v-else-if="widgets" :widgets="widgets" />
    <Panel v-else><p class="admin-metric-note" aria-busy="true">Загружаем…</p></Panel>
  </Section>

  <Section id="live" page="widgets" title="Сейчас в звонках">
    <template #summary>
      <Pill v-if="liveCount" tone="success" dot>
        {{ formatPeople(people) }} в {{ formatCount(liveCount) }}
        {{ plural(liveCount, ['комнате', 'комнатах', 'комнатах']) }}
      </Pill>
    </template>
    <template #link>обновляется каждые 5 с</template>
    <Notice v-if="live.failure.value && !rooms" :failure="live.failure.value" @retry="live.reload" />
    <Panel v-else flush>
      <p v-if="!rooms" class="admin-metric-note admin-widget-state__loading" aria-busy="true">Загружаем…</p>
      <EmptyState v-else-if="rooms.length === 0" title="Сейчас никто не в звонке из виджета" compact />
      <LiveCalls
        v-else
        :rooms="rooms"
        :now="now"
        :open="openLive"
        :pick="livePick"
        :show-owner="false"
        label="Сейчас в звонках из виджетов"
        @toggle="openLive = toggled(openLive, $event)"
        @open-call="emit('openCall', { kind: 'live', roomId: $event.roomId })"
        @open-account="emit('openAccount', $event)"
      />
    </Panel>
  </Section>

  <Section id="history" ref="historySection" v-model:open="historyExpanded" page="widgets" title="История звонков">
    <template #summary>
      <CallFilters v-if="canOrigin && shown" :filters="shown.filters" @change="showFilters" />
    </template>
    <Notice v-if="historyFailure && !shown" :failure="historyFailure" @retry="reloadHistory" />
    <Panel v-else-if="!shown"><p class="admin-metric-note" aria-busy="true">Загружаем…</p></Panel>
    <template v-else>
      <Callout v-if="historyFailure" tone="danger" :title="historyFailure.message" role="alert" />
      <Panel v-if="shown.calls.length === 0">
        <EmptyState
          compact
          :title="
            shown.filters.ipKey || shown.filters.clientId
              ? 'С этим участником звонков из виджетов не было'
              : 'Звонков из виджетов пока не было'
          "
        />
      </Panel>
      <CallList
        v-else
        :calls="shown.calls"
        :now="now"
        :open="openCalls"
        :pick="historyPick"
        @toggle="openCalls = toggled(openCalls, $event)"
        @open-call="emit('openCall', { kind: 'finished', callId: $event.id })"
        @open-account="emit('openAccount', $event)"
      />
      <nav v-if="pageIndex > 0 || hasNextPage" class="admin-history__pager" aria-label="Страницы истории">
        <Button size="sm" :disabled="historyBusy || pageIndex === 0" @click="showPage(pageIndex - 1)">
          <template #icon><ChevronLeft aria-hidden="true" /></template>
          Назад
        </Button>
        <span class="admin-metric-note" aria-current="page">Страница {{ pageIndex + 1 }}</span>
        <Button size="sm" :disabled="historyBusy || !hasNextPage" @click="showPage(pageIndex + 1)">
          Дальше <ChevronRight aria-hidden="true" />
        </Button>
      </nav>
    </template>
    <p v-if="shown?.keepDays" class="admin-history__foot">
      Имена гостей и откуда заходили хранятся {{ shown.keepDays }} дней, потом у звонка остаётся только время для
      статистики.
    </p>
  </Section>
</template>
