// What joining a call loads, fetched before the visitor asks for it: the room
// page, the room client and the LiveKit library, the largest chunk of all. The
// landing and the room link start it once the page is idle, so a click on
// "create" or "join" finds them in the cache. A failed prefetch is dropped;
// the real load asks again.

import { loadLiveKitClient } from './client/media/livekit-runtime';

export const loadRoomPage = () => import('./RoomPage.vue');

export function prefetchRoom(): void {
  const ignore = () => {};
  loadRoomPage().catch(ignore);
  import('./client/main').catch(ignore);
  loadLiveKitClient().catch(ignore);
}
