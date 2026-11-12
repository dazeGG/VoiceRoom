// The shell around every page (routes/+layout.svelte in apps/web): a phone
// gets only the routes it may open, everything else keeps the block screen;
// a desktop gets every route and the update notice once a new build is out.

import { render, screen } from '@testing-library/vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory } from 'vue-router';
import { beforeEach, expect, test, vi } from 'vitest';
import type { PlatformPolicy } from '@voice-room/shared/platform-class';
import App from '../../src/App.vue';
import { useAppUpdateStore } from '../../src/features/app-update/app-update.store.ts';
import { useCallActivityStore } from '../../src/shared/call-activity.store.ts';
import { createAppRouter } from '../../src/router.ts';
import type * as DesktopBoundary from '../../src/platform/desktop-boundary.ts';
import { stubFetch } from '../fixtures/fetch.ts';

const platform = vi.hoisted(() => ({ desktop: true }));
const captureTelemetry = vi.hoisted(() => ({ noteWakeUnlock: vi.fn() }));

vi.mock('../../src/features/room/client/room/capture-diagnostics.ts', () => captureTelemetry);

vi.mock('../../src/platform/desktop-boundary.ts', async (importOriginal) => {
  const original = await importOriginal<typeof DesktopBoundary>();
  const policy = (): PlatformPolicy => ({
    contractVersion: 'voice-room.platform-class/v1',
    platformClass: platform.desktop ? 'desktop' : 'mobile',
    desktopAllowed: platform.desktop,
    roomClientAllowed: true
  });
  return { ...original, applyDesktopBoundaryToDocument: policy, getDesktopBoundaryPolicy: policy };
});

let fetched: ReturnType<typeof stubFetch>;

beforeEach(() => {
  platform.desktop = true;
  captureTelemetry.noteWakeUnlock.mockClear();
  fetched = stubFetch({ 'GET /api/badges': { body: { ok: true, badges: [] } } });
});

async function openApp(path: string) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createAppRouter(createMemoryHistory());
  await router.push(path);
  await router.isReady();
  render(App, { global: { plugins: [pinia, router] } });
  return { router, pinia };
}

test('a phone reads the legal pages', async () => {
  platform.desktop = false;
  await openApp('/terms');
  expect(await screen.findByRole('heading', { level: 1, name: 'Пользовательское соглашение' })).toBeTruthy();
  expect(screen.queryByText('Откройте VoiceRoom на компьютере')).toBeNull();
});

test('a phone opening an account page gets the block screen, not the page', async () => {
  platform.desktop = false;
  await openApp('/login');
  expect(await screen.findByRole('heading', { name: 'Откройте VoiceRoom на компьютере' })).toBeTruthy();
  expect(screen.getByRole('main', { name: 'Неподдерживаемое устройство' })).toBeTruthy();
  // Behind the block screen nothing talks to the API.
  expect(fetched.calls).toEqual([]);
});

test('a desktop loads the account marks', async () => {
  await openApp('/licenses');
  await vi.waitFor(() => expect(fetched.calls.map((call) => call.url)).toEqual(['/api/badges']));
});

test('a phone following a link off a mobile route gets the block screen there', async () => {
  platform.desktop = false;
  const { router } = await openApp('/privacy');
  expect(await screen.findByRole('heading', { level: 1, name: 'Политика обработки персональных данных' })).toBeTruthy();
  await router.push('/register');
  expect(await screen.findByRole('heading', { name: 'Откройте VoiceRoom на компьютере' })).toBeTruthy();
});

test('an unknown address shows the not-found page on a desktop', async () => {
  await openApp('/no/such/page');
  expect(await screen.findByRole('heading', { name: '404' })).toBeTruthy();
  expect(screen.getByText('Not Found')).toBeTruthy();
});

test('a desktop gets the update notice once a new build is seen', async () => {
  const { pinia } = await openApp('/licenses');
  expect(await screen.findByRole('heading', { level: 1, name: 'Лицензии' })).toBeTruthy();
  expect(screen.queryByText('Доступно обновление')).toBeNull();

  useAppUpdateStore(pinia).configure({ webUpdated: true });
  expect(await screen.findByText('Доступно обновление')).toBeTruthy();
});

test('the existing desktop wake hook forwards capture diagnostics only during a call', async () => {
  let wake = (_payload: unknown): void => {};
  vi.stubGlobal('voiceRoomDesktopSystem', {
    onWake(listener: (payload: unknown) => void) {
      wake = listener;
      return () => {};
    }
  });
  const { pinia } = await openApp('/licenses');
  wake({ reason: 'resume' });
  await Promise.resolve();
  expect(captureTelemetry.noteWakeUnlock).not.toHaveBeenCalled();

  useCallActivityStore(pinia).active = true;
  wake({ reason: 'unlock-screen' });
  await vi.waitFor(() => expect(captureTelemetry.noteWakeUnlock).toHaveBeenCalledWith('unlock-screen'));
});
