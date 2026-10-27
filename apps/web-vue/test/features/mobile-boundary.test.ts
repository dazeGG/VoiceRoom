// What a phone may do: open a room link and join it as a guest, never the
// desktop lobby, and open the realtime socket only while that room is mounted.

import { afterEach, expect, test, vi } from 'vitest';
import { installFakeWebSocket, FakeWebSocket } from '../fixtures/fake-websocket.ts';
import { freshImport } from '../helpers/fresh-module.ts';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';
const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0 Safari/537.36';

function useDevice(userAgent: string, maxTouchPoints = 0) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: maxTouchPoints });
}

async function load() {
  installFakeWebSocket();
  const boundary = await freshImport(() => import('../../src/platform/desktop-boundary.ts'));
  const realtime = await import('../../src/api/realtime.ts');
  return { boundary, realtime };
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'maxTouchPoints');
  document.documentElement.className = '';
});

test('a desktop browser gets everything', async () => {
  useDevice(WINDOWS);
  const { boundary } = await load();
  const policy = boundary.applyDesktopBoundaryToDocument();
  expect(policy).toMatchObject({ desktopAllowed: true, roomClientAllowed: true });
  expect(document.documentElement.classList.contains('desktop-boundary--allowed')).toBe(true);
  expect(document.documentElement.classList.contains('platform--desktop')).toBe(true);
  expect(boundary.isRealtimeBlocked()).toBe(false);
});

test('a phone may use the room client but not the desktop screens, and the page is marked mobile', async () => {
  useDevice(IPHONE, 5);
  const { boundary } = await load();
  const policy = boundary.applyDesktopBoundaryToDocument();
  expect(policy).toMatchObject({ desktopAllowed: false, roomClientAllowed: true });
  expect(document.documentElement.classList.contains('platform--mobile')).toBe(true);
  expect(document.documentElement.classList.contains('desktop-boundary--blocked')).toBe(true);
  expect(document.documentElement.classList.contains('platform--desktop')).toBe(false);
  expect(document.body.dataset.platformClass).toBeUndefined();
});

test('on a phone the realtime socket opens only while a room page is mounted', async () => {
  useDevice(IPHONE, 5);
  const { boundary, realtime } = await load();
  expect(boundary.isRealtimeBlocked()).toBe(true);
  const unsubscribeBlocked = realtime.getAppRealtime().subscribe(() => {});
  expect(FakeWebSocket.instances).toHaveLength(0);
  unsubscribeBlocked();

  boundary.setRoomRouteActive(true);
  expect(boundary.isRealtimeBlocked()).toBe(false);
  const unsubscribe = realtime.getAppRealtime().subscribe(() => {});
  expect(FakeWebSocket.instances).toHaveLength(1);
  unsubscribe();
  boundary.setRoomRouteActive(false);
});
