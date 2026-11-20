<script setup lang="ts">
import { computed } from 'vue';
import { ParticipantTile } from '@voice-room/call/views';
import { state } from '@voice-room/call/engine/core/room-runtime.store';
import type { Participant } from '@voice-room/call/engine/core/types';
import { useParticipantsUiStore } from '@voice-room/call/engine/core/participants-ui.store';
import { enterScreenView, leaveScreenView } from '@voice-room/call/engine/ui/screen-view';
import EmojiText from '@/shared/chat/EmojiText.vue';
import { createLogger, errorContext } from '@/shared/log';
import { AccountBadge } from '@/shared/ui';
import { getAvatarPresentation } from '@/shared/ui/avatar-presentation';
import { useParticipantContextUiStore } from '../participant-context-ui.store';

const { participant, variant = 'grid' } = defineProps<{
  participant: Participant;
  variant?: 'grid' | 'focus' | 'strip';
}>();

const log = createLogger('room:participant');
const participantContext = useParticipantContextUiStore();
const participantsUi = useParticipantsUiStore();
const avatar = computed(() => getAvatarPresentation(participant));

function showScreenError(error: unknown): void {
  log.error('screen view action failed', errorContext(error));
}

// Entering the participant spotlight closes the separate stream spotlight.
function activateParticipant(): void {
  if (state.viewedScreenPeerId) void leaveScreenView({ keepPreview: true }).catch(showScreenError);
  participantsUi.toggleParticipantFocus(participant.id);
}

function watchScreen(): void {
  void enterScreenView(participant.id).catch(showScreenError);
}

function openMenu(x: number, y: number, tile: HTMLElement | null): void {
  participantContext.openParticipantContextMenu(participant.id, x, y, 'tile', tile);
}
</script>

<template>
  <ParticipantTile
    :participant="participant"
    :avatar="avatar"
    :variant="variant"
    :viewing="state.viewedScreenPeerId === participant.id"
    :mirrored="participant.isLocal && state.cameraFacing !== 'environment'"
    :screen-requesting="state.screenRequesting"
    :context-menu="!participant.isLocal"
    @activate="activateParticipant"
    @watch-screen="watchScreen"
    @context-menu="openMenu"
  >
    <template #name><EmojiText :text="participant.name" /></template>
    <template #badge><AccountBadge :user-id="participant.accountUserId" /></template>
  </ParticipantTile>
</template>
