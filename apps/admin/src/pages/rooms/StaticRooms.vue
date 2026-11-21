<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { History, Search } from '@lucide/vue';
import type {
  StaticRoomRow,
  StaticRooms as StaticRoomsPage,
  StaticRoomsFilter,
  StaticRoomsSort
} from '@voice-room/shared/contracts/admin';
import { formatAgo, formatCount, formatMinutes, formatNumericDate } from '../../format.ts';
import type { LoadFailure } from '../../load-failure.ts';
import Notice from '../../Notice.vue';
import {
  Button,
  Callout,
  EmptyState,
  IconButton,
  Panel,
  Pill,
  RoomAvatar,
  SegmentControl,
  Select,
  TextField
} from '../../ui';
import QualityCell from './QualityCell.vue';
import type { StaticRoomsView } from './static-rooms.ts';

const SEARCH_DELAY_MS = 250;

const FILTERS: readonly { value: StaticRoomsFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'active', label: 'Активные за неделю' },
  { value: 'trouble', label: 'Со связью хуже нормы' },
  { value: 'quiet', label: 'Пустуют 30+ дней' }
];

const SORTS: readonly { value: StaticRoomsSort; label: string }[] = [
  { value: 'lastCall', label: 'По последнему звонку' },
  { value: 'voice', label: 'По часам в войсе' },
  { value: 'members', label: 'По участникам' },
  { value: 'quality', label: 'По качеству связи' },
  { value: 'created', label: 'По дате создания' }
];

/** Nobody in it and no call for 30 days: the same line the filter draws. */
function isQuiet(room: StaticRoomRow, now: number): boolean {
  return !room.live && (room.lastCallAt === null || now - room.lastCallAt >= 30 * 24 * 60 * 60_000);
}

const props = defineProps<{
  page: StaticRoomsPage | null;
  failure: LoadFailure | null;
  busy: boolean;
  view: StaticRoomsView;
  now: number;
}>();
const emit = defineEmits<{ change: [view: StaticRoomsView]; retry: []; showHistory: [room: StaticRoomRow] }>();
const typed = ref(props.view.q);
let searchTimer: number | undefined;
onBeforeUnmount(() => window.clearTimeout(searchTimer));

function typeQuery(value: string): void {
  typed.value = value;
  window.clearTimeout(searchTimer);
  const q = value.trim();
  if (q !== props.view.q) {
    searchTimer = window.setTimeout(() => emit('change', { ...props.view, q, page: 1 }), SEARCH_DELAY_MS);
  }
}

function chooseSort(value: string): void {
  const sort = SORTS.find((option) => option.value === value)?.value;
  if (sort) emit('change', { ...props.view, sort, page: 1 });
}

const filters = computed(() =>
  FILTERS.map((filter) => ({
    ...filter,
    ...(props.page ? { count: props.page.counts[filter.value] } : {})
  }))
);
const sortOptions = [...SORTS];
const lastPage = computed(() => (props.page ? Math.max(1, Math.ceil(props.page.total / props.page.pageSize)) : 1));
const shownFrom = computed(() =>
  props.page && props.page.total ? (props.page.page - 1) * props.page.pageSize + 1 : 0
);
const shownTo = computed(() => (props.page ? Math.min(props.page.total, props.page.page * props.page.pageSize) : 0));
</script>

<template>
  <div class="admin-static__toolbar">
    <TextField
      type="search"
      size="sm"
      placeholder="Название, код или владелец"
      aria-label="Поиск комнаты"
      :maxlength="100"
      :model-value="typed"
      @update:model-value="typeQuery"
    >
      <template #leading><Search aria-hidden="true" /></template>
    </TextField>
    <!-- @vue-generic {StaticRoomsFilter} -->
    <SegmentControl
      v-bind="{ ariaLabel: 'Показать комнаты' }"
      size="sm"
      :value="view.filter"
      :options="filters"
      @change="(filter) => emit('change', { ...view, filter, page: 1 })"
    />
    <div class="admin-static__sort">
      <span>Сортировка</span
      ><Select
        label="Сортировка"
        size="sm"
        flip
        :model-value="view.sort"
        :options="sortOptions"
        @value-change="chooseSort"
      />
    </div>
  </div>
  <Notice v-if="failure && !page" :failure="failure" @retry="emit('retry')" />
  <template v-else>
    <Callout v-if="failure" :title="failure.message" tone="danger" role="alert" />
    <Panel flush>
      <p v-if="!page" class="admin-rooms-loading" aria-busy="true">Загружаем…</p>
      <EmptyState v-else-if="!page.rooms.length" title="Таких комнат нет" compact />
      <div v-else class="admin-rooms-scroll">
        <div class="admin-static" role="table" aria-label="Постоянные комнаты">
          <div class="admin-static__row admin-static__row--head" role="row">
            <span role="columnheader">Комната</span><span role="columnheader">Владелец</span>
            <span role="columnheader" class="admin-rooms-end">Участников</span>
            <span role="columnheader" class="admin-rooms-end">Звонков</span>
            <span role="columnheader" class="admin-rooms-end">В войсе</span>
            <span role="columnheader">Последний звонок</span><span role="columnheader">Связь в звонках</span>
            <span role="columnheader">Создана</span><span role="columnheader" aria-label="История" />
          </div>
          <div v-for="room in page.rooms" :key="room.id" class="admin-static__row" role="row">
            <span role="cell" class="admin-static__room">
              <RoomAvatar :room-id="room.id" :name="room.name" :src="room.avatarUrl" />
              <span class="admin-static__room-text">
                <span class="admin-static__room-name">{{ room.name }}</span>
                <span class="admin-static__room-code admin-rooms-mono">{{ room.id }}</span>
              </span>
              <Pill v-if="room.live" tone="success" dot compact>в звонке</Pill>
              <Pill v-else-if="isQuiet(room, now)" compact>пустует</Pill>
            </span>
            <span role="cell" class="admin-static__owner admin-rooms-mono">{{
              room.owner ? '@' + room.owner.login : '—'
            }}</span>
            <span role="cell" class="admin-rooms-end admin-rooms-mono">{{ formatCount(room.members) }}</span>
            <span role="cell" class="admin-rooms-end admin-rooms-mono">{{ formatCount(room.calls30d) }}</span>
            <span role="cell" class="admin-rooms-end admin-rooms-mono">{{ formatMinutes(room.voiceMinutes30d) }}</span>
            <span role="cell" class="admin-static__last" :class="{ 'admin-static__last--live': room.live }">
              {{ room.live ? 'сейчас' : room.lastCallAt === null ? '—' : formatAgo(room.lastCallAt, now) }}
            </span>
            <span role="cell"><QualityCell :quality="room.quality30d" long none="нет звонков" /></span>
            <span role="cell" class="admin-rooms-mono">{{ formatNumericDate(room.createdAt) }}</span>
            <span role="cell">
              <IconButton
                :label="`История звонков: ${room.name}`"
                :size="28"
                title="История звонков комнаты"
                @click="emit('showHistory', room)"
                ><History aria-hidden="true"
              /></IconButton>
            </span>
          </div>
        </div>
      </div>
      <footer v-if="page && page.total > 0" class="admin-static__foot">
        <span
          >Показано {{ formatCount(shownFrom) }}–{{ formatCount(shownTo) }} из {{ formatCount(page.total)
          }}{{ busy ? ' · обновляем…' : '' }}</span
        >
        <nav v-if="lastPage > 1" class="admin-static__pages" aria-label="Страницы комнат">
          <Button size="sm" :disabled="view.page <= 1 || busy" @click="emit('change', { ...view, page: view.page - 1 })"
            >Назад</Button
          >
          <Button
            size="sm"
            :disabled="view.page >= lastPage || busy"
            @click="emit('change', { ...view, page: view.page + 1 })"
            >Дальше</Button
          >
        </nav>
      </footer>
    </Panel>
  </template>
</template>
