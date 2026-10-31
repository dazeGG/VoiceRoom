<script setup lang="ts">
import { computed } from 'vue';
import { state } from '../client/core/room-runtime.store';
import {
  getScreenParticipants,
  getScreenStreamForParticipant,
  hasStreamTilePreview,
  isScreenSubscribed,
  isStreamTileCollapsed
} from '../client/ui/screen-view';
import { useScreenUiStore } from '../screen-ui.store';
import StreamTile from './StreamTile.vue';

const screenUi = useScreenUiStore();

const tiles = computed(() => {
  // Streams change in place, which only the revision announces; it never is negative.
  if (screenUi.revision < 0) return [];
  return getScreenParticipants().filter((participant) => participant.id !== state.viewedScreenPeerId);
});
</script>

<template>
  <StreamTile
    v-for="participant in tiles"
    :key="participant.id"
    :participant="participant"
    :has-preview="hasStreamTilePreview(participant)"
    :is-collapsed="isStreamTileCollapsed(participant)"
    :is-subscribed="isScreenSubscribed(participant.id)"
    :stream="getScreenStreamForParticipant(participant)"
  />
</template>
