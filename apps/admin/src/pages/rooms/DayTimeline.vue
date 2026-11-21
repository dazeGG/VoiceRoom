<script setup lang="ts">
import { Pressable } from '@voice-room/ui/components';
import { computed } from 'vue';
import type { LiveRoom, RoomCall } from '@voice-room/shared/contracts/admin';
import { formatClock, formatDuration, formatPeople } from '../../format.ts';
import RoomTitle from './RoomTitle.vue';
import { peopleOf } from './room-bits.ts';

const DAY = 24 * 60 * 60 * 1000;
const HOURS = [0, 3, 6, 9, 12, 15, 18, 21, 24];

interface Row {
  roomId: string;
  name: string | null;
  isStatic: boolean | null;
  avatarUrl: string | null;
  calls: RoomCall[];
  live: LiveRoom | null;
}

/** Rooms in the order they were last busy: live ones first, then by their latest call. */
function rowsOf(calls: readonly RoomCall[], live: readonly LiveRoom[]): Row[] {
  const rows = new Map<string, Row>();
  for (const room of live) {
    rows.set(room.roomId, {
      roomId: room.roomId,
      name: room.name,
      isStatic: room.isStatic,
      avatarUrl: room.avatarUrl,
      calls: [],
      live: room
    });
  }
  for (const call of calls) {
    const row = rows.get(call.roomId);
    if (row) row.calls.push(call);
    else
      rows.set(call.roomId, {
        roomId: call.roomId,
        name: call.roomName,
        isStatic: call.isStatic,
        avatarUrl: call.avatarUrl ?? null,
        calls: [call],
        live: null
      });
  }
  return [...rows.values()];
}

const props = defineProps<{
  dayStart: number;
  now: number;
  calls: readonly RoomCall[];
  live: readonly LiveRoom[];
  selectedId: string | null;
}>();
const emit = defineEmits<{ select: [call: RoomCall]; openLive: [room: LiveRoom] }>();
const at = (time: number) => Math.min(100, Math.max(0, ((time - props.dayStart) / DAY) * 100));
const place = (from: number, to: number) => ({
  left: `${at(from)}%`,
  width: `${Math.max(0.4, at(to) - at(from))}%`
});
const rows = computed(() =>
  rowsOf(props.calls, props.live).map((row) => ({
    ...row,
    calls: row.calls.map((call) => ({
      call,
      people: peopleOf(call).length,
      when: `${formatClock(call.startedAt)}–${formatClock(call.endedAt)}`,
      length: call.endedAt - call.startedAt
    }))
  }))
);
const nowShown = computed(() => props.now >= props.dayStart && props.now < props.dayStart + DAY);
const hourLeft = (hour: number) => `${(hour / 24) * 100}%`;
</script>

<template>
  <div class="admin-rooms-scroll">
    <div class="admin-timeline">
      <div class="admin-timeline__axis" aria-hidden="true">
        <span />
        <span class="admin-timeline__track">
          <span
            v-for="hour in HOURS"
            :key="hour"
            class="admin-timeline__hour admin-rooms-mono"
            :class="{ 'admin-timeline__hour--start': hour === 0, 'admin-timeline__hour--end': hour === 24 }"
            :style="{ left: hourLeft(hour) }"
            >{{ String(hour).padStart(2, '0') }}:00</span
          >
        </span>
      </div>
      <div class="admin-timeline__body">
        <ul class="admin-timeline__rows" aria-label="Звонки за день">
          <li v-for="row in rows" :key="row.roomId" class="admin-timeline__row">
            <RoomTitle
              :room-id="row.roomId"
              :name="row.name"
              :is-static="null"
              :avatar-url="row.avatarUrl"
              :size="28"
            />
            <span class="admin-timeline__track">
              <span
                v-for="hour in HOURS"
                :key="hour"
                class="admin-timeline__grid"
                :style="{ left: hourLeft(hour) }"
                aria-hidden="true"
              />
              <Pressable
                v-for="{ call, people, when, length } in row.calls"
                :key="call.id"
                class="admin-timeline__bar"
                :aria-pressed="call.id === selectedId"
                :title="`${when} · ${formatDuration(length)} · ${formatPeople(people)}`"
                :aria-label="`Звонок ${when}, ${formatPeople(people)}`"
                :style="place(call.startedAt, call.endedAt)"
                @click="emit('select', call)"
              >
                {{ length > 30 * 60_000 ? people : '' }}
              </Pressable>
              <Pressable
                v-if="row.live?.since"
                class="admin-timeline__bar admin-timeline__bar--live"
                :title="`${formatClock(row.live.since)} — сейчас · ${formatPeople(row.live.peers.length)}`"
                :aria-label="`Идёт с ${formatClock(row.live.since)}, ${formatPeople(row.live.peers.length)}`"
                :style="place(row.live.since, now)"
                @click="row.live && emit('openLive', row.live)"
              >
                {{ now - row.live.since > 30 * 60_000 ? row.live.peers.length : '' }}
              </Pressable>
            </span>
          </li>
        </ul>
        <span v-if="nowShown" class="admin-timeline__now" aria-hidden="true" :style="{ '--at': at(now) / 100 }" />
      </div>
    </div>
  </div>
</template>
