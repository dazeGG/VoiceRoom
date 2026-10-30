// Once a new web app is out, the next move inside the app loads it as a full
// page, so it arrives without a separate reload; never during a call, and not
// for the lobby's shallow address changes (SvelteKit's beforeNavigate did not
// see those either).

import type { Router } from 'vue-router';
import { isShallowNavigation } from '@/shared/utils/shallow-routing';

export interface UpdateNavigationOptions {
  updated: () => boolean;
  inCall: () => boolean;
  /** Loads `href` as a full page. */
  load?: (href: string) => void;
}

/** Adds the guard; returns its removal. */
export function reloadNavigationsOnUpdate(
  router: Router,
  { updated, inCall, load = (href) => (window.location.href = href) }: UpdateNavigationOptions
): () => void {
  return router.beforeEach((to) => {
    if (!updated() || inCall() || isShallowNavigation(to)) return true;
    load(router.resolve(to).href);
    return false;
  });
}
