<script setup lang="ts">
import { computed } from 'vue';
import type { RoomCall } from '@voiceroom/shared/contracts/admin';
import { formatClock, formatDuration } from '../../format.ts';
import { Avatar, Button, Pill } from '../../ui';
import type { OriginPick } from './call-filters.ts';
import { matchedPeople, peopleOf, sharedIpKeys } from './room-bits.ts';
import AccountName from './AccountName.vue';
import Origin from './Origin.vue';
import NetworkLegend from './NetworkLegend.vue';
import NetworkSpan from './NetworkSpan.vue';

const props = defineProps<{
  call: RoomCall;
  selected?: string | null;
  selectable?: boolean;
  sharedKeys?: ReadonlySet<string>;
  wide?: boolean;
  pick?: OriginPick | undefined;
}>();
const emit = defineEmits<{ openAccount: [accountId: string]; select: [personKey: string] }>();
const people = computed(() =>
  peopleOf(props.call).map((person) => ({
    ...person,
    name: person.account ? person.account.displayName : (person.guestName ?? 'Гость')
  }))
);
const shared = computed(
  () => props.sharedKeys ?? sharedIpKeys(people.value.map(({ key, seat }) => ({ key, ipKey: seat.ipKey })))
);
const matched = computed(() => (props.pick ? matchedPeople(props.call, props.pick.filters) : new Set<string>()));
const share = (at: number) =>
  ((at - props.call.startedAt) / Math.max(1, props.call.endedAt - props.call.startedAt)) * 100;
</script>

<template>
  <div
    class="admin-call-people"
    :class="{ 'admin-call-people--wide': wide }"
    role="table"
    aria-label="Участники звонка"
  >
    <div class="admin-call-people__head" role="row">
      <span role="columnheader">Кто</span>
      <span v-if="$slots.axis" role="columnheader"><slot name="axis" /></span>
      <span v-else class="admin-call-people__span" role="columnheader">
        <span class="admin-rooms-mono">{{ formatClock(call.startedAt) }}</span>
        <NetworkLegend />
        <span class="admin-rooms-mono">{{ formatClock(call.endedAt) }}</span>
      </span>
      <span role="columnheader" class="admin-rooms-end">Сколько</span>
      <span role="columnheader">Откуда</span>
    </div>
    <div
      v-for="person in people"
      :key="person.key"
      class="admin-call-people__person"
      role="row"
      :class="{ 'admin-call-people__person--match': matched.has(person.key) }"
    >
      <span role="cell" class="admin-call-people__who">
        <Button
          v-if="selectable"
          size="sm"
          variant="plain"
          class="admin-call-people__pick"
          :aria-pressed="selected === person.key"
          @click="emit('select', person.key)"
        >
          <Avatar
            :name="person.name"
            :src="person.account?.avatarUrl ?? null"
            :color-key="person.account?.avatarColorKey ?? ''"
            :background="person.account?.avatarAccent ?? null"
            :size="24"
          />
          <span class="admin-room-account__name">{{ person.name || person.account?.login }}</span>
          <Pill v-if="!person.account" compact>гость</Pill>
        </Button>
        <template v-else>
          <Avatar
            :name="person.name"
            :src="person.account?.avatarUrl ?? null"
            :color-key="person.account?.avatarColorKey ?? ''"
            :background="person.account?.avatarAccent ?? null"
            :size="24"
          />
          <AccountName
            v-if="person.account"
            :account="person.account"
            :with-login="false"
            @open="emit('openAccount', $event)"
          />
          <template v-else>
            <span class="admin-room-account__name">{{ person.name }}</span>
            <Pill compact>гость</Pill>
          </template>
        </template>
      </span>
      <span
        role="cell"
        class="admin-call-bar"
        :aria-label="person.spans.map((span) => `${formatClock(span.from)}–${formatClock(span.to)}`).join(', ')"
      >
        <NetworkSpan
          v-for="span in person.spans"
          :key="span.from"
          :from="span.from"
          :to="span.to"
          :voice="span"
          :style="{ left: share(span.from) + '%', width: Math.max(1, share(span.to) - share(span.from)) + '%' }"
        />
      </span>
      <span role="cell" class="admin-call-people__total admin-rooms-end admin-rooms-mono">{{
        formatDuration(person.total)
      }}</span>
      <span
        role="cell"
        class="admin-call-people__origin"
        :class="{ 'admin-call-people__origin--shared': person.seat.ipKey && sharedKeys?.has(person.seat.ipKey) }"
      >
        <Origin
          :seat="person.seat"
          :pick="pick"
          :shared="Boolean(person.seat.ipKey && shared.has(person.seat.ipKey))"
        />
      </span>
    </div>
  </div>
</template>
