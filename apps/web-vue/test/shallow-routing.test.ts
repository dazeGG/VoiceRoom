// The lobby's address changes are marked in history, so the route view and the
// update guard can tell them from real navigations, also after the back button.

import { createRouter, createWebHistory, type Router } from 'vue-router';
import { beforeEach, expect, test, vi } from 'vitest';
import { reloadNavigationsOnUpdate } from '../src/features/app-update/update-navigation.ts';
import { isShallowEntry, shallowPush, shallowReplace } from '../src/shared/utils/shallow-routing.ts';

const Page = { render: () => null };
let router: Router;

beforeEach(async () => {
  window.history.replaceState(null, '', '/');
  router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/', component: Page },
      { path: '/r/:roomId', component: Page },
      { path: '/privacy', component: Page }
    ]
  });
  await router.push('/');
  await router.isReady();
});

function back(): Promise<void> {
  return new Promise((resolve) => {
    const stop = router.afterEach(() => {
      stop();
      resolve();
    });
    window.history.back();
  });
}

test('a shallow push changes the address and marks its entry; a real push does not', async () => {
  await shallowPush(router, '/r/abc');
  expect(window.location.pathname).toBe('/r/abc');
  expect(router.currentRoute.value.params.roomId).toBe('abc');
  expect(isShallowEntry('/r/abc')).toBe(true);

  await router.push('/privacy');
  expect(isShallowEntry('/privacy')).toBe(false);
});

test('the back button to a shallow entry finds it marked, and to a real one not', async () => {
  await router.push('/privacy');
  await shallowPush(router, '/r/abc');
  await router.push('/r/xyz');

  await back();
  expect(window.location.pathname).toBe('/r/abc');
  expect(isShallowEntry('/r/abc')).toBe(true);

  await back();
  expect(window.location.pathname).toBe('/privacy');
  expect(isShallowEntry('/privacy')).toBe(false);
});

test('a shallow replace marks the entry it rewrites', async () => {
  await router.push('/r/abc');
  expect(isShallowEntry('/r/abc')).toBe(false);
  await shallowReplace(router, '/');
  expect(window.location.pathname).toBe('/');
  expect(isShallowEntry('/')).toBe(true);
});

test('with a new build out, a real navigation loads as a full page; shallow ones and calls do not', async () => {
  const load = vi.fn<(href: string) => void>();
  let inCall = false;
  const remove = reloadNavigationsOnUpdate(router, { updated: () => true, inCall: () => inCall, load });

  await shallowPush(router, '/r/abc');
  expect(window.location.pathname).toBe('/r/abc');
  await shallowReplace(router, '/');
  expect(load).not.toHaveBeenCalled();

  await router.push('/privacy');
  expect(load).toHaveBeenCalledWith('/privacy');

  inCall = true;
  await router.push('/r/xyz');
  expect(window.location.pathname).toBe('/r/xyz');
  expect(load).toHaveBeenCalledTimes(1);
  remove();
});

test('the back button returning to a shallow entry is not taken for a navigation to reload on', async () => {
  await shallowPush(router, '/r/abc');
  await shallowPush(router, '/r/xyz');
  const load = vi.fn<(href: string) => void>();
  const remove = reloadNavigationsOnUpdate(router, { updated: () => true, inCall: () => false, load });

  await back();
  expect(window.location.pathname).toBe('/r/abc');
  expect(load).not.toHaveBeenCalled();
  remove();
});

test('without a new build nothing reloads', async () => {
  const load = vi.fn<(href: string) => void>();
  const remove = reloadNavigationsOnUpdate(router, { updated: () => false, inCall: () => false, load });
  await router.push('/privacy');
  expect(window.location.pathname).toBe('/privacy');
  expect(load).not.toHaveBeenCalled();
  remove();
});

test('with a new build out, the back button to a real entry loads it and stays there', async () => {
  await router.push('/privacy');
  await shallowPush(router, '/r/abc');
  const load = vi.fn<(href: string) => void>();
  const remove = reloadNavigationsOnUpdate(router, { updated: () => true, inCall: () => false, load });

  await back();
  expect(load).toHaveBeenCalledWith('/privacy');
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(window.location.pathname).toBe('/privacy');
  remove();
});

test('a real replace of a shallow entry is a real navigation', async () => {
  await shallowPush(router, '/r/abc');
  await router.replace('/privacy');
  expect(isShallowEntry('/privacy')).toBe(false);
});
