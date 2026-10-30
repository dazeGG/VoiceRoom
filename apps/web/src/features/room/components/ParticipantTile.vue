<script setup lang="ts">
import { HeadphoneOff, MicOff, MonitorPlay } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import EmojiText from '@/shared/chat/EmojiText.vue';
import { createLogger, errorContext } from '@/shared/log';
import { AccountBadge } from '@/shared/ui';
import { getAvatarPresentation } from '@/shared/ui/avatar-presentation';
import { iconSm } from '@/shared/ui/icons';
import { state as roomState } from '../client/core/room-runtime.store';
import type { Participant } from '../client/core/types';
import { enterScreenView, leaveScreenView } from '../client/ui/screen-view';
import { keepVideoFitted } from '../client/ui/video-fit';
import { useParticipantContextUiStore } from '../participant-context-ui.store';
import { useParticipantsUiStore } from '../participants-ui.store';

const log = createLogger('room:participant');

const { participant, variant = 'grid' } = defineProps<{
  participant: Participant;
  variant?: 'grid' | 'focus' | 'strip';
}>();

const participantContext = useParticipantContextUiStore();
const participantsUi = useParticipantsUiStore();

const tile = ref<HTMLElement | null>(null);
const cameraVideo = ref<HTMLVideoElement | null>(null);
// A new avatar gets a fresh attempt: only the URL that failed stays hidden.
const failedAvatarUrl = ref<string | null>(null);

const avatar = computed(() => getAvatarPresentation(participant));
const imageFailed = computed(() => failedAvatarUrl.value !== null && failedAvatarUrl.value === avatar.value.src);
const viewing = computed(() => roomState.viewedScreenPeerId === participant.id);
const canWatch = computed(() => !participant.isLocal && participant.screen && !viewing.value);
const screenActionLabel = computed(() => (roomState.screenRequesting ? 'Подключение' : 'Смотреть экран'));
const cameraStream = computed(() => participant.cameraStream);
const mirrored = computed(() => participant.isLocal && roomState.cameraFacing !== 'environment');

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

// A participant tile always spotlights the person; their stream stays a
// separate tile (StreamTile) that spotlights the screen instead. The two
// spotlights are mutually exclusive, so entering one leaves the other.
function activateParticipant(): void {
  if (roomState.viewedScreenPeerId) {
    void leaveScreenView({ keepPreview: true }).catch((error: unknown) =>
      log.error('screen view action failed', errorContext(error))
    );
  }
  participantsUi.toggleParticipantFocus(participant.id);
}

function handleTileClick(event: MouseEvent): void {
  if (event.target instanceof Element && event.target.closest('button, select, input, a')) return;
  activateParticipant();
}

function handleScreenAction(event: MouseEvent): void {
  event.stopPropagation();
  void enterScreenView(participant.id).catch((error: unknown) =>
    log.error('screen view action failed', errorContext(error))
  );
}

function handleContextMenu(event: MouseEvent): void {
  if (participant.isLocal) return;
  event.preventDefault();
  event.stopPropagation();
  participantContext.openParticipantContextMenu(participant.id, event.clientX, event.clientY, 'tile', tile.value);
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    activateParticipant();
    return;
  }
  if (participant.isLocal) return;
  const isContextKey = event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
  if (!isContextKey || !tile.value) return;
  event.preventDefault();
  event.stopPropagation();
  const rect = tile.value.getBoundingClientRect();
  participantContext.openParticipantContextMenu(
    participant.id,
    rect.left + rect.width / 2,
    rect.top + rect.height / 2,
    'tile',
    tile.value
  );
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
    :aria-haspopup="participant.isLocal ? undefined : 'dialog'"
    :aria-label="
      participant.isLocal ? undefined : `${participant.name}. Откройте контекстное меню Shift+F10 или клавишей меню.`
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
    <div class="participant__ring" aria-hidden="true">
      <span class="participant__avatar">
        <img v-if="avatar.src && !imageFailed" :src="avatar.src" alt="" @error="failedAvatarUrl = avatar.src" />
        <template v-else>{{ avatar.initials }}</template>
      </span>
    </div>
    <div class="participant__copy">
      <h2 class="participant__heading">
        <span class="participant__name"><EmojiText :text="participant.name" /></span>
        <AccountBadge :user-id="participant.accountUserId" />
        <span v-if="participant.isLocal" class="participant__you">вы</span>
        <span class="participant__muted-icon" aria-label="Микрофон выключен" title="Микрофон выключен"
          ><MicOff v-bind="iconSm"
        /></span>
        <span class="participant__deafened-icon" aria-label="Звук выключен" title="Звук выключен"
          ><HeadphoneOff v-bind="iconSm"
        /></span>
      </h2>
      <p v-if="participant.statusLabel" class="participant__status">{{ participant.statusLabel }}</p>
      <p v-else class="participant__status" hidden></p>
      <button
        class="participant__screen-action"
        type="button"
        :hidden="!canWatch"
        :disabled="roomState.screenRequesting"
        @click="handleScreenAction"
      >
        <MonitorPlay v-bind="iconSm" aria-hidden="true" />
        <span>{{ screenActionLabel }}</span>
      </button>
    </div>
  </div>
</template>
