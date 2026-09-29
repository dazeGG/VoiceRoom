// The service worker shows a push only when no window is being looked at, and
// a click opens its target on this site only, reusing an open window.

import { beforeEach, expect, test, vi } from 'vitest';
import { freshImport } from '../helpers/fresh-module.ts';

type Handler = (event: Record<string, unknown>) => void;
type FakeWindow = {
  url: string;
  visibilityState: string;
  focused: boolean;
  navigate: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
};

const ORIGIN = 'https://voiceroom.ru';
let handlers: Record<string, Handler>;
let windows: FakeWindow[];
let showNotification: ReturnType<typeof vi.fn>;
let openWindow: ReturnType<typeof vi.fn>;

function fakeWindow(extra: Partial<FakeWindow> = {}): FakeWindow {
  return {
    url: `${ORIGIN}/`,
    visibilityState: 'hidden',
    focused: false,
    navigate: vi.fn(async () => {}),
    focus: vi.fn(async () => {}),
    ...extra
  };
}

beforeEach(async () => {
  handlers = {};
  windows = [];
  showNotification = vi.fn(async () => {});
  openWindow = vi.fn(async () => null);
  vi.stubGlobal('self', {
    navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32', maxTouchPoints: 0 },
    location: { origin: ORIGIN },
    addEventListener: (type: string, handler: Handler) => {
      handlers[type] = handler;
    },
    clients: { matchAll: async () => windows, openWindow },
    registration: { showNotification }
  });
  await freshImport('/src/service-worker.ts');
});

async function fire(type: string, event: Record<string, unknown>): Promise<void> {
  let done: Promise<unknown> = Promise.resolve();
  handlers[type]({ ...event, waitUntil: (promise: Promise<unknown>) => (done = promise) });
  await done;
}

const push = (payload: unknown) => fire('push', { data: { json: () => payload, text: () => '' } });

test('a push is shown while no window is in front, and suppressed for a focused visible one', async () => {
  windows = [fakeWindow({ visibilityState: 'visible', focused: false })];
  await push({ title: 'Ада', body: 'привет', url: '/?dm=ada', tag: 'dm:ada' });
  const [title, options] = showNotification.mock.calls[0] as [
    string,
    Omit<NotificationOptions, 'data'> & { data: { url: string } }
  ];
  expect([title, options.body, options.tag, options.data.url]).toEqual(['Ада', 'привет', 'dm:ada', '/?dm=ada']);

  showNotification.mockClear();
  windows = [fakeWindow({ visibilityState: 'visible', focused: true })];
  await push({ title: 'Ада', body: 'ещё' });
  expect(showNotification).not.toHaveBeenCalled();
});

test('an expired push is dropped', async () => {
  await push({ title: 'Звонок', expiresAt: Date.now() - 1 });
  expect(showNotification).not.toHaveBeenCalled();
});

test('a click opens a same-site target in an open window, and never another site', async () => {
  const open = fakeWindow();
  windows = [open];
  const close = vi.fn();
  await fire('notificationclick', { notification: { close, data: { url: '/?room=r1&message=m1' } } });
  expect(close).toHaveBeenCalled();
  expect(open.navigate).toHaveBeenCalledWith(`${ORIGIN}/?room=r1&message=m1`);
  expect(open.focus).toHaveBeenCalled();

  windows = [];
  await fire('notificationclick', { notification: { close, data: { url: 'https://evil.example/phish' } } });
  expect(openWindow).toHaveBeenCalledWith(`${ORIGIN}/`);
});
