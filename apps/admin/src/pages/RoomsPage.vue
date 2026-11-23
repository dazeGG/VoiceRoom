<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { ArrowUpRight, ChevronLeft, ChevronRight, X } from '@lucide/vue';
import {
  VOICE_HISTORY_KEEP_DAYS,
  type LiveRoom,
  type RoomCall,
  type RoomCallsQuery
} from '@voiceroom/shared/contracts/admin';
import { fetchLiveRooms, fetchOverview, fetchRoomCalls, fetchStaticRooms } from '../api/admin.ts';
import { formatClock, formatCount, formatDuration, formatHours, formatPeople, plural } from '../format.ts';
import { useRefreshStatus } from '../frame.ts';
import Notice from '../Notice.vue';
import { useCan } from '../staff.store.ts';
import type { CallRef } from '../tabs.ts';
import { useAdminResource } from '../use-admin-resource.ts';
import { Button, Callout, EmptyState, Panel, Pill, Section, SegmentControl, Stat, Stats, useSectionState } from '../ui';
import CallList from './rooms/CallList.vue';
import CallFilters from './rooms/CallFilters.vue';
import type { CallOriginFilters, OriginPick } from './rooms/call-filters.ts';
import CallPeople from './rooms/CallPeople.vue';
import DayPicker from './rooms/DayPicker.vue';
import { shiftDay, startOfDay } from './rooms/days.ts';
import DayTimeline from './rooms/DayTimeline.vue';
import type { HistoryRoom } from './rooms/history-room.ts';
import LiveCalls from './rooms/LiveCalls.vue';
import StaticRooms from './rooms/StaticRooms.vue';
import { FIRST_STATIC_VIEW, type StaticRoomsView } from './rooms/static-rooms.ts';

const REFRESH_MS = 5000;
const SLOW_REFRESH_MS = 30_000;
/** A day's timeline follows the pages up to this many; a busier day shows its latest calls. */
const TIMELINE_PAGES = 10;

type HistoryView = 'calls' | 'timeline';

const startOfToday = () => startOfDay(Date.now());

const formatGuests = (count: number) => `${formatCount(count)} ${plural(count, ['гость', 'гостя', 'гостей'])}`;

/** Adds or removes one value of a set, as a new set. */
function toggled(set: ReadonlySet<string>, value: string): Set<string> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/** What the history asks for: a view, one room or all, and in the list a page. */
interface HistoryQuery {
  filters: CallOriginFilters;
  view: HistoryView;
  room: HistoryRoom | null;
  // The cursor each page opens with, the first one's empty; the API pages by
  // cursor, so a page already passed is only reached again through its own.
  cursors: (string | undefined)[];
  index: number;
  /** The midnight of the day the timeline shows. */
  dayStart: number;
}

/** What it answered, under the room it was asked for: the filter changes with its answer, so the chip never stands over another room's calls. */
type HistoryAnswer =
  | {
      view: 'calls';
      filters: CallOriginFilters;
      room: HistoryRoom | null;
      keepDays: number;
      calls: RoomCall[];
      cursors: (string | undefined)[];
      index: number;
    }
  | {
      view: 'timeline';
      filters: CallOriginFilters;
      room: HistoryRoom | null;
      keepDays: number;
      calls: RoomCall[];
      dayStart: number;
    };

const firstPage = (
  view: HistoryView,
  room: HistoryRoom | null,
  dayStart = startOfToday(),
  filters: CallOriginFilters = {}
): HistoryQuery => ({
  filters,
  view,
  room,
  cursors: [undefined],
  index: 0,
  dayStart
});

async function fetchHistory({ view, room, cursors, index, dayStart, filters }: HistoryQuery): Promise<HistoryAnswer> {
  if (view === 'calls') {
    const after = index > 0 ? cursors[index] : undefined;
    const query: RoomCallsQuery = { ...filters, ...(room ? { roomId: room.id } : {}), ...(after ? { after } : {}) };
    const page = await fetchRoomCalls(query);
    const next = [...cursors.slice(0, index + 1), ...(page.next ? [page.next] : [])];
    return { view, filters, room, keepDays: page.keepDays, calls: page.calls, cursors: next, index };
  }
  // Every call of the day, following the pages.
  const from = dayStart;
  const span = { ...filters, from: String(from), to: String(shiftDay(from, 1)), ...(room ? { roomId: room.id } : {}) };
  const calls: RoomCall[] = [];
  let after: string | null = null;
  let keepDays = 0;
  for (let page = 0; page < TIMELINE_PAGES; page += 1) {
    const answer = await fetchRoomCalls({ ...span, ...(after ? { after } : {}) });
    calls.push(...answer.calls);
    keepDays = answer.keepDays;
    after = answer.next;
    if (!after) break;
  }
  return { view, filters, room, keepDays, calls, dayStart: from };
}

const props = defineProps<{ focusRoom?: HistoryRoom | null; focusLive?: { roomId: string } | null }>();
const emit = defineEmits<{ openAccount: [accountId: string]; openCall: [call: CallRef]; liveFocused: [] }>();
const live = useAdminResource(fetchLiveRooms, [], {
  failureText: 'Не удалось загрузить комнаты',
  refreshMs: REFRESH_MS
});
const rooms = computed(() => live.data.value?.rooms ?? null);
const mountedAt = Date.now();
const now = computed(() => live.heardAt.value ?? mountedAt);
const openLive = shallowRef<ReadonlySet<string>>(new Set());
const openCalls = shallowRef<ReadonlySet<string>>(new Set());
const liveSection = useTemplateRef<{ section: HTMLElement | null }>('liveSection');
const historySection = useTemplateRef<{ section: HTMLElement | null }>('historySection');
const { open: liveExpanded, setOpen: setLiveExpanded } = useSectionState('rooms', 'live');
const { open: historyExpanded, setOpen: setHistoryExpanded } = useSectionState('rooms', 'history');
const { open: staticExpanded } = useSectionState('rooms', 'static');

const staticView = shallowRef<StaticRoomsView>(FIRST_STATIC_VIEW);
const staticRooms = useAdminResource(
  () =>
    fetchStaticRooms({
      filter: staticView.value.filter,
      sort: staticView.value.sort,
      page: String(staticView.value.page),
      ...(staticView.value.q ? { q: staticView.value.q } : {})
    }),
  [staticView],
  {
    failureText: 'Не удалось загрузить постоянные комнаты',
    refreshMs: () => (staticExpanded.value ? SLOW_REFRESH_MS : undefined)
  }
);
const staticCounts = computed(() => staticRooms.data.value?.counts ?? null);
const canStats = useCan('stats.view');
const canOrigin = useCan('origin.view');
const overview = useAdminResource(() => (canStats.value ? fetchOverview() : Promise.resolve(null)), [canStats], {
  failureText: 'Не удалось загрузить обзор',
  refreshMs: SLOW_REFRESH_MS
});
const today = computed(() => overview.data.value?.today);
const historyQuery = shallowRef(firstPage('calls', props.focusRoom ?? null));
const {
  data: shown,
  failure: historyFailure,
  busy: historyBusy,
  reload: reloadHistory
} = useAdminResource(() => fetchHistory(historyQuery.value), [historyQuery], {
  failureText: 'Не удалось загрузить историю'
});
const view = computed(() => historyQuery.value.view);
const historyRoom = computed(() => shown.value?.room ?? null);
const callsPage = computed(() => (shown.value?.view === 'calls' ? shown.value : null));
const day = computed(() => (shown.value?.view === 'timeline' ? shown.value : null));
const picked = ref<string | null>(null);

function showCallsPage(index: number): void {
  const answer = callsPage.value;
  if (answer) {
    historyQuery.value = {
      filters: answer.filters,
      view: 'calls',
      room: answer.room,
      cursors: answer.cursors,
      index,
      dayStart: historyQuery.value.dayStart
    };
  }
}

function scrollToHistory(): void {
  void nextTick(() => historySection.value?.section?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }));
}

function showRoomHistory(room: HistoryRoom | null, scroll = false): void {
  picked.value = null;
  historyQuery.value = firstPage(view.value, room, historyQuery.value.dayStart, historyQuery.value.filters);
  if (room) setHistoryExpanded(true);
  if (scroll) scrollToHistory();
}

function showFilters(filters: CallOriginFilters, scroll = false): void {
  picked.value = null;
  historyQuery.value = firstPage(view.value, historyQuery.value.room, historyQuery.value.dayStart, filters);
  if (filters.ipKey || filters.clientId) {
    setHistoryExpanded(true);
    if (scroll) scrollToHistory();
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

const historyViews: { value: HistoryView; label: string }[] = [
  { value: 'calls', label: 'Звонки' },
  { value: 'timeline', label: 'Лента дня' }
];

function changeView(next: HistoryView): void {
  picked.value = null;
  historyQuery.value = firstPage(next, historyRoom.value, historyQuery.value.dayStart, historyQuery.value.filters);
}

function showDay(dayStart: number): void {
  picked.value = null;
  historyQuery.value = firstPage('timeline', historyRoom.value, dayStart, historyQuery.value.filters);
}

function reload(): void {
  live.reload();
  reloadHistory();
  staticRooms.reload();
}
useRefreshStatus(() => ({ at: live.loadedAt.value, everyMs: REFRESH_MS, busy: live.busy.value, reload }));

function openLiveRoom(roomId: string): void {
  openLive.value = new Set(openLive.value).add(roomId);
}

function focusPickedLive(room: NonNullable<typeof props.focusLive>): void {
  openLiveRoom(room.roomId);
  setLiveExpanded(true);
  emit('liveFocused');
}

onMounted(() => {
  if (props.focusRoom) {
    setHistoryExpanded(true);
    scrollToHistory();
  }
  if (props.focusLive) focusPickedLive(props.focusLive);
});
watch(
  () => props.focusRoom,
  (room) => {
    if (room) showRoomHistory(room, true);
  }
);
watch(
  () => props.focusLive,
  (room) => {
    if (room) focusPickedLive(room);
  }
);

const peopleInVoice = computed(() => (rooms.value ?? []).reduce((count, room) => count + room.peers.length, 0));
const widgetRooms = computed(() => (rooms.value ?? []).filter((room) => room.kind === 'widget'));
const widgetGuests = computed(() => widgetRooms.value.reduce((count, room) => count + room.peers.length, 0));
const livePeers = computed(() => (rooms.value ?? []).flatMap((room) => room.peers));
const bad = computed(() => livePeers.value.filter((peer) => peer.network === 'bad').length);
const unstable = computed(() => livePeers.value.filter((peer) => peer.network === 'unstable').length);
const troubleTone = computed(() => (bad.value ? 'danger' : unstable.value ? 'warning' : undefined));
const roomsCount = computed(() => {
  const count = rooms.value?.length ?? 0;
  return `${formatCount(count)} ${plural(count, ['комната', 'комнаты', 'комнат'])}`;
});
const pageIndex = computed(() => callsPage.value?.index ?? 0);
const hasNextPage = computed(() =>
  callsPage.value ? callsPage.value.cursors.length > callsPage.value.index + 1 : false
);
const pickedCall = computed(() => day.value?.calls.find((call) => call.id === picked.value) ?? null);
const localToday = computed(() => startOfDay(now.value));
const dayIsToday = computed(() => !day.value || day.value.dayStart === localToday.value);
const timelineLive = computed(() => {
  const filters = day.value?.filters;
  return dayIsToday.value
    ? (rooms.value ?? []).filter(
        (room) =>
          (!historyRoom.value || room.roomId === historyRoom.value.id) &&
          room.peers.some(
            (peer) =>
              (!filters?.clientId || (peer.clientId ?? peer.guestId) === filters.clientId) &&
              (!filters?.ipKey || peer.ipKey === filters.ipKey)
          )
      )
    : [];
});
const historyUnavailable = computed(() => (view.value === 'calls' ? !callsPage.value : !day.value));

function openTimelineRoom(room: LiveRoom): void {
  openLiveRoom(room.roomId);
  liveSection.value?.section?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
}
</script>

<template>
  <Stats label="Главное о комнатах">
    <Stat label="В звонках" :note="rooms ? roomsCount : undefined" dot="success">{{
      rooms ? formatPeople(peopleInVoice) : '…'
    }}</Stat>
    <Stat
      label="Связь хуже нормы"
      :tone="troubleTone"
      :dot="troubleTone"
      :note="rooms ? `${formatCount(bad)} плохо · ${formatCount(unstable)} нестабильно` : undefined"
    >
      {{ rooms ? formatPeople(bad + unstable) : '…' }}
    </Stat>
    <Stat
      label="Постоянных комнат"
      :note="staticCounts ? `${formatCount(staticCounts.active)} активных за неделю` : undefined"
    >
      {{ staticCounts ? formatCount(staticCounts.all) : '…' }}
    </Stat>
    <Stat
      v-if="today?.calls !== undefined"
      label="Звонков сегодня"
      :note="`${formatCount(today.calls)} завершены · ${formatCount(rooms?.length ?? 0)} идут`"
    >
      {{ formatCount(today.calls + (rooms?.length ?? 0)) }}
    </Stat>
    <Stat v-if="today" label="Часов в войсе сегодня" note="минуты всех участников">{{
      formatHours(today.voiceMinutes / 60)
    }}</Stat>
    <Stat
      v-if="today?.widgetCalls !== undefined"
      label="Из виджетов сегодня"
      dot="info"
      :note="`${formatCount(widgetRooms.length)} ${plural(widgetRooms.length, ['идёт', 'идут', 'идут'])} · ${formatGuests((today.widgetGuests ?? 0) + widgetGuests)}`"
    >
      {{ formatCount(today.widgetCalls + widgetRooms.length) }}
    </Stat>
  </Stats>

  <Section id="live" ref="liveSection" v-model:open="liveExpanded" page="rooms" title="Сейчас в звонках">
    <template #summary
      ><Pill v-if="rooms?.length" tone="success" dot
        >{{ roomsCount }} · {{ formatPeople(peopleInVoice) }}</Pill
      ></template
    >
    <template #link>обновляется каждые 5 с</template>
    <Notice v-if="live.failure.value && !rooms" :failure="live.failure.value" @retry="live.reload" />
    <template v-else>
      <Callout v-if="live.failure.value" :title="live.failure.value.message" tone="danger" role="alert" />
      <Panel flush>
        <p v-if="!rooms" class="admin-rooms-loading" aria-busy="true">Загружаем…</p>
        <EmptyState v-else-if="!rooms.length" title="Сейчас никто не в звонке" compact />
        <LiveCalls
          v-else
          :rooms="rooms"
          :now="now"
          :open="openLive"
          :pick="livePick"
          show-history
          @toggle="(roomId) => (openLive = toggled(openLive, roomId))"
          @show-history="(room) => showRoomHistory({ id: room.roomId, name: room.name }, true)"
          @open-call="(room) => emit('openCall', { kind: 'live', roomId: room.roomId })"
          @open-account="emit('openAccount', $event)"
        />
      </Panel>
    </template>
  </Section>

  <Section id="static" v-model:open="staticExpanded" page="rooms" title="Постоянные комнаты">
    <template #summary
      ><Pill v-if="staticCounts">{{ formatCount(staticCounts.all) }}</Pill></template
    >
    <template #link>цифры за 30 дней</template>
    <StaticRooms
      :page="staticRooms.data.value"
      :failure="staticRooms.failure.value"
      :busy="staticRooms.busy.value"
      :view="staticView"
      :now="staticRooms.heardAt.value ?? now"
      @change="staticView = $event"
      @retry="staticRooms.reload"
      @show-history="(room) => showRoomHistory({ id: room.id, name: room.name }, true)"
    />
  </Section>

  <Section id="history" ref="historySection" v-model:open="historyExpanded" page="rooms" title="История звонков">
    <template #summary>
      <CallFilters v-if="canOrigin && shown" :filters="shown.filters" @change="showFilters" />
      <Button
        v-if="historyRoom"
        size="sm"
        variant="soft"
        :aria-label="`${historyRoom.name || historyRoom.id} Показать все комнаты`"
        @click="showRoomHistory(null)"
        >{{ historyRoom.name || historyRoom.id }} <X aria-hidden="true"
      /></Button>
    </template>
    <template #link>
      <div class="admin-history__views">
        <DayPicker
          v-if="view === 'timeline'"
          :day-start="historyQuery.dayStart"
          :today="localToday"
          :keep-days="shown?.keepDays || VOICE_HISTORY_KEEP_DAYS"
          @change="showDay"
        />
        <!-- @vue-generic {HistoryView} -->
        <SegmentControl
          :value="view"
          :options="historyViews"
          v-bind="{ ariaLabel: 'Вид истории' }"
          size="sm"
          @change="changeView"
        />
      </div>
    </template>

    <Notice
      v-if="historyFailure && historyUnavailable"
      :failure="historyFailure"
      @retry="showRoomHistory(historyRoom)"
    />
    <Panel v-else-if="!shown || (historyUnavailable && historyBusy)">
      <p class="admin-rooms-loading" aria-busy="true">Загружаем…</p>
    </Panel>
    <template v-else>
      <Callout v-if="historyFailure" :title="historyFailure.message" tone="danger" role="alert" />
      <template v-if="view === 'calls'">
        <Panel v-if="!callsPage?.calls.length"><EmptyState title="Завершённых звонков пока нет" compact /></Panel>
        <template v-else>
          <CallList
            :calls="callsPage.calls"
            :now="now"
            :open="openCalls"
            :pick="historyPick"
            filter-room
            @toggle="(callId) => (openCalls = toggled(openCalls, callId))"
            @filter-room="(call) => showRoomHistory({ id: call.roomId, name: call.roomName || null })"
            @open-call="(call) => emit('openCall', { kind: 'finished', callId: call.id })"
            @open-account="emit('openAccount', $event)"
          />
          <nav v-if="pageIndex > 0 || hasNextPage" class="admin-history__pager" aria-label="Страницы истории">
            <Button
              variant="outline"
              size="sm"
              :disabled="historyBusy || pageIndex === 0"
              @click="showCallsPage(pageIndex - 1)"
            >
              <template #icon><ChevronLeft aria-hidden="true" /></template>Назад
            </Button>
            <span class="admin-rooms-quiet" aria-current="page">Страница {{ pageIndex + 1 }}</span>
            <Button
              variant="outline"
              size="sm"
              :disabled="historyBusy || !hasNextPage"
              @click="showCallsPage(pageIndex + 1)"
            >
              Дальше <ChevronRight aria-hidden="true" />
            </Button>
          </nav>
        </template>
      </template>
      <template v-else>
        <Panel flush>
          <EmptyState
            v-if="!day || (!day.calls.length && !timelineLive.length)"
            compact
            :title="dayIsToday ? 'Сегодня звонков не было' : 'В этот день звонков не было'"
          />
          <DayTimeline
            v-else
            :day-start="day.dayStart"
            :now="now"
            :calls="day.calls"
            :live="timelineLive"
            :selected-id="picked"
            @select="(call) => (picked = picked === call.id ? null : call.id)"
            @open-live="openTimelineRoom"
          />
        </Panel>
        <Panel
          v-if="pickedCall"
          flush
          :title="`${pickedCall.roomName || pickedCall.roomId} · ${formatClock(pickedCall.startedAt)}–${formatClock(pickedCall.endedAt)}`"
        >
          <template #aside>
            <span class="admin-history__picked">
              {{ formatDuration(pickedCall.endedAt - pickedCall.startedAt) }}
              <Button
                size="sm"
                variant="plain"
                @click="pickedCall && emit('openCall', { kind: 'finished', callId: pickedCall.id })"
              >
                Подробно о звонке <ArrowUpRight aria-hidden="true" />
              </Button>
            </span>
          </template>
          <div class="admin-rooms-scroll">
            <CallPeople :call="pickedCall" :pick="historyPick" @open-account="emit('openAccount', $event)" />
          </div>
        </Panel>
      </template>
    </template>
    <p v-if="shown?.keepDays" class="admin-history__foot">
      Комната, имена гостей и откуда заходили хранятся {{ shown.keepDays }} дней, потом у звонка остаётся только время
      для статистики.
    </p>
  </Section>
</template>
