<script setup lang="ts">
import { t } from '@voice-room/ui/i18n';
import { Button, ParticipantTileFace } from '@voice-room/ui/components';
import { MonitorPlay } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import type { Participant } from '../engine/core/types';
import { keepVideoFitted } from '../engine/ui/video-fit';
import type { CallAvatar } from './types';

const {
  participant,
  variant = 'grid',
  screenRequesting,
  viewing,
  contextMenu
} = defineProps<{
  participant: Pick<
    Participant,
    'id' | 'name' | 'isLocal' | 'deafened' | 'muted' | 'screen' | 'speaking' | 'cameraStream' | 'statusLabel'
  >;
  avatar: CallAvatar;
  variant?: 'grid' | 'focus' | 'strip';
  viewing: boolean;
  mirrored: boolean;
  screenRequesting: boolean;
  contextMenu?: boolean;
}>();

const emit = defineEmits<{
  activate: [];
  watchScreen: [];
  contextMenu: [x: number, y: number, tile: HTMLElement | null];
}>();

defineSlots<{
  name?(): unknown;
  badge?(): unknown;
}>();

const tile = ref<HTMLElement | null>(null);
const cameraVideo = ref<HTMLVideoElement | null>(null);
const canWatch = computed(() => !participant.isLocal && participant.screen && !viewing);
const screenActionLabel = computed(() => (screenRequesting ? t('Подключение') : t('Смотреть экран')));
const cameraStream = computed(() => participant.cameraStream);

watch(
  [cameraVideo, cameraStream],
  ([video, stream], _previous, onCleanup) => {
    if (!video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => {});
    onCleanup(() => {
      video.srcObject = null;
    });
  },
  { flush: 'post' }
);

watch(
  cameraVideo,
  (video, _previous, onCleanup) => {
    if (video) onCleanup(keepVideoFitted(video));
  },
  { flush: 'post' }
);

function handleTileClick(event: MouseEvent): void {
  if (event.target instanceof Element && event.target.closest('button, select, input, a')) return;
  emit('activate');
}

function handleScreenAction(event: MouseEvent): void {
  event.stopPropagation();
  emit('watchScreen');
}

function handleContextMenu(event: MouseEvent): void {
  if (!contextMenu) return;
  event.preventDefault();
  event.stopPropagation();
  emit('contextMenu', event.clientX, event.clientY, tile.value);
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.target !== tile.value) return;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    emit('activate');
    return;
  }
  if (!contextMenu) return;
  const isContextKey = event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
  if (!isContextKey || !tile.value) return;
  event.preventDefault();
  event.stopPropagation();
  const rect = tile.value.getBoundingClientRect();
  emit('contextMenu', rect.left + rect.width / 2, rect.top + rect.height / 2, tile.value);
}
</script>

<template>
  <div
    ref="tile"
    role="button"
    :class="[
      'participant',
      `participant--${variant}`,
      {
        'participant--local': participant.isLocal,
        'participant--deafened': participant.deafened,
        'participant--muted': participant.muted,
        'participant--screen': participant.screen,
        'participant--camera': cameraStream,
        'participant--speaking': participant.speaking
      }
    ]"
    :data-peer-id="participant.id"
    tabindex="0"
    :aria-haspopup="contextMenu ? 'dialog' : undefined"
    :aria-label="
      contextMenu
        ? t('{p0}. Откройте контекстное меню Shift+F10 или клавишей меню.', { p0: participant.name })
        : undefined
    "
    :style="{ '--participant-pastel': avatar.background, '--participant-avatar-fg': avatar.foreground }"
    @click="handleTileClick"
    @contextmenu="handleContextMenu"
    @keydown="handleKeydown"
  >
    <video
      v-if="cameraStream"
      ref="cameraVideo"
      :class="['participant__camera', { 'participant__camera--mirrored': mirrored }]"
      autoplay
      playsinline
      muted
    ></video>
    <ParticipantTileFace
      :name="participant.name"
      :initials="avatar.initials"
      :avatar-src="avatar.src"
      :local="participant.isLocal"
      :status-label="participant.statusLabel"
    >
      <template #name
        ><slot name="name">{{ participant.name }}</slot></template
      >
      <template #badge><slot name="badge" /></template>
      <Button
        class="participant__screen-action"
        size="sm"
        variant="primary"
        :hidden="!canWatch"
        :disabled="screenRequesting"
        @click="handleScreenAction"
      >
        <template #icon><MonitorPlay aria-hidden="true" /></template>
        <span>{{ screenActionLabel }}</span>
      </Button>
    </ParticipantTileFace>
  </div>
</template>
