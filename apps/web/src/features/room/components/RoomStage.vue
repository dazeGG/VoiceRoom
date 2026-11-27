<script setup lang="ts">
import { RoomStage } from '@voiceroom/call/views';
import { computed, watchEffect } from 'vue';
import { state as roomClientState } from '@voiceroom/call/engine/core/room-runtime.store';
import { useCallPageStore } from '@voiceroom/call/engine/core/call-page.store';
import { useScreenSourceUiStore } from '@voiceroom/call/engine/core/screen-source-ui.store';
import { syncRemoteCameraDemand } from '@voiceroom/call/engine/services/livekit/remote-participants';
import { usePortraitCallLayout } from '../mobile-call-layout';
import { useMobileCallUiStore } from '../mobile-call-ui.store';
import { useDockAutoHide } from '../use-dock-auto-hide';
import { useParticipantsUiStore } from '@voiceroom/call/engine/core/participants-ui.store';
import RoomChat from './RoomChat.vue';
import RoomDock from './RoomDock.vue';
import ScreenStage from './ScreenStage.vue';
import StageTiles from './StageTiles.vue';

const page = useCallPageStore();
const participantsUi = useParticipantsUiStore();
const mobileCallUi = useMobileCallUiStore();
const mobileCallActive = computed(() => mobileCallUi.isMobileCallActive());
const portrait = usePortraitCallLayout();
const screenSource = useScreenSourceUiStore();
const canAutoHideDock = useDockAutoHide();
const dockAutoHides = computed(
  () =>
    page.screen === 'room' &&
    canAutoHideDock.value &&
    !portrait.value &&
    roomClientState.joined &&
    !screenSource.open &&
    !roomClientState.screenStarting
);

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
  <RoomStage :hidden="page.screen !== 'room'" :class="{ 'room-layout--dock-autohide': dockAutoHides }">
    <template #screen><ScreenStage /></template>
    <template v-if="!mobileCallActive" #tiles><StageTiles /></template>
    <template v-if="!mobileCallActive" #dock>
      <div class="stage__dock"><RoomDock /></div>
    </template>
    <template #panel><RoomChat /></template>
  </RoomStage>
</template>
