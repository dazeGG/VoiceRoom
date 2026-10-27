<script setup lang="ts">
import { Maximize, Minimize, Volume2, VolumeX } from '@lucide/vue';
import { computed, ref, watch, watchEffect } from 'vue';
import EmojiText from '@/shared/chat/EmojiText.vue';
import { AvatarStack } from '@/shared/ui';
import {
  syncScreenVideoAudio,
  toggleScreenFullscreen,
  toggleScreenMute,
  updateScreenVolumeFromSlider
} from '../client/ui/screen-stage-controls';
import { handleScreenStageClick } from '../client/ui/screen-view';
import { useScreenUiStore } from '../screen-ui.store';

const screenUi = useScreenUiStore();

const stageEl = ref<HTMLElement | null>(null);
const videoEl = ref<HTMLVideoElement | null>(null);
const volumeSliderEl = ref<HTMLInputElement | null>(null);

const meta = computed(() => screenUi.getScreenMetaView());
const volume = computed(() => screenUi.getStreamVolumeView());
const fullscreen = computed(() => screenUi.getFullscreenView());

watchEffect(
  () => {
    screenUi.registerScreenVideo(videoEl.value);
    screenUi.registerScreenStage(stageEl.value);
    screenUi.registerStreamVolumeSlider(volumeSliderEl.value);
  },
  { flush: 'post' }
);

watch(
  [videoEl, () => screenUi.activeStream],
  ([video, stream]) => {
    if (!video) return;
    if (stream && video.srcObject !== stream) {
      video.srcObject = stream;
      syncScreenVideoAudio();
    } else if (!stream) {
      video.pause();
      video.srcObject = null;
    }
  },
  { flush: 'post' }
);
</script>

<template>
  <div
    id="screenStage"
    ref="stageEl"
    :class="['screen-stage', { 'screen-stage--active': screenUi.uiActive }]"
    :hidden="!screenUi.stageVisible"
    role="button"
    tabindex="-1"
    aria-label="Закрыть просмотр экрана"
    @click="handleScreenStageClick"
    @keydown="
      (event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') handleScreenStageClick(event);
      }
    "
    @pointerenter="screenUi.uiActive = true"
    @pointerleave="screenUi.uiActive = false"
    @pointermove="
      () => {
        if (screenUi.stageVisible) screenUi.uiActive = true;
      }
    "
  >
    <video id="screenVideo" ref="videoEl" class="screen-stage__video" autoplay playsinline></video>
    <div id="screenPlaceholder" class="screen-placeholder" :hidden="!screenUi.showPlaceholder">
      Подключение к экрану
    </div>

    <div v-if="meta" id="screenMeta" class="screen-meta">
      <span class="screen-meta__live" aria-hidden="true"></span>
      <span id="screenMetaTitle" class="screen-meta__title"><EmojiText :text="meta.title" /></span>
      <span v-if="meta.showSepProfile" id="screenMetaSepProfile" class="screen-meta__sep" aria-hidden="true">·</span>
      <span v-if="meta.showQuality" id="screenMetaQuality" class="screen-meta__detail">{{ meta.qualityLabel }}</span>
      <span v-if="meta.showSepFps" id="screenMetaSepFps" class="screen-meta__sep" aria-hidden="true">·</span>
      <span v-if="meta.showFps" id="screenMetaFps" class="screen-meta__detail">{{ meta.fpsLabel }}</span>
      <span v-if="meta.showSepViewers" id="screenMetaSepViewers" class="screen-meta__sep" aria-hidden="true">·</span>
      <span id="screenMetaViewers" class="screen-meta__detail screen-meta__viewers">
        <template v-if="meta.viewerAvatars.length === 0">Смотрят: 0</template>
        <AvatarStack
          v-else
          :items="meta.viewerAvatars"
          :max-avatars="null"
          :size="22"
          aria-label="Смотрят стрим"
          class="screen-meta__avatar-stack"
        />
      </span>
    </div>

    <div id="screenViewControls" class="screen-view-controls" :hidden="!screenUi.showControls">
      <div id="streamVolumeControl" class="stream-volume" :hidden="volume.hidden">
        <button
          id="streamVolumeButton"
          class="screen-view-controls__button stream-volume__button"
          type="button"
          :aria-label="volume.ariaLabel"
          :aria-pressed="volume.muted"
          @click="toggleScreenMute"
        >
          <span class="stream-volume__icon stream-volume__icon--on" aria-hidden="true"><Volume2 /></span>
          <span class="stream-volume__icon stream-volume__icon--off" aria-hidden="true"><VolumeX /></span>
        </button>
        <div id="streamVolumePopover" class="stream-volume__popover">
          <output
            class="stream-volume__value"
            :class="{ 'stream-volume__value--muted': volume.muted }"
            for="streamVolumeSlider"
          >
            {{ volume.valuePercent }}%
          </output>
          <div class="stream-volume__track">
            <input
              id="streamVolumeSlider"
              ref="volumeSliderEl"
              class="stream-volume__slider"
              type="range"
              min="0"
              :max="volume.maxPercent"
              :value="volume.valuePercent"
              aria-label="Громкость стрима"
              @input="updateScreenVolumeFromSlider()"
            />
          </div>
        </div>
      </div>

      <button
        id="screenFullscreenButton"
        class="screen-view-controls__button screen-view-controls__fullscreen"
        type="button"
        :aria-label="fullscreen.ariaLabel"
        :aria-pressed="fullscreen.fullscreen"
        @click="void toggleScreenFullscreen()"
      >
        <span
          class="screen-view-controls__fullscreen-icon screen-view-controls__fullscreen-icon--enter"
          aria-hidden="true"
          ><Maximize
        /></span>
        <span
          class="screen-view-controls__fullscreen-icon screen-view-controls__fullscreen-icon--exit"
          aria-hidden="true"
          ><Minimize
        /></span>
      </button>
    </div>
  </div>
</template>
