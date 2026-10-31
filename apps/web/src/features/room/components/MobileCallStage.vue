<script setup lang="ts">
// The call on a phone in portrait: it covers the room page with a full-screen
// layout (grid, focus, or two people face to face) whose controls hide
// themselves. Opening someone's screen hands the page back to the room stage.
import { MicOff } from '@lucide/vue';
import { computed, onMounted, onUnmounted, watch } from 'vue';
import { state as roomClientState } from '@/features/room/client/core/room-runtime.store';
import { isMicrophoneShownMuted } from '@/features/room/client/core/microphone-mute';
import { useMobileCallUiStore } from '@/features/room/mobile-call-ui.store';
import { useRoomUiStore } from '@/features/room/room-ui.store';
import { getDesktopBoundaryPolicy } from '@/platform/desktop-boundary';
import MobileCallDock from './MobileCallDock.vue';
import MobileCallFocus from './MobileCallFocus.vue';
import MobileCallGrid from './MobileCallGrid.vue';
import MobileCallPip from './MobileCallPip.vue';
import MobileCallTile from './MobileCallTile.vue';
import MobileCallTopbar from './MobileCallTopbar.vue';
import MobileCameraFlip from './MobileCameraFlip.vue';
import RoomCallTimer from './RoomCallTimer.vue';

const mobileCall = useMobileCallUiStore();
const roomUi = useRoomUiStore();

const active = computed(() => mobileCall.isMobileCallActive());
const scene = computed(() => mobileCall.getMobileCallScene());
// Full screen myself, my camera switch sits over my name, clear of the picture-in-picture.
const selfBigFlip = computed(
  () => scene.value.kind === 'duo' && scene.value.big.isLocal && Boolean(roomClientState.localCameraStream)
);

// The controls start hiding as soon as the call shows them, and again once a
// menu or the chat over the call closes.
watch(
  [active, () => mobileCall.chromeVisible, () => roomUi.chatOpen, () => mobileCall.outputOpen],
  ([isActive, chromeVisible], _before, onCleanup) => {
    if (!isActive || !chromeVisible) return;
    mobileCall.restartChromeTimer();
    onCleanup(mobileCall.stopChromeTimer);
  },
  { immediate: true }
);

onMounted(() => {
  mobileCall.setMobileCallEnabled(getDesktopBoundaryPolicy().platformClass === 'mobile');
});

onUnmounted(() => {
  mobileCall.resetMobileCall();
  mobileCall.setMobileCallEnabled(false);
});
</script>

<template>
  <!-- Any touch on the call restarts the countdown that hides the controls. -->
  <div
    v-if="active"
    :class="['mobile-call', `mobile-call--${scene.kind}`, { 'mobile-call--chrome-hidden': !mobileCall.chromeVisible }]"
    @pointerdown="mobileCall.restartChromeTimer"
  >
    <template v-if="scene.kind === 'duo'">
      <div class="mobile-call__bleed">
        <MobileCallTile
          :participant="scene.big"
          variant="bleed"
          @tap="mobileCall.tapStage({ pipExpanded: scene.pipExpanded })"
        />
      </div>
      <div v-if="selfBigFlip" class="mobile-call__bleed-controls" :inert="!mobileCall.chromeVisible">
        <MobileCameraFlip />
      </div>
    </template>

    <div class="mobile-call__content">
      <MobileCallPip v-if="scene.kind === 'duo'" :key="scene.pip.id" :scene="scene" :corner="mobileCall.pipCorner" />
      <MobileCallFocus v-else-if="scene.kind === 'focus'" :big="scene.big" :self="scene.self" :strip="scene.strip" />
      <MobileCallGrid v-else :pages="scene.pages" :voice-only="scene.voiceOnly" />
    </div>

    <!-- Hidden controls leave the tab order and the screen reader with the picture. -->
    <div class="mobile-call__chrome" :inert="!mobileCall.chromeVisible">
      <MobileCallTopbar :duo="scene.kind === 'duo'" />
      <MobileCallDock />
    </div>

    <button
      class="mobile-call__bubble"
      type="button"
      aria-label="Показать управление"
      :inert="mobileCall.chromeVisible"
      @click="mobileCall.showChrome"
    >
      <RoomCallTimer variant="bubble" />
      <MicOff v-if="roomClientState.joined && isMicrophoneShownMuted()" :size="14" aria-hidden="true" />
    </button>
  </div>
</template>
