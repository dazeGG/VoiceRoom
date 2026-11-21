<script setup lang="ts">
import { t } from '@voice-room/ui/i18n';
import { AvatarStack, Slider, IconButton } from '@voice-room/ui/components';
import { Maximize, Minimize, Volume2, VolumeX } from '@lucide/vue';
import { ref, watch, watchEffect } from 'vue';
import type { FullscreenView, ScreenMetaView, StreamVolumeView } from '../engine/core/screen-ui.store';

const props = defineProps<{
  activeStream: MediaStream | null;
  stageVisible: boolean;
  uiActive: boolean;
  showPlaceholder: boolean;
  showControls: boolean;
  meta: ScreenMetaView | null;
  volume: StreamVolumeView;
  fullscreen: FullscreenView;
}>();

const emit = defineEmits<{
  elementsChange: [stage: HTMLElement | null, video: HTMLVideoElement | null];
  streamAttached: [];
  interact: [event: MouseEvent | KeyboardEvent];
  activeChange: [active: boolean];
  toggleMute: [];
  updateVolume: [percent: number];
  toggleFullscreen: [];
}>();

defineSlots<{
  title?(props: { title: string }): unknown;
}>();

const stageEl = ref<HTMLElement | null>(null);
const videoEl = ref<HTMLVideoElement | null>(null);

watchEffect(
  () => {
    emit('elementsChange', stageEl.value, videoEl.value);
  },
  { flush: 'post' }
);

watch(
  [videoEl, () => props.activeStream],
  ([video, stream]) => {
    if (!video) return;
    if (stream && video.srcObject !== stream) {
      video.srcObject = stream;
      emit('streamAttached');
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
    :class="['screen-stage', { 'screen-stage--active': uiActive }]"
    :hidden="!stageVisible"
    role="button"
    tabindex="-1"
    :aria-label="t('Закрыть просмотр экрана')"
    @click="emit('interact', $event)"
    @keydown="
      (event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') emit('interact', event);
      }
    "
    @pointerenter="emit('activeChange', true)"
    @pointerleave="emit('activeChange', false)"
    @pointermove="
      () => {
        if (stageVisible) emit('activeChange', true);
      }
    "
  >
    <video id="screenVideo" ref="videoEl" class="screen-stage__video" autoplay playsinline></video>
    <div id="screenPlaceholder" class="screen-placeholder" :hidden="!showPlaceholder">
      {{ t('Подключение к экрану') }}
    </div>

    <div v-if="meta" id="screenMeta" class="screen-meta">
      <span class="screen-meta__live" aria-hidden="true"></span>
      <span id="screenMetaTitle" class="screen-meta__title"
        ><slot name="title" :title="meta.title">{{ meta.title }}</slot></span
      >
      <span v-if="meta.showSepProfile" id="screenMetaSepProfile" class="screen-meta__sep" aria-hidden="true">·</span>
      <span v-if="meta.showQuality" id="screenMetaQuality" class="screen-meta__detail">{{ meta.qualityLabel }}</span>
      <span v-if="meta.showSepFps" id="screenMetaSepFps" class="screen-meta__sep" aria-hidden="true">·</span>
      <span v-if="meta.showFps" id="screenMetaFps" class="screen-meta__detail">{{ meta.fpsLabel }}</span>
      <span v-if="meta.showSepViewers" id="screenMetaSepViewers" class="screen-meta__sep" aria-hidden="true">·</span>
      <span id="screenMetaViewers" class="screen-meta__detail screen-meta__viewers">
        <template v-if="meta.viewerAvatars.length === 0">{{ t('Смотрят: 0') }}</template>
        <AvatarStack
          v-else
          :items="meta.viewerAvatars"
          :max-avatars="null"
          :size="24"
          :aria-label="t('Смотрят стрим')"
          class="screen-meta__avatar-stack"
        />
      </span>
    </div>

    <div id="screenViewControls" class="screen-view-controls" :hidden="!showControls">
      <div id="streamVolumeControl" class="stream-volume" :hidden="volume.hidden">
        <IconButton
          id="streamVolumeButton"
          :size="40"
          variant="outline"
          scrim
          :tooltip="false"
          class="screen-view-controls__button stream-volume__button"
          :label="volume.ariaLabel"
          :aria-pressed="volume.muted"
          @click="emit('toggleMute')"
        >
          <span class="stream-volume__icon stream-volume__icon--on" aria-hidden="true"><Volume2 /></span>
          <span class="stream-volume__icon stream-volume__icon--off" aria-hidden="true"><VolumeX /></span>
        </IconButton>
        <div id="streamVolumePopover" class="stream-volume__popover">
          <output class="stream-volume__value" :class="{ 'stream-volume__value--muted': volume.muted }">
            {{ volume.valuePercent }}%
          </output>
          <Slider
            class="stream-volume__slider"
            orientation="vertical"
            :max="volume.maxPercent"
            :model-value="volume.valuePercent"
            :aria-label="t('Громкость стрима')"
            :aria-value-text="`${volume.valuePercent}%`"
            @value-change="emit('updateVolume', $event)"
          />
        </div>
      </div>

      <IconButton
        id="screenFullscreenButton"
        :size="40"
        variant="outline"
        scrim
        :tooltip="false"
        class="screen-view-controls__button screen-view-controls__fullscreen"
        :label="fullscreen.ariaLabel"
        :aria-pressed="fullscreen.fullscreen"
        @click="emit('toggleFullscreen')"
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
      </IconButton>
    </div>
  </div>
</template>
