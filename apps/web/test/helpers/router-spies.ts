// The router's push and replace, recorded by the path they were sent to. The
// lobby sends a location with a shallow mark (shallow-routing.ts), SvelteKit's
// pushState got the bare URL; tests assert the address either way.

import { vi } from 'vitest';
import type { RouteLocationRaw, Router } from 'vue-router';

function pathOf(to: RouteLocationRaw): string {
  if (typeof to === 'string') return to;
  return 'path' in to && typeof to.path === 'string' ? to.path : '';
}

/** Records each `router.push` by its path; the navigation still runs. */
export function spyOnPush(router: Router) {
  const paths = vi.fn<(path: string) => void>();
  const push = router.push.bind(router);
  router.push = (to) => {
    paths(pathOf(to));
    return push(to);
  };
  return paths;
}

/** Records each `router.replace` by its path; the navigation still runs. */
export function spyOnReplace(router: Router) {
  const paths = vi.fn<(path: string) => void>();
  const replace = router.replace.bind(router);
  router.replace = (to) => {
    paths(pathOf(to));
    return replace(to);
  };
  return paths;
}
