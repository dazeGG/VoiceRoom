// The portrait-phone media query is followed while the store lives and released with it.

import { createPinia, setActivePinia } from 'pinia';
import { expect, test, vi } from 'vitest';
import { usePageStore } from '@/stores/page.store';
import { PORTRAIT_PHONE_QUERY, useMobileCallUiStore } from '@/features/room/mobile-call-ui.store';

test('the change listener on the portrait-phone query is removed when the store is disposed', () => {
  const added: unknown[] = [];
  const removed: unknown[] = [];
  vi.stubGlobal('matchMedia', (media: string) => ({
    matches: media === PORTRAIT_PHONE_QUERY,
    media,
    addEventListener: (_type: string, listener: unknown) => added.push(listener),
    removeEventListener: (_type: string, listener: unknown) => removed.push(listener)
  }));
  setActivePinia(createPinia());
  const store = useMobileCallUiStore();

  usePageStore().screen = 'room';
  store.enabled = true;
  expect(store.isMobileCallActive()).toBe(true);
  expect(added).toHaveLength(1);
  store.$dispose();
  expect(removed).toEqual(added);
});
