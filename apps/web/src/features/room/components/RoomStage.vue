<script setup lang="ts">
import { computed, watchEffect } from 'vue';
import { state as roomClientState } from '../client/core/room-runtime.store';
import { usePageStore } from '@/stores/page.store';
import { syncRemoteCameraDemand } from '../client/services/livekit/remote-participants';
import { useMobileCallUiStore } from '../mobile-call-ui.store';
import { useParticipantsUiStore } from '../participants-ui.store';
import RoomChat from './RoomChat.vue';
import RoomDock from './RoomDock.vue';
import ScreenStage from './ScreenStage.vue';
import StageTiles from './StageTiles.vue';

const page = usePageStore();
const participantsUi = useParticipantsUiStore();
const mobileCallUi = useMobileCallUiStore();

// Each camera layer follows the size of its tile: re-pick them whenever the
// spotlight, the screen stage or the number of people changes.
const layoutKey = computed(() =>
  [
    participantsUi.focusedParticipantId,
    // A phone draws the call itself (MobileCallStage) until someone's screen is opened.
    mobileCallUi.isMobileCallActive(),
    mobileCallUi.getMobileSpotlightPeerId(),
    roomClientState.viewedScreenPeerId,
    roomClientState.peers.size
  ].join('|')
);

// Like the Svelte $effect, this also follows what syncRemoteCameraDemand reads itself:
// a peer's LiveKit participant or camera changing without the head count changing.
watchEffect(() => {
  if (layoutKey.value !== '') syncRemoteCameraDemand();
});
</script>

<template>
  <main id="roomScreen" class="room-layout" :hidden="page.screen !== 'room'">
    <section class="stage" aria-label="Голосовая комната">
      <ScreenStage />
      <template v-if="!mobileCallUi.isMobileCallActive()">
        <StageTiles />
        <RoomDock />
      </template>
    </section>
    <RoomChat />
  </main>
</template>
