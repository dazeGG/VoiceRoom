<script setup lang="ts">
import { computed } from 'vue';
import { StreamTile } from '@voice-room/call/views';
import { state } from '@voice-room/call/engine/core/room-runtime.store';
import type { Participant } from '@voice-room/call/engine/core/types';
import { getScreenProfileLabels } from '@voice-room/call/engine/media/profiles';
import { playMediaElement } from '@voice-room/call/engine/services/media-playback-service';
import { enterScreenView } from '@voice-room/call/engine/ui/screen-view';
import { createLogger, errorContext } from '@/shared/log';
import { getAvatarPresentation } from '@voice-room/ui/avatar-presentation';

const { participant } = defineProps<{
  participant: Participant;
  hasPreview: boolean;
  isCollapsed: boolean;
  isSubscribed: boolean;
  stream: MediaStream | null;
}>();

const log = createLogger('room:stream');
const avatar = computed(() => getAvatarPresentation(participant));
const profileMeta = computed(() => {
  const profileId = participant.isLocal ? state.localScreenProfileId : participant.screenProfileId;
  const { qualityLabel, fpsLabel } = getScreenProfileLabels(profileId);
  return [qualityLabel, fpsLabel].filter(Boolean).join(' · ');
});

function watchScreen(): void {
  void enterScreenView(participant.id).catch((error: unknown) =>
    log.error('screen view action failed', errorContext(error))
  );
}
</script>

<template>
  <StreamTile
    v-bind="$props"
    :avatar="avatar"
    :profile-meta="profileMeta"
    @watch-screen="watchScreen"
    @preview-attached="playMediaElement"
  />
</template>
