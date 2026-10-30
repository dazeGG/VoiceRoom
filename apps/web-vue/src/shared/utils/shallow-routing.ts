// SvelteKit's shallow routing on top of vue-router. The lobby moves the address
// between `/` and `/r/:id` while it stays on screen; SvelteKit's pushState and
// replaceState did that without a navigation. Here the entry goes through the
// router (so the back button and `useRoute()` follow it) and is marked in
// history.state, so the route view keeps what it shows and the update guard
// lets it pass, also when the back button returns to it.

import type { RouteLocationNormalized, Router } from 'vue-router';

// Pushes and replaces still running their guards, by path: history.state does
// not carry the mark until the router writes the entry. Counted, so an earlier
// one that finishes does not unmark a later one to the same path.
const pendingShallowPaths = new Map<string, number>();

function navigate(router: Router, path: string, replace: boolean): Promise<void> {
  pendingShallowPaths.set(path, (pendingShallowPaths.get(path) ?? 0) + 1);
  // The path, not a flag: vue-router copies the old state into a later replace
  // of the same entry, and a flag would mark that real navigation shallow too.
  // `force`: the address may lag behind the route (the back button inside the
  // lobby), and a write to the route the router is on must still land.
  const location = { path, state: { shallowPath: path }, force: true };
  // SvelteKit wrote the address at once, and the code copied from it reads
  // window.location right after (the room client and the room chat take their
  // room from it). The router writes after its guards, so the address changes
  // here first; a push then rewrites the entry it leaves back to the router's
  // own address for it (`history.state.current`) before adding the new one.
  // This relies on shallow targets settling within microtasks (MainRoute is
  // loaded eagerly and no guard waits), so a back press cannot land between.
  const history: { readonly state: unknown } = window.history;
  window.history.replaceState(history.state, '', path);
  // A navigation that did not happen leaves the entry's own address, unless a
  // later one has written its own since.
  const restore = (): void => {
    const state = history.state;
    if (currentPath() === path && isRecord(state) && typeof state.current === 'string') {
      window.history.replaceState(state, '', state.current);
    }
  };
  return (replace ? router.replace(location) : router.push(location))
    .then(
      (failure) => {
        if (failure) restore();
      },
      (error: unknown) => {
        restore();
        throw error;
      }
    )
    .finally(() => {
      const left = (pendingShallowPaths.get(path) ?? 1) - 1;
      if (left > 0) pendingShallowPaths.set(path, left);
      else pendingShallowPaths.delete(path);
    });
}

/** SvelteKit `pushState(url, {})`: a new history entry, the page stays. */
export function shallowPush(router: Router, path: string): Promise<void> {
  return navigate(router, path, false);
}

/** SvelteKit `replaceState(url, {})`: the current entry changes, the page stays. */
export function shallowReplace(router: Router, path: string): Promise<void> {
  return navigate(router, path, true);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function currentPath(): string {
  return `${window.location.pathname}${window.location.search}`;
}

/** Whether the history entry now shown for `fullPath` was written by a shallow push or replace. */
export function isShallowEntry(fullPath: string): boolean {
  // History types `state` as any; read it as what it is, unknown.
  const history: { readonly state: unknown } = window.history;
  const state = history.state;
  return isRecord(state) && state.shallowPath === fullPath && state.current === fullPath;
}

/** For a router guard: the navigation to `to` is a shallow one, or the back button returning to one. */
export function isShallowNavigation(to: RouteLocationNormalized): boolean {
  return pendingShallowPaths.has(to.fullPath) || isShallowEntry(to.fullPath);
}
