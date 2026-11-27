<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { ParticipantTile } from '@voiceroom/call/views';
import { state } from '@voiceroom/call/engine/core/room-runtime.store';
import { enterScreenView } from '@voiceroom/call/engine/ui/screen-view';
import { getAvatarPresentation } from '@voiceroom/ui/avatar-presentation';
import type { CallSnapshot } from '@voiceroom/shared/contracts/rings';
import EmojiText from '@/shared/chat/EmojiText.vue';
import { createLogger, errorContext } from '@/shared/log';
import FriendCallContextMenu from './FriendCallContextMenu.vue';

const { peer, self, peerStatus, hasEngine } = defineProps<{
  peer: CallSnapshot['caller'];
  self: CallSnapshot['caller'];
  peerStatus: 'present' | 'reconnecting' | 'absent';
  hasEngine: boolean;
}>();
const log = createLogger('friend-call:screen');
const menu = shallowRef<{ x: number; y: number; tile: HTMLElement | null } | null>(null);
const remote = computed(() =>
  hasEngine ? [...state.peers.values()].find((seat) => seat.accountUserId === peer.id) : undefined
);
const own = computed(() => (hasEngine ? state.self : null));
const remoteSeat = computed(() => remote.value ?? placeholder(peer, false));
const ownSeat = computed(() => own.value ?? placeholder(self, true));
const remoteState = computed(() => {
  if (peerStatus === 'absent') return 'absent';
  return peerStatus === 'reconnecting' || !remote.value ? 'reconnecting' : 'connected';
});

function placeholder(profile: CallSnapshot['caller'], isLocal: boolean) {
  return {
    id: profile.id,
    name: profile.displayName,
    isLocal,
    avatarColorKey: profile.avatarColorKey ?? '',
    avatarAccent: profile.avatarAccent ?? undefined,
    avatarUrl: profile.avatarUrl ?? undefined,
    muted: false,
    deafened: false,
    speaking: false,
    screen: false,
    cameraStream: null,
    statusLabel: ''
  };
}

function watchScreen(): void {
  const active = remote.value;
  if (active)
    void enterScreenView(active.id).catch((error: unknown) => log.error('screen view failed', errorContext(error)));
}

function openMenu(x: number, y: number, tile: HTMLElement | null): void {
  menu.value = { x, y, tile };
}
</script>

<template>
  <div v-show="!state.viewedScreenPeerId || !hasEngine" class="friend-call__tiles">
    <div class="friend-call__tile-grid">
      <ParticipantTile
        :participant="ownSeat"
        :avatar="getAvatarPresentation(ownSeat)"
        :state="own ? 'connected' : 'reconnecting'"
        static-tile
        :viewing="false"
        :mirrored="state.cameraFacing !== 'environment'"
        :screen-requesting="false"
      >
        <template #name><EmojiText :text="ownSeat.name" /></template>
      </ParticipantTile>
      <ParticipantTile
        :participant="remoteSeat"
        :avatar="getAvatarPresentation(remoteSeat)"
        :state="remoteState"
        static-tile
        context-menu
        :viewing="state.viewedScreenPeerId === remoteSeat.id"
        :mirrored="false"
        :screen-requesting="state.screenRequesting"
        @context-menu="openMenu"
        @watch-screen="watchScreen"
      >
        <template #name><EmojiText :text="remoteSeat.name" /></template>
      </ParticipantTile>
    </div>
    <FriendCallContextMenu
      v-if="menu"
      :key="peer.id"
      :peer="peer"
      :participant="remote"
      :position="menu"
      @close="menu = null"
    />
  </div>
</template>
