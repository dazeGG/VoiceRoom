<script setup lang="ts">
// `/` and `/r/:roomId` are one route component, so the lobby moving the
// address between them (shallow-routing.ts) never remounts it. What it shows
// is decided by real navigations only, as SvelteKit decided the page: a load,
// a link, the back button to an entry that was not written shallowly.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import HomeRoute from '@/features/home/HomeRoute.vue';
import { prefetchRoom } from '@/features/room/prefetch';
import { isDesktopBoundaryAllowed } from '@/platform/desktop-boundary';
import { whenIdle } from '@/shared/utils/idle';
import { isShallowEntry } from '@/shared/utils/shallow-routing';
import RoomRoute from './RoomRoute.vue';

const route = useRoute();

// Most visits here on a computer end in a call; its code loads while the
// visitor reads. A phone, where the landing is rarely the way into a call,
// does not spend mobile data on it.
let cancelPrefetch = () => {};
onMounted(() => {
  if (isDesktopBoundaryAllowed()) cancelPrefetch = whenIdle(prefetchRoom);
});
onBeforeUnmount(() => cancelPrefetch());

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
