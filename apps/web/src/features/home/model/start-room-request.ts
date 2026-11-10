// The public site's «Создать комнату» opens /app?start=room (app-home.ts): the
// room is made as if the button here had been pressed. The request is taken
// off the address at once, so a reload or the back button does not make another.

import type { RouteLocationNormalizedLoaded, Router } from 'vue-router';
import { START_ROOM_QUERY } from '@/shared/app-home';

/** Whether the address asked for a room; the address is left without the request. */
export function takeStartRoomRequest(route: RouteLocationNormalizedLoaded, router: Router): boolean {
  if (route.query.start !== START_ROOM_QUERY.start) return false;
  const query = { ...route.query };
  delete query.start;
  void router.replace({ path: route.path, query, hash: route.hash });
  return true;
}
