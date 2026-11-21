<script setup lang="ts">
import { computed } from 'vue';
import { ScreenStage } from '@voiceroom/call/views';
import { useScreenUiStore } from '@voiceroom/call/engine/core/screen-ui.store';
import {
  syncScreenVideoAudio,
  toggleScreenFullscreen,
  toggleScreenMute,
  setScreenVolume
} from '@voiceroom/call/engine/ui/screen-stage-controls';
import { handleScreenStageClick } from '@voiceroom/call/engine/ui/screen-view';

const screen = useScreenUiStore();
const meta = computed(() => screen.getScreenMetaView());
const volume = computed(() => screen.getStreamVolumeView());
const fullscreen = computed(() => screen.getFullscreenView());

function registerElements(stage: HTMLElement | null, video: HTMLVideoElement | null): void {
  screen.registerScreenStage(stage);
  screen.registerScreenVideo(video);
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
    @update-volume="setScreenVolume"
    @toggle-fullscreen="toggleScreenFullscreen()"
  />
</template>
