<script setup lang="ts">
import { computed, useId } from 'vue';
import { ArrowUpRight, ChevronDown, ChevronRight } from '@lucide/vue';
import type { RoomCall } from '@voice-room/shared/contracts/admin';
import { formatClock, formatCount, formatDayHeading, formatDuration, formatPeople, plural } from '../../format.ts';
import { getAvatarPresentation } from '@voice-room/ui/avatar-presentation';
import { AvatarStack, Button, IconButton } from '../../ui';
import type { OriginPick } from './call-filters.ts';
import CallPeople from './CallPeople.vue';
import QualityCell from './QualityCell.vue';
import { qualityOfCall } from './quality.ts';
import RoomTitle from './RoomTitle.vue';
import { matchedPeople, peopleOf } from './room-bits.ts';
import { startOfDay } from './days.ts';

const props = defineProps<{
  calls: readonly RoomCall[];
  now: number;
  open: ReadonlySet<string>;
  filterRoom?: boolean;
  pick?: OriginPick | undefined;
}>();
const emit = defineEmits<{
  toggle: [callId: string];
  filterRoom: [call: RoomCall];
  openCall: [call: RoomCall];
  openAccount: [accountId: string];
}>();
const uid = useId();

function rowOf(call: RoomCall) {
  const people = peopleOf(call);
  const matched = props.pick ? matchedPeople(call, props.pick.filters) : new Set<string>();
  return {
    call,
    when: `${formatClock(call.startedAt)}–${formatClock(call.endedAt)}`,
    length: call.endedAt - call.startedAt,
    matchedNames: people
      .filter((person) => matched.has(person.key))
      .map((person) => (person.account ? person.account.displayName : (person.guestName ?? 'Гость'))),
    avatars: people.map((person) => ({
      id: person.key,
      ...getAvatarPresentation({
        name: person.account ? person.account.displayName : (person.guestName ?? 'Гость'),
        avatarUrl: person.account?.avatarUrl ?? undefined,
        avatarColorKey: person.account?.avatarColorKey ?? '',
        avatarAccent: person.account?.avatarAccent ?? undefined,
        isLocal: false
      })
    }))
  };
}

const days = computed(() => {
  const result: { day: number; rows: ReturnType<typeof rowOf>[]; total: number }[] = [];
  for (const call of props.calls) {
    const day = startOfDay(call.startedAt);
    const row = rowOf(call);
    const last = result.at(-1);
    if (last?.day === day) {
      last.rows.push(row);
      last.total += row.length;
    } else {
      result.push({ day, rows: [row], total: row.length });
    }
  }
  return result;
});
</script>

<template>
  <div class="admin-call-list">
    <section
      v-for="{ day, rows, total } in days"
      :key="day"
      class="admin-call-list__day"
      :aria-label="formatDayHeading(day, now)"
    >
      <header class="admin-call-list__day-head">
        <span class="admin-call-list__day-name">{{ formatDayHeading(day, now) }}</span>
        <span class="admin-call-list__day-line" aria-hidden="true" />
        <span class="admin-call-list__day-sum">
          {{ formatCount(rows.length) }} {{ plural(rows.length, ['звонок', 'звонка', 'звонков']) }} ·
          {{ formatDuration(total) }}
        </span>
      </header>
      <div class="admin-rooms-scroll">
        <ul class="admin-call-list__rows">
          <li
            v-for="{ call, when, length, avatars, matchedNames } in rows"
            :key="call.id"
            class="admin-call-list__item"
          >
            <div class="admin-call-list__row" @click="emit('toggle', call.id)">
              <IconButton
                :label="`Кто был в звонке ${when}`"
                :size="28"
                :aria-expanded="open.has(call.id)"
                :aria-controls="uid + '-' + call.id"
                @click.stop="emit('toggle', call.id)"
              >
                <ChevronDown v-if="open.has(call.id)" aria-hidden="true" /><ChevronRight v-else aria-hidden="true" />
              </IconButton>
              <span class="admin-call-list__when">
                <span class="admin-rooms-mono">{{ when }}</span>
                <span class="admin-call-list__length">{{ formatDuration(length) }}</span>
              </span>
              <component
                :is="filterRoom ? Button : 'span'"
                v-bind="filterRoom ? { variant: 'plain', size: 'sm', title: 'Показать только эту комнату' } : {}"
                class="admin-call-list__room"
                @click="
                  (event: MouseEvent) => {
                    if (filterRoom) {
                      event.stopPropagation();
                      emit('filterRoom', call);
                    }
                  }
                "
              >
                <RoomTitle
                  :room-id="call.roomId"
                  :name="call.roomName"
                  :is-static="call.isStatic"
                  :avatar-url="call.avatarUrl ?? null"
                  :kind="call.kind"
                  :size="28"
                />
              </component>
              <span class="admin-call-list__people">
                <span class="admin-rooms-avatars"
                  ><AvatarStack :items="avatars" :max-avatars="4" :size="20" />{{ formatPeople(avatars.length) }}</span
                >
                <span v-if="matchedNames.length" class="admin-call-list__match">{{
                  'совпадение: ' + matchedNames.join(', ')
                }}</span>
              </span>
              <QualityCell :quality="qualityOfCall(call)" />
              <IconButton
                :label="`Подробно о звонке ${when}`"
                :size="28"
                title="Подробно о звонке"
                @click.stop="emit('openCall', call)"
                ><ArrowUpRight aria-hidden="true"
              /></IconButton>
            </div>
            <div v-if="open.has(call.id)" :id="uid + '-' + call.id" class="admin-call-list__detail">
              <CallPeople :call="call" :pick="pick" @open-account="emit('openAccount', $event)" />
            </div>
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>
