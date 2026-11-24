// The service worker shows a push only when no window is being looked at, and
// a click opens its target on this site only, reusing an open window.

import { beforeEach, expect, test, vi, type Mock } from 'vitest';
import { buildProviderPayload, callPushTag, type CallPushPayload } from '@voiceroom/shared/notifications';
import { freshImport } from '../helpers/fresh-module.ts';
import { defined } from '../helpers/assert.ts';

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
let showNotification: Mock<(title: string, options: NotificationOptions) => Promise<void>>;
let openWindow: ReturnType<typeof vi.fn>;
let getNotifications: Mock<(options?: { tag?: string }) => Promise<Array<{ tag: string; close(): void }>>>;
let workerNavigator: { userAgent: string; platform: string; maxTouchPoints: number };
const callId = '5acc9260-4005-4551-84ef-006e7d7f848b';

function callPush(type: CallPushPayload['type'], attempt: number, revision: number): CallPushPayload {
  const tag = callPushTag(callId, type === 'call.missed' ? 'missed' : attempt);
  return {
    type,
    attempt,
    revision,
    tag,
    callId,
    contractVersion: 1,
    expiresAt: Date.now() + 45_000,
    dedupeKey: `${tag}:${revision}`,
    url: '/?dm=ada'
  };
}

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
  showNotification = vi.fn<(title: string, options: NotificationOptions) => Promise<void>>(async () => {});
  openWindow = vi.fn(async () => null);
  getNotifications = vi.fn(async () => []);
  workerNavigator = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    platform: 'Win32',
    maxTouchPoints: 0
  };
  const cache = new Map<string, Response>();
  vi.stubGlobal('self', {
    navigator: workerNavigator,
    location: { origin: ORIGIN },
    addEventListener: (type: string, handler: Handler) => {
      handlers[type] = handler;
    },
    clients: { matchAll: async () => windows, openWindow },
    registration: { showNotification, getNotifications },
    caches: {
      open: async () => ({
        match: async (key: string) => cache.get(key)?.clone(),
        put: async (key: string, response: Response) => {
          cache.set(key, response);
        }
      })
    }
  });
  await freshImport(() => import('../../src/service-worker.ts'));
});

async function fire(type: string, event: Record<string, unknown>): Promise<void> {
  let done: Promise<unknown> = Promise.resolve();
  defined(handlers[type], 'handlers[type]')({ ...event, waitUntil: (promise: Promise<unknown>) => (done = promise) });
  await done;
}

// NotificationOptions types its data as any; read it as unknown.
const dataOf = (options: { data?: unknown }): unknown => options.data;

const push = (payload: unknown) => fire('push', { data: { json: () => payload, text: () => '' } });

test('a push is shown while no window is in front, and suppressed for a focused visible one', async () => {
  windows = [fakeWindow({ visibilityState: 'visible', focused: false })];
  await push({ title: 'Ада', body: 'привет', url: '/?dm=ada', tag: 'dm:ada' });
  const [title, options] = defined(showNotification.mock.calls[0], 'shown notification');
  const data = dataOf(options);
  expect([title, options.body, options.tag]).toEqual(['Ада', 'привет', 'dm:ada']);
  expect(data).toHaveProperty('url', '/?dm=ada');

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

test('a mention push from the API opens its room and message when clicked', async () => {
  const payload = buildProviderPayload({
    id: 'n1',
    roomId: 'r1',
    sourceMessageId: 'm1',
    actorUserId: 'u1',
    reasons: ['mention'],
    revision: 2,
    body: '@ada hi'
  });
  await push(JSON.parse(JSON.stringify(payload)));
  const shownOptions: { data?: unknown } | undefined = showNotification.mock.lastCall?.[1];
  const shown = shownOptions?.data;

  const open = fakeWindow();
  windows = [open];
  await fire('notificationclick', { notification: { close: vi.fn(), data: shown } });
  expect(open.navigate).toHaveBeenCalledWith(`${ORIGIN}/?room=r1&message=m1`);
});

test('a dismissal closes the current tag even when focused and prevents replay after worker restart', async () => {
  await push(callPush('call.incoming', 1, 1));
  expect(showNotification).toHaveBeenCalledOnce();
  const close = vi.fn();
  getNotifications.mockResolvedValueOnce([{ tag: callPushTag(callId, 1), close }]);
  windows = [fakeWindow({ visibilityState: 'visible', focused: true })];
  await push(callPush('call.state', 1, 3));
  expect(close).toHaveBeenCalledOnce();
  expect(getNotifications).toHaveBeenLastCalledWith({ tag: callPushTag(callId, 1) });

  windows = [];
  await freshImport(() => import('../../src/service-worker.ts'));
  await push(callPush('call.incoming', 1, 2));
  await push({ ...callPush('call.incoming', 2, 4), expiresAt: Date.now() });
  await push({ ...callPush('call.incoming', 2, 4), contractVersion: 2 });
  expect(showNotification).toHaveBeenCalledOnce();
  await push(callPush('call.incoming', 2, 4));
  expect(showNotification).toHaveBeenCalledTimes(2);
});

test('missed and incoming use different tags and a later connection retracts the miss', async () => {
  const missed = callPush('call.missed', 1, 2);
  await push(callPush('call.state', 1, 2));
  await push(missed);
  await push(missed);
  expect(showNotification).toHaveBeenCalledOnce();
  const close = vi.fn();
  getNotifications.mockImplementation(async (filter) =>
    filter?.tag === missed.tag ? [{ tag: missed.tag, close }] : []
  );
  await push({ ...callPush('call.state', 2, 5), dismissMissed: true });
  await push(missed);
  expect(close).toHaveBeenCalledOnce();
  expect(showNotification).toHaveBeenCalledOnce();
});

test('a newer attempt dismissal fences an older incoming push and mobile browsers stay quiet', async () => {
  await push(callPush('call.state', 2, 6));
  await push(callPush('call.incoming', 1, 1));
  expect(showNotification).not.toHaveBeenCalled();

  workerNavigator.userAgent = 'Mozilla/5.0 (Linux; Android 15) Mobile';
  await push(callPush('call.incoming', 3, 7));
  expect(showNotification).not.toHaveBeenCalled();
});

test('call clicks open only the DM and private calls look up the peer even after push expiry', async () => {
  await push(callPush('call.incoming', 1, 1));
  const shown = showNotification.mock.lastCall?.[1];
  await fire('notificationclick', { notification: { close: vi.fn(), data: shown && dataOf(shown) } });
  expect(openWindow).toHaveBeenLastCalledWith(`${ORIGIN}/?dm=ada`);

  const fetchTarget = vi.fn(async () => Response.json({ ok: true, peerUserId: 'private-peer' }));
  vi.stubGlobal('fetch', fetchTarget);
  const privateCall = { ...callPush('call.missed', 1, 2), url: `/?call=${callId}`, expiresAt: Date.now() - 1 };
  const click = (data: CallPushPayload) => fire('notificationclick', { notification: { close: vi.fn(), data } });
  await click(privateCall);
  expect(fetchTarget).toHaveBeenCalledWith(`/api/call-rings/notification/${callId}`, { cache: 'no-store' });
  expect(openWindow).toHaveBeenLastCalledWith(`${ORIGIN}/?dm=private-peer`);
  await click({ ...privateCall, url: '/r/private-room' });
  expect(openWindow).toHaveBeenLastCalledWith(`${ORIGIN}/`);
  fetchTarget.mockRejectedValueOnce(new Error('offline'));
  await click(privateCall);
  expect(openWindow).toHaveBeenLastCalledWith(`${ORIGIN}/`);
});
