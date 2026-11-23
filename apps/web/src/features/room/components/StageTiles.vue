<script setup lang="ts">
import { computed } from 'vue';
import { StageTiles } from '@voiceroom/call/views';
import { state } from '@voiceroom/call/engine/core/room-runtime.store';
import { useParticipantsUiStore } from '@voiceroom/call/engine/core/participants-ui.store';
import { useScreenUiStore } from '@voiceroom/call/engine/core/screen-ui.store';
import { getScreenParticipants } from '@voiceroom/call/engine/ui/screen-view';
import ParticipantContextMenu from './ParticipantContextMenu.vue';
import ParticipantList from './ParticipantList.vue';
import StreamTiles from './StreamTiles.vue';

const participantsUi = useParticipantsUiStore();
const screenUi = useScreenUiStore();
const participants = computed(() => participantsUi.getSortedParticipants());
const focusedParticipant = computed(() => participantsUi.getFocusedParticipant());
const streamCount = computed(() => {
  // Only the revision announces in-place stream changes.
  if (screenUi.revision < 0) return 0;
  return getScreenParticipants().filter((participant) => participant.id !== state.viewedScreenPeerId).length;
});
</script>

<template>
  <StageTiles
    :participants="participants"
    :focused-participant="focusedParticipant"
    :screen-focused="screenUi.stageVisible"
    :stream-count="streamCount"
  >
    <template #participants="{ participants: tiles, variant }">
      <ParticipantList :participants="tiles" :variant="variant" />
    </template>
    <template #streams><StreamTiles /></template>
    <template #contextMenu><ParticipantContextMenu /></template>
  </StageTiles>
</template>
