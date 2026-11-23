<script setup lang="ts">
import { computed } from 'vue';
import type { CallEvent, RoomStay } from '@voiceroom/shared/contracts/admin';
import { formatClock } from '../../format.ts';
import { EmptyState, Panel } from '../../ui';
import { personName } from './call-people.ts';

const EVENT_TONES: Partial<Record<CallEvent['kind'], string>> = {
  screen_on: 'accent',
  camera_on: 'accent',
  cpu_critical: 'danger',
  relieved_ns: 'info'
};

const NETWORK_EVENT_TEXT: Record<string, string> = {
  good: 'связь снова в порядке',
  unstable: 'голос нестабилен',
  bad: 'плохая связь'
};

const RELIEF_TARGET: Record<NonNullable<CallEvent['relief']>['kind'], string> = {
  noise: 'шумоподавления',
  video: 'камер',
  screen: 'показа экрана'
};

// Names come in any form and gender is not known, so each line is put without declining or agreeing with one.
function eventText(event: CallEvent, name: string): string {
  switch (event.kind) {
    case 'join':
      return `${name} — в звонке`;
    case 'leave':
      return `${name} — вне звонка`;
    case 'screen_on':
      return `${name} — показ экрана включён`;
    case 'screen_off':
      return `${name} — показ экрана выключен`;
    case 'camera_on':
      return `${name} — камера включена`;
    case 'camera_off':
      return `${name} — камера выключена`;
    case 'cpu_critical':
      return `${name} — система загружена: critical`;
    case 'relieved_ns':
      return `${name} — включён облегчённый шумодав`;
    case 'relief': {
      const { relief } = event;
      if (!relief) return `${name} — снижение нагрузки`;
      const result = relief.outcome === 'applied' ? 'снижена нагрузка' : 'не удалось снизить нагрузку';
      return `${name} — ${result} ${RELIEF_TARGET[relief.kind]}`;
    }
    case 'network':
      return `${name} — ${NETWORK_EVENT_TEXT[event.detail ?? ''] ?? 'связь изменилась'}`;
  }
}

function eventTone(event: CallEvent): string {
  if (event.kind === 'relief') return event.relief?.outcome === 'failed' ? 'warning' : 'info';
  if (event.kind === 'network')
    return event.detail === 'bad' ? 'danger' : event.detail === 'unstable' ? 'warning' : 'plain';
  return EVENT_TONES[event.kind] ?? 'plain';
}

const props = defineProps<{ events: readonly CallEvent[]; stays: readonly RoomStay[]; endedAt: number | null }>();
const names = computed(() => new Map(props.stays.map((stay) => [stay.id, personName(stay)])));
const nameOf = (id: string | null) => (id ? names.value.get(id) : undefined) ?? 'Кто-то';
</script>

<template>
  <Panel title="Что происходило" class="admin-call__wide" flush>
    <template #aside><span class="admin-call__note">входы, экран, связь, процессор</span></template>
    <EmptyState v-if="!events.length" compact title="Ничего не записано" />
    <ol v-else class="admin-call-events">
      <li v-for="(event, index) in events" :key="`${event.at}-${event.kind}-${event.stayId ?? ''}-${index}`">
        <span class="admin-call-events__at admin-rooms-mono">{{ formatClock(event.at) }}</span>
        <span class="admin-call-events__dot" :class="'admin-tone--' + eventTone(event)" aria-hidden="true" />
        <span>{{ eventText(event, nameOf(event.stayId)) }}</span>
      </li>
      <li v-if="endedAt !== null">
        <span class="admin-call-events__at admin-rooms-mono">{{ formatClock(endedAt) }}</span>
        <span class="admin-call-events__dot" aria-hidden="true" />
        <span>Звонок завершён</span>
      </li>
    </ol>
  </Panel>
</template>
