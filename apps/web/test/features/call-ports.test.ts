import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, expect, onTestFinished, test, vi } from 'vitest';
import type { CallFeedbackCall } from '@voice-room/shared/contracts/feedback';
import type { CallIdentity, CallPageState, CallPorts } from '@/features/room/client/ports';
import { authUser } from '../fixtures/users';
import { lobbyRoom, roomStatus } from '../fixtures/answers';
import { stubFetch } from '../fixtures/fetch';
import { installFakeWebSocket } from '../fixtures/fake-websocket';

vi.mock('@/features/room/client/ui/devices', async (original) => ({
  ...(await original<object>()),
  refreshDevices: vi.fn(async () => {})
}));
vi.mock('@/features/room/client/services/microphone-service', async (original) => ({
  ...(await original<object>()),
  openLocalMicrophone: vi.fn(async () => null)
}));
vi.mock('@/features/room/client/services/livekit-service', async (original) => ({
  ...(await original<object>()),
  connectLiveKitRoom: vi.fn(async () => true),
  syncRemoteVideoVisibility: vi.fn()
}));
vi.mock('@/features/room/client/ui/toast', () => ({ showToast: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
  document.body.className = '';
  setActivePinia(createPinia());
  installFakeWebSocket();
});

afterEach(async () => {
  const { getAppRealtime } = await import('@/api/realtime');
  // Releasing the final subscription closes transport timers even for leave-only fixtures.
  getAppRealtime().subscribe(() => {})();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fakePorts(identity: CallIdentity = { kind: 'guest', profile: null, feedbackGuestId: 'feedback-guest' }) {
  const page: CallPageState = {
    screen: '',
    screenView: false,
    stripCollapsed: false,
    stageSummary: '',
    desktopScreenFullscreen: false
  };
  const feedbackEvents: Array<'drop' | 'offer' | CallFeedbackCall | null> = [];
  const listeners = new Set<(visible: boolean) => void>();
  const hostEntered = vi.fn();
  const goHome = vi.fn();
  const ports: CallPorts = {
    identity: {
      current: () => identity,
      verifyEntry: vi.fn(async () => ({ identity, isCurrent: () => true }))
    },
    host: { entered: hostEntered },
    feedback: {
      drop: () => feedbackEvents.push('drop'),
      finished: (call) => feedbackEvents.push(call),
      offer: () => feedbackEvents.push('offer')
    },
    platform: {
      policy: () => ({ roomClientAllowed: true, desktopAllowed: true, platformClass: 'desktop' }),
      isVisible: () => true,
      onVisibilityChange: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      prepareRoomNavigation: vi.fn(),
      navigateToRoom: vi.fn(),
      goHome,
      page: {
        read: () => page,
        patch: (patch) => Object.assign(page, patch)
      }
    }
  };
  return { ports, page, feedbackEvents, listeners, hostEntered, goHome };
}

async function installFake(identity?: CallIdentity) {
  const fixture = fakePorts(identity);
  const { installCallPorts } = await import('@/features/room/client/ports');
  onTestFinished(installCallPorts(fixture.ports));
  return fixture;
}

test('binding fails precisely before installation and releases only its own installed ports', async () => {
  const { getCallPorts, installCallPorts } = await import('@/features/room/client/ports');
  const missing = 'Call ports are not installed. Install call ports before invoking room runtime actions.';
  expect(getCallPorts).toThrow(missing);
  const first = fakePorts();
  const second = fakePorts();
  const releaseFirst = installCallPorts(first.ports);
  expect(getCallPorts()).toBe(first.ports);
  const releaseSecond = installCallPorts(second.ports);
  releaseFirst();
  expect(getCallPorts()).toBe(second.ports);
  releaseSecond();
  expect(getCallPorts).toThrow(missing);
});

test('public runtime exports import before installation and later actions observe the current binding', async () => {
  const { getCallPorts } = await import('@/features/room/client/ports');
  const runtime = await import('@/features/room/client/index');
  expect(getCallPorts).toThrow('Call ports are not installed.');
  const first = await installFake();
  expect(runtime.setMicrophoneMode('push-to-talk')).toBe('push-to-talk');
  const { showStartScreen } = await import('@/features/room/client/room/room');
  showStartScreen();
  expect(first.page.screen).toBe('start');
  const second = await installFake();
  first.page.screen = 'checking';
  showStartScreen();
  expect(second.page.screen).toBe('start');
  expect(first.page.screen).toBe('checking');
});

test('guest-only ports prompt for a name and join with transport fixtures without account or feedback stores', async () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const fixture = await installFake();
  installFakeWebSocket();
  const fetch = stubFetch({ '/api/rooms/abc123': { body: roomStatus({ roomId: 'abc123' }) } });
  const room = await import('@/features/room/client/room/room');
  const { state } = await import('@/features/room/client/core/room-runtime.store');
  const { useGuestNameUiStore } = await import('@/features/room/guest-name-ui.store');
  const { handleGuestNameSubmit } = await import('@/features/room/client/ui/names');
  Object.assign(state, { roomId: 'abc123', peerId: 'peer-1', sessionToken: 'session-1' });
  onTestFinished(() => room.leaveRoom());

  const entering = room.showRoomRoute();
  const name = useGuestNameUiStore();
  await vi.waitFor(() => expect(name.open).toBe(true));
  name.inputValue = 'Portable guest';
  handleGuestNameSubmit(new Event('submit'));
  await expect(entering).resolves.toBe(true);
  await room.joinRoom();

  expect(state.joined).toBe(true);
  expect(state.self?.name).toBe('Portable guest');
  expect(fixture.hostEntered).not.toHaveBeenCalled();
  expect(fixture.feedbackEvents).toEqual(['drop']);
  expect(Object.keys(pinia.state.value)).not.toContain('session');
  expect(Object.keys(pinia.state.value)).not.toContain('call-feedback');
  expect(fetch.calls.filter((call) => call.url !== '/api/client-logs').map((call) => call.url)).toEqual([
    '/api/rooms/abc123'
  ]);
  expect(fixture.listeners.size).toBe(1);
  room.leaveRoom();
  expect(fixture.listeners.size).toBe(0);
});

test('production adapter captures its Pinia and maps all five page fields to body classes', async () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const { createWebCallPorts } = await import('@/features/room/adapters/web-call-ports');
  const { useSessionStore } = await import('@/features/auth/session.store');
  const { usePageStore, installBodyClasses } = await import('@/stores/page.store');
  const { installCallPorts } = await import('@/features/room/client/ports');
  const ports = createWebCallPorts(pinia);
  const session = useSessionStore(pinia);
  session.setUser(authUser({ displayName: 'Captured account' }));
  onTestFinished(installCallPorts(ports));
  onTestFinished(installBodyClasses());
  const other = createPinia();
  setActivePinia(other);
  useSessionStore(other).setUser(null);
  expect(ports.identity.current().profile?.displayName).toBe('Captured account');

  const { showStartScreen } = await import('@/features/room/client/room/room');
  showStartScreen();
  ports.platform.page.patch({
    screenView: true,
    stripCollapsed: true,
    stageSummary: 'hidden',
    desktopScreenFullscreen: true
  });
  expect(ports.platform.page.read()).toMatchObject({
    screen: 'start',
    screenView: true,
    stripCollapsed: true,
    stageSummary: 'hidden',
    desktopScreenFullscreen: true
  });
  expect([...document.body.classList]).toEqual(
    expect.arrayContaining([
      'screen--start',
      'screen-view--open',
      'strip--collapsed',
      'stage-summary--hidden',
      'screen--desktop-fullscreen'
    ])
  );
  expect(usePageStore(pinia).screen).toBe('start');
  expect(usePageStore(other).screen).toBe('');
  ports.platform.page.patch({
    screen: '',
    screenView: false,
    stripCollapsed: false,
    stageSummary: '',
    desktopScreenFullscreen: false
  });
  expect(document.body.className).toBe('');
});

test('embedded cached account entry persists its name and starts host effects synchronously', async () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const { createWebCallPorts } = await import('@/features/room/adapters/web-call-ports');
  const { installCallPorts } = await import('@/features/room/client/ports');
  const { useSessionStore } = await import('@/features/auth/session.store');
  const { setRoomEmbedded } = await import('@/features/room/client/core/embed');
  const { state } = await import('@/features/room/client/core/room-runtime.store');
  const { resolveRoomEntryName } = await import('@/features/room/client/room/room-entry');
  const fetch = stubFetch({
    'POST /api/auth/rooms': { body: { ok: true, room: lobbyRoom() } },
    '/api/auth/rooms': { body: { ok: true, rooms: [] } }
  });
  useSessionStore(pinia).setUser(authUser({ displayName: 'Cached account' }));
  localStorage.removeItem('voice-room:name');
  setRoomEmbedded(true);
  Object.assign(state, { roomId: 'abc123', roomIsStatic: true });
  onTestFinished(installCallPorts(createWebCallPorts(pinia)));

  const entering = resolveRoomEntryName();
  expect(localStorage.getItem('voice-room:name')).toBe('Cached account');
  expect(fetch.calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
    'POST /api/auth/rooms',
    'GET /api/auth/rooms'
  ]);
  await expect(entering).resolves.toBe('authenticated');
});

test('production visibility combines browser and desktop visibility and unsubscribes its listener', async () => {
  const { createWebCallPorts } = await import('@/features/room/adapters/web-call-ports');
  const { setDesktopWindowVisible } = await import('@/platform/app-visibility');
  const platform = createWebCallPorts(createPinia()).platform;
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const listener = vi.fn();
  const unsubscribe = platform.onVisibilityChange(listener);
  onTestFinished(unsubscribe);
  expect(platform.isVisible()).toBe(true);
  setDesktopWindowVisible(false);
  expect(platform.isVisible()).toBe(false);
  setDesktopWindowVisible(true);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  expect(platform.isVisible()).toBe(false);
  expect(listener.mock.calls).toEqual([[false], [true], [false]]);
  unsubscribe();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  document.dispatchEvent(new Event('visibilitychange'));
  expect(platform.isVisible()).toBe(true);
  expect(listener).toHaveBeenCalledTimes(3);
});

test.each([
  ['mobile', true, false],
  ['mobile', false, false],
  ['desktop', true, true],
  ['desktop', false, true],
  ['unknown', true, true],
  ['unknown', false, true]
] as const)(
  'hidden microphone recovery uses %s class, independently of desktopAllowed=%s',
  async (platformClass, desktopAllowed, expected) => {
    const { ports } = await installFake();
    ports.platform.policy = () => ({ roomClientAllowed: true, desktopAllowed, platformClass });
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Chrome/130.0.0.0');
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const { canRecoverMic } = await import('@/features/room/client/room/mic-send');
    expect(canRecoverMic()).toBe(expected);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    expect(canRecoverMic()).toBe(true);
  }
);

test.each(['guest', 'account'] as const)(
  'connected %s feedback keeps drop, finished, offer order and clamps its payload',
  async (kind) => {
    const identity: CallIdentity =
      kind === 'guest'
        ? { kind, profile: null, feedbackGuestId: 'feedback-only-id' }
        : { kind, profile: { displayName: 'Account', avatarAccent: '', avatarColorKey: '', avatarUrl: '' } };
    const fixture = await installFake(identity);
    installFakeWebSocket();
    stubFetch({ '/api/rooms/abc123': { body: roomStatus({ roomId: 'abc123' }) } });
    const { CALL_FEEDBACK_MAX_DURATION_S } = await import('@voice-room/shared/contracts/feedback');
    const room = await import('@/features/room/client/room/room');
    const { state } = await import('@/features/room/client/core/room-runtime.store');
    const quality = await import('@/features/room/client/room/call-quality');
    const { setRoomEmbedded, setRoomShell } = await import('@/features/room/client/core/embed');
    const shell = { roomLeft: vi.fn(), roomsChanged: vi.fn() };
    setRoomEmbedded(true);
    setRoomShell(shell);
    Object.assign(state, { roomId: 'abc123', peerId: 'peer-1', sessionToken: 'session-1' });
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await room.joinRoom();
    quality.recordPeerCount(2);
    quality.recordNetworkSample({ rttMs: 40, jitterMs: 3, inboundLossPct: 1, outboundLossPct: 2, transport: 'udp' });
    now.mockReturnValue(1_000_000 + (CALL_FEEDBACK_MAX_DURATION_S + 60) * 1000);
    await room.handleLeaveButtonClick();
    expect(fixture.feedbackEvents).toHaveLength(3);
    expect(fixture.feedbackEvents[0]).toBe('drop');
    expect(fixture.feedbackEvents[1]).toMatchObject({
      roomId: 'abc123',
      durationS: CALL_FEEDBACK_MAX_DURATION_S,
      peers: 2,
      platform: 'browser',
      quality: {
        jitterAvgMs: 3,
        jitterMaxMs: 3,
        rttMaxMs: 40,
        inboundLossMaxPct: 1,
        outboundLossMaxPct: 2,
        transport: 'udp'
      }
    });
    if (kind === 'guest') expect(fixture.feedbackEvents[1]).toHaveProperty('guestId', 'feedback-only-id');
    else expect(fixture.feedbackEvents[1]).not.toHaveProperty('guestId');
    expect(fixture.feedbackEvents[2]).toBe('offer');
    expect(shell.roomLeft).toHaveBeenCalledExactlyOnceWith('abc123');
    expect(fixture.listeners.size).toBe(0);
  }
);

test('connecting leave finishes null before offering while idle leave does not offer feedback', async () => {
  const fixture = await installFake();
  const room = await import('@/features/room/client/room/room');
  const { state } = await import('@/features/room/client/core/room-runtime.store');
  const { setRoomEmbedded } = await import('@/features/room/client/core/embed');
  setRoomEmbedded(true);
  state.roomId = 'abc123';
  await room.handleLeaveButtonClick();
  expect(fixture.feedbackEvents).toEqual([]);
  state.connecting = true;
  await room.handleLeaveButtonClick();
  expect(fixture.feedbackEvents).toEqual([null, 'offer']);
});

test('signed-in rejoin marks navigation before the leave cue and assigns the room only after teardown', async () => {
  const fixture = await installFake();
  const room = await import('@/features/room/client/room/room');
  const { state } = await import('@/features/room/client/core/room-runtime.store');
  const actions: string[] = [];
  fixture.ports.platform.prepareRoomNavigation = () => actions.push('prepare');
  fixture.ports.feedback.finished = () => actions.push('finished');
  fixture.ports.platform.navigateToRoom = (roomId, method) => {
    expect(state.connecting).toBe(false);
    actions.push(`${method}:${roomId}`);
  };
  state.roomId = 'abc123';
  state.connecting = true;
  const rejoining = room.rejoinRoomSignedIn('next room');
  expect(actions).toEqual(['prepare']);
  expect(state.connecting).toBe(true);
  await rejoining;
  expect(actions).toEqual(['prepare', 'finished', 'assign:next room']);
});

test.each([
  ['guest', true, true],
  ['account', false, true],
  ['account', true, false]
] as const)(
  'standalone %s leave with desktopAllowed=%s preserves leave-screen versus home navigation',
  async (kind, desktopAllowed, leaveScreen) => {
    const identity: CallIdentity =
      kind === 'guest'
        ? { kind, profile: null }
        : { kind, profile: { displayName: 'Account', avatarAccent: '', avatarColorKey: '', avatarUrl: '' } };
    const fixture = await installFake(identity);
    fixture.ports.platform.policy = () => ({ roomClientAllowed: true, desktopAllowed, platformClass: 'unknown' });
    const room = await import('@/features/room/client/room/room');
    const { state } = await import('@/features/room/client/core/room-runtime.store');
    const { useLeaveScreenStore } = await import('@/features/room/leave-screen.store');
    Object.assign(state, { roomId: 'abc123', roomIsStatic: true });
    await room.handleLeaveButtonClick();
    expect(useLeaveScreenStore().open).toBe(leaveScreen);
    if (leaveScreen) {
      expect(useLeaveScreenStore()).toMatchObject({ roomId: 'abc123', isStatic: true, guest: kind === 'guest' });
      expect(fixture.goHome).not.toHaveBeenCalled();
    } else {
      expect(fixture.goHome).toHaveBeenCalledOnce();
    }
    expect(fixture.feedbackEvents).toEqual([]);
  }
);
