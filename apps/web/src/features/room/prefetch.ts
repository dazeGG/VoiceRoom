// What joining a call loads, fetched before the visitor asks for it: the room
// page, the room client, the LiveKit library, the largest chunk of all, and the
// noise suppression files the microphone loads one after another. The landing
// and the room link start it once the page is idle, so a click on "create" or
// "join" finds them in the cache. A failed prefetch is dropped; the real load
// asks again.

import { loadLiveKitClient } from './client/media/livekit-runtime';

export const loadRoomPage = () => import('./RoomPage.vue');

export function prefetchRoom(): void {
  const ignore = () => {};
  loadRoomPage().catch(ignore);
  import('./client/main').catch(ignore);
  loadLiveKitClient().catch(ignore);
  import('./client/core/config')
    .then(({ MICROPHONE_ASSET_URLS }) => {
      for (const url of MICROPHONE_ASSET_URLS) fetch(url).catch(ignore);
    })
    .catch(ignore);
}
