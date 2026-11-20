<script setup lang="ts">
import { computed } from 'vue';
import { ScreenStage } from '@voice-room/call/views';
import { useScreenUiStore } from '@voice-room/call/engine/core/screen-ui.store';
import {
  syncScreenVideoAudio,
  toggleScreenFullscreen,
  toggleScreenMute,
  updateScreenVolumeFromSlider
} from '@voice-room/call/engine/ui/screen-stage-controls';
import { handleScreenStageClick } from '@voice-room/call/engine/ui/screen-view';

const screen = useScreenUiStore();
const meta = computed(() => screen.getScreenMetaView());
const volume = computed(() => screen.getStreamVolumeView());
const fullscreen = computed(() => screen.getFullscreenView());

function registerElements(
  stage: HTMLElement | null,
  video: HTMLVideoElement | null,
  slider: HTMLInputElement | null
): void {
  screen.registerScreenStage(stage);
  screen.registerScreenVideo(video);
  screen.registerStreamVolumeSlider(slider);
}
</script>

<template>
  <ScreenStage
    :active-stream="screen.activeStream"
    :stage-visible="screen.stageVisible"
    :ui-active="screen.uiActive"
    :show-placeholder="screen.showPlaceholder"
    :show-controls="screen.showControls"
    :meta="meta"
    :volume="volume"
    :fullscreen="fullscreen"
    @elements-change="registerElements"
    @stream-attached="syncScreenVideoAudio"
    @interact="handleScreenStageClick"
    @active-change="screen.uiActive = $event"
    @toggle-mute="toggleScreenMute"
    @update-volume="updateScreenVolumeFromSlider()"
    @toggle-fullscreen="toggleScreenFullscreen()"
  />
</template>
