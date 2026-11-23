<script setup lang="ts">
import { RoomStage } from '@voiceroom/call/views';
import { computed, watchEffect } from 'vue';
import { state as roomClientState } from '@voiceroom/call/engine/core/room-runtime.store';
import { useCallPageStore } from '@voiceroom/call/engine/core/call-page.store';
import { syncRemoteCameraDemand } from '@voiceroom/call/engine/services/livekit/remote-participants';
import { useMobileCallUiStore } from '../mobile-call-ui.store';
import { useParticipantsUiStore } from '@voiceroom/call/engine/core/participants-ui.store';
import RoomChat from './RoomChat.vue';
import RoomDock from './RoomDock.vue';
import ScreenStage from './ScreenStage.vue';
import StageTiles from './StageTiles.vue';

const page = useCallPageStore();
const participantsUi = useParticipantsUiStore();
const mobileCallUi = useMobileCallUiStore();
const mobileCallActive = computed(() => mobileCallUi.isMobileCallActive());

// Each camera layer follows the size of its tile: re-pick them whenever the
// spotlight, the screen stage or the number of people changes.
const layoutKey = computed(() =>
  [
    participantsUi.focusedParticipantId,
    // A phone draws the call itself (MobileCallStage) until someone's screen is opened.
    mobileCallActive.value,
    mobileCallUi.getMobileSpotlightPeerId(),
    roomClientState.viewedScreenPeerId,
    roomClientState.peers.size
  ].join('|')
);

// Like the Svelte $effect, this also follows what syncRemoteCameraDemand reads itself:
// a peer's LiveKit participant or camera changing without the head count changing.
watchEffect(() => {
  if (layoutKey.value !== '') void syncRemoteCameraDemand();
});
</script>

<template>
  <RoomStage :hidden="page.screen !== 'room'">
    <template #screen><ScreenStage /></template>
    <template v-if="!mobileCallActive" #tiles><StageTiles /></template>
    <template v-if="!mobileCallActive" #dock><RoomDock /></template>
    <template #panel><RoomChat /></template>
  </RoomStage>
</template>
