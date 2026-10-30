<script setup lang="ts">
// One person on the phone layout. The picture is never cropped: it is fitted
// whole, and a blurred copy of the same frame fills the rest of the tile.
import { HeadphoneOff, MicOff, MonitorPlay } from '@lucide/vue';
import { computed, ref, type Directive } from 'vue';
import type { Participant } from '@/features/room/client/core/types';
import { state as roomState } from '@/features/room/client/core/room-runtime.store';
import { enterScreenView } from '@/features/room/client/ui/screen-view';
import { keepVideoFitted } from '@/features/room/client/ui/video-fit';
import EmojiText from '@/shared/chat/EmojiText.vue';
import { createLogger, errorContext } from '@/shared/log';
import { getAvatarPresentation } from '@/shared/ui/avatar-presentation';

const log = createLogger('room:mobile-tile');

const { participant, variant = 'grid' } = defineProps<{
  participant: Participant;
  /** `bleed` fills the whole screen, `pip` is the floating picture-in-picture. */
  variant?: 'grid' | 'focus' | 'strip' | 'bleed' | 'pip';
}>();

const emit = defineEmits<{
  tap: [];
  /** The camera's width over its height, `null` while there is no picture. */
  frame: [ratio: number | null];
}>();

// A new avatar gets a fresh attempt: only the URL that failed stays hidden.
const failedAvatarUrl = ref<string | null>(null);

const avatar = computed(() => getAvatarPresentation(participant));
const imageFailed = computed(() => failedAvatarUrl.value !== null && failedAvatarUrl.value === avatar.value.src);
const cameraStream = computed(() => participant.cameraStream);
const mirrored = computed(() => participant.isLocal && roomState.cameraFacing !== 'environment');
const canWatch = computed(() => !participant.isLocal && participant.screen);

function showCamera(video: HTMLVideoElement, stream: MediaStream): void {
  video.srcObject = stream;
  void video.play().catch(() => {});
}

// A phone camera can change its shape while it starts or turns, so the size
// is reported on every change, not only once.
function reportFrame(video: HTMLVideoElement): () => void {
  const report = (): void => {
    if (video.videoWidth > 0 && video.videoHeight > 0) emit('frame', video.videoWidth / video.videoHeight);
  };
  video.addEventListener('loadedmetadata', report);
  video.addEventListener('resize', report);
  report();
  return () => {
    video.removeEventListener('loadedmetadata', report);
    video.removeEventListener('resize', report);
    emit('frame', null);
  };
}

interface CameraBinding {
  stream: MediaStream;
  /** The picture itself (not the blurred copy) reports its size and is kept fitted. */
  main: boolean;
}

const stopWatching = new WeakMap<HTMLVideoElement, () => void>();

const vCamera: Directive<HTMLVideoElement, CameraBinding> = {
  mounted(video, { value }) {
    showCamera(video, value.stream);
    if (!value.main) return;
    const stopReport = reportFrame(video);
    const stopFit = keepVideoFitted(video);
    stopWatching.set(video, () => {
      stopReport();
      stopFit();
    });
  },
  updated(video, { value, oldValue }) {
    if (value.stream !== oldValue?.stream) showCamera(video, value.stream);
  },
  unmounted(video) {
    video.srcObject = null;
    stopWatching.get(video)?.();
    stopWatching.delete(video);
  }
};

// The plate is drawn for the eye; the button under it says the same aloud.
const spokenLabel = computed(() =>
  [
    participant.name,
    participant.isLocal ? 'вы' : '',
    participant.muted ? 'микрофон выключен' : '',
    participant.deafened ? 'звук выключен' : ''
  ]
    .filter(Boolean)
    .join(', ')
);

function watchScreen(event: MouseEvent): void {
  event.stopPropagation();
  void enterScreenView(participant.id).catch((error: unknown) =>
    log.error('screen view action failed', errorContext(error))
  );
}
</script>

<template>
  <div
    :class="[
      'mobile-call-tile',
      `mobile-call-tile--${variant}`,
      { 'mobile-call-tile--camera': cameraStream, 'mobile-call-tile--speaking': participant.speaking }
    ]"
    :data-peer-id="participant.id"
    :style="{ '--participant-pastel': avatar.background, '--participant-avatar-fg': avatar.foreground }"
  >
    <template v-if="cameraStream">
      <!-- The picture-in-picture takes the camera's own shape, so nothing is left to fill:
           its picture fills the box outright, and Safari on iPhone has no stale size to fit
           it by (WebKit bug 275210). -->
      <video
        v-if="variant !== 'pip'"
        v-camera="{ stream: cameraStream, main: false }"
        :class="['mobile-call-tile__backdrop', { 'mobile-call-tile__backdrop--mirrored': mirrored }]"
        aria-hidden="true"
        autoplay
        playsinline
        muted
      ></video>
      <video
        v-camera="{ stream: cameraStream, main: true }"
        :class="['mobile-call-tile__video', { 'mobile-call-tile__video--mirrored': mirrored }]"
        :style="{ objectFit: variant === 'pip' ? 'fill' : undefined }"
        autoplay
        playsinline
        muted
      ></video>
    </template>
    <span v-else class="mobile-call-tile__avatar" aria-hidden="true">
      <img v-if="avatar.src && !imageFailed" :src="avatar.src" alt="" @error="failedAvatarUrl = avatar.src" />
      <template v-else>{{ avatar.initials }}</template>
    </span>
    <!-- The whole tile is one button; the screen action below sits beside it, not inside. -->
    <button class="mobile-call-tile__hit" type="button" :aria-label="spokenLabel" @click="emit('tap')"></button>
    <div class="mobile-call-tile__name" aria-hidden="true">
      <span class="mobile-call-tile__name-text"><EmojiText :text="participant.name" /></span>
      <span v-if="participant.isLocal" class="mobile-call-tile__you">вы</span>
      <span v-if="participant.muted" class="mobile-call-tile__icon"><MicOff /></span>
      <span v-if="participant.deafened" class="mobile-call-tile__icon"><HeadphoneOff /></span>
    </div>
    <button
      v-if="canWatch"
      class="mobile-call-tile__screen"
      type="button"
      :disabled="roomState.screenRequesting"
      @click="watchScreen"
    >
      <MonitorPlay aria-hidden="true" />
      <span>Экран</span>
    </button>
  </div>
</template>
