<script setup lang="ts">
import { computed, useId } from 'vue';
import { ArrowUpRight, ChevronDown, ChevronRight, History } from '@lucide/vue';
import type { LiveRoom } from '@voiceroom/shared/contracts/admin';
import { formatPeople, formatSince } from '../../format.ts';
import { getAvatarPresentation } from '@voiceroom/ui/avatar-presentation';
import { AvatarStack, IconButton } from '../../ui';
import type { OriginPick } from './call-filters.ts';
import AccountName from './AccountName.vue';
import LivePeer from './LivePeer.vue';
import LiveSummary from './LiveSummary.vue';
import RoomTitle from './RoomTitle.vue';
import { sharedIpKeys } from './room-bits.ts';

const props = withDefaults(
  defineProps<{
    rooms: readonly LiveRoom[];
    now: number;
    open: ReadonlySet<string>;
    showHistory?: boolean;
    pick?: OriginPick | undefined;
    showOwner?: boolean | undefined;
    label?: string | undefined;
  }>(),
  { showOwner: true, label: 'Сейчас в звонках', pick: undefined }
);
const emit = defineEmits<{
  toggle: [roomId: string];
  showHistory: [room: LiveRoom];
  openCall: [room: LiveRoom];
  openAccount: [accountId: string];
}>();
const uid = useId();
const rows = computed(() =>
  props.rooms.map((room) => ({
    room,
    shared: sharedIpKeys(room.peers.map((peer) => ({ key: peer.peerId, ipKey: peer.ipKey }))),
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
</script>

<template>
  <div class="admin-rooms-scroll">
    <div class="admin-live" :class="{ 'admin-live--unowned': !showOwner }">
      <div class="admin-live__head" aria-hidden="true">
        <span /><span>Комната</span><span>Участники</span><span>Идёт</span> <span v-if="showOwner">Владелец</span
        ><span>Сейчас</span><span />
      </div>
      <ul class="admin-live__rooms" :aria-label="label">
        <li v-for="{ room, shared, avatars } in rows" :key="room.roomId" class="admin-live__room">
          <div class="admin-live__row" @click="emit('toggle', room.roomId)">
            <IconButton
              :label="`Участники: ${room.name}`"
              :size="28"
              :aria-expanded="open.has(room.roomId)"
              :aria-controls="uid + '-' + room.roomId"
              @click.stop="emit('toggle', room.roomId)"
            >
              <ChevronDown v-if="open.has(room.roomId)" aria-hidden="true" /><ChevronRight v-else aria-hidden="true" />
            </IconButton>
            <RoomTitle
              :room-id="room.roomId"
              :name="room.name"
              :is-static="room.isStatic"
              :avatar-url="room.avatarUrl"
              :kind="room.kind"
            />
            <span class="admin-rooms-avatars"
              ><AvatarStack :items="avatars" :max-avatars="4" :size="20" />{{ formatPeople(room.peers.length) }}</span
            >
            <span class="admin-live__since admin-rooms-mono">{{
              room.since ? (now - room.since < 60_000 ? 'только что' : formatSince(room.since, now)) : '—'
            }}</span>
            <span v-if="showOwner">
              <AccountName v-if="room.owner" :account="room.owner" login-only @open="emit('openAccount', $event)" />
              <span v-else class="admin-rooms-quiet">без владельца</span>
            </span>
            <LiveSummary :peers="room.peers" />
            <span class="admin-live__actions">
              <IconButton
                v-if="showHistory"
                :label="`История звонков: ${room.name}`"
                :size="28"
                title="Показать историю звонков этой комнаты"
                @click.stop="emit('showHistory', room)"
                ><History aria-hidden="true"
              /></IconButton>
              <IconButton
                :label="`Подробно о звонке: ${room.name}`"
                :size="28"
                title="Подробно о звонке"
                @click.stop="emit('openCall', room)"
                ><ArrowUpRight aria-hidden="true"
              /></IconButton>
            </span>
          </div>
          <div v-if="open.has(room.roomId)" :id="uid + '-' + room.roomId" class="admin-live__peers">
            <div class="admin-live__peers-head" aria-hidden="true">
              <span>Кто</span><span>Голос</span><span>Откуда</span><span class="admin-rooms-end">В звонке</span>
            </div>
            <ul class="admin-live__peer-list" :aria-label="`В звонке: ${room.name}`">
              <LivePeer
                v-for="peer in room.peers"
                :key="peer.peerId"
                :peer="peer"
                :now="now"
                :pick="pick"
                :shared="Boolean(peer.ipKey && shared.has(peer.ipKey))"
                @open-account="emit('openAccount', $event)"
              />
            </ul>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>
