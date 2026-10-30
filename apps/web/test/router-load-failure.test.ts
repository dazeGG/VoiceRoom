// A page whose code no longer loads (a deploy replaced it) opens as a full
// page load, so the new build serves it; the first page does not, as that
// load would only fail again.

import { createMemoryHistory, createRouter } from 'vue-router';
import { expect, test, vi } from 'vitest';
import { loadFailedPagesInFull } from '../src/router.ts';

const Page = { render: () => null };
const missingChunk = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module'));

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: Page },
      { path: '/privacy', component: missingChunk }
    ]
  });
}

test('a page that fails to load inside the app loads as a full page', async () => {
  const router = makeRouter();
  const load = vi.fn<(href: string) => void>();
  loadFailedPagesInFull(router, load);
  await router.push('/');

  await router.push('/privacy').catch(() => undefined);

  expect(load).toHaveBeenCalledWith('/privacy');
});

test('the first page failing to load is not loaded again', async () => {
  const router = makeRouter();
  const load = vi.fn<(href: string) => void>();
  loadFailedPagesInFull(router, load);

  await router.push('/privacy').catch(() => undefined);

  expect(load).not.toHaveBeenCalled();
});
