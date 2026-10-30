<script setup lang="ts">
// `/` and `/r/:roomId` are one route component, so the lobby moving the
// address between them (shallow-routing.ts) never remounts it. What it shows
// is decided by real navigations only, as SvelteKit decided the page: a load,
// a link, the back button to an entry that was not written shallowly.
import { ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import HomeRoute from '@/features/home/HomeRoute.vue';
import { isShallowEntry } from '@/shared/utils/shallow-routing';
import RoomRoute from './RoomRoute.vue';

const route = useRoute();

function roomIdOf(params: typeof route.params): string {
  const roomId = params.roomId;
  return typeof roomId === 'string' ? roomId : '';
}

const shownRoomId = ref(roomIdOf(route.params));

watch(
  () => route.fullPath,
  () => {
    if (isShallowEntry(route.fullPath)) return;
    shownRoomId.value = roomIdOf(route.params);
  }
);
</script>

<template>
  <RoomRoute v-if="shownRoomId" :room-id="shownRoomId" />
  <HomeRoute v-else />
</template>
