<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { ScreenStage } from '@voice-room/call/views';
import { useScreenUiStore } from '@voice-room/call/engine/core/screen-ui.store';
import {
  syncScreenVideoAudio,
  toggleScreenFullscreen,
  toggleScreenMute,
  updateScreenVolumeFromSlider
} from '@voice-room/call/engine/ui/screen-stage-controls';
import { handleScreenStageClick } from '@voice-room/call/engine/ui/screen-view';
import EmojiText from '@/shared/chat/EmojiText.vue';
import { useScreenStartupDiagnostics } from '../use-screen-startup-diagnostics';

const screenUi = useScreenUiStore();
const videoEl = shallowRef<HTMLVideoElement | null>(null);
useScreenStartupDiagnostics(videoEl);

const meta = computed(() => screenUi.getScreenMetaView());
const volume = computed(() => screenUi.getStreamVolumeView());
const fullscreen = computed(() => screenUi.getFullscreenView());

function registerElements(
  stage: HTMLElement | null,
  video: HTMLVideoElement | null,
  slider: HTMLInputElement | null
): void {
  screenUi.registerScreenVideo(video);
  screenUi.registerScreenStage(stage);
  screenUi.registerStreamVolumeSlider(slider);
  videoEl.value = video;
}
</script>

<template>
  <ScreenStage
    :active-stream="screenUi.activeStream"
    :stage-visible="screenUi.stageVisible"
    :ui-active="screenUi.uiActive"
    :show-placeholder="screenUi.showPlaceholder"
    :show-controls="screenUi.showControls"
    :meta="meta"
    :volume="volume"
    :fullscreen="fullscreen"
    @elements-change="registerElements"
    @stream-attached="syncScreenVideoAudio"
    @interact="handleScreenStageClick"
    @active-change="screenUi.uiActive = $event"
    @toggle-mute="toggleScreenMute"
    @update-volume="updateScreenVolumeFromSlider()"
    @toggle-fullscreen="void toggleScreenFullscreen()"
  >
    <template #title="{ title }"><EmojiText :text="title" /></template>
  </ScreenStage>
</template>
