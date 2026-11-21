import { webcrypto } from 'node:crypto';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { nextTick } from 'vue';
import { callPageState } from '@voiceroom/call/engine/core/call-page.store';
import { state } from '@voiceroom/call/engine/core/room-runtime.store';
import { mountGuestRoomClient } from '@voiceroom/call/engine/main';
import { joinRoom } from '@voiceroom/call/engine/room/room';
import type { RoomCapabilities } from '@voiceroom/shared/contracts/rooms';
import type { ServerFrame } from '@voiceroom/shared/contracts/realtime';
import { buildServerEnvelope, parseClientEnvelope } from '@voiceroom/shared/realtime';
import { createWidgetSession } from '../src/session';

vi.mock('@voiceroom/call/engine/main', () => ({ mountGuestRoomClient: vi.fn() }));
vi.mock('@voiceroom/call/engine/room/room', () => ({ joinRoom: vi.fn() }));

const roomId = 'roomCode';
const roomPath = `/api/widget/rooms/${roomId}`;
const tokenPath = '/api/widget/livekit-token';
const capabilities: RoomCapabilities = { camera: true, screenShare: false, chat: 'none', maxPeers: 8 };
const createdRoom = { ok: true, roomId, chat: false, maxRoomPeers: 8 };
const status = (camera = true) =>
  Response.json({ ...createdRoom, capabilities: { ...capabilities, camera }, peers: 0 });
const admissionResponse = (camera: boolean) =>
  Response.json({
    ok: true,
    gateCredentialId: 'gate-credential',
    room: 'media-room',
    token: 'media-token',
    ttlSeconds: 60,
    url: 'wss://gate.test',
    capabilities: { ...capabilities, camera }
  });
const unmount = vi.fn(() => {
  state.joined = false;
});
const sessions: ReturnType<typeof createWidgetSession>[] = [];
const sockets: FakeSocket[] = [];

class FakeSocket extends EventTarget {
  static OPEN = 1;
  static CLOSING = 2;
  readyState = FakeSocket.OPEN;
  send = vi.fn<(frame: string) => void>();

  constructor(readonly url: URL) {
    super();
    sockets.push(this);
  }

  receive(frame: ServerFrame) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(frame) }));
  }

  commands() {
    return this.send.mock.calls.flatMap(([serialized]) => {
      const decoded = parseClientEnvelope(serialized);
      return decoded.ok ? [decoded.envelope] : [];
    });
  }

  attachRoster(peer: { peerId: string; name: string }) {
    const request = this.commands().find(({ type }) => type === 'room.join');
    if (!request?.id) throw new Error('Missing correlatable room join request');
    this.receive(
      buildServerEnvelope(
        'room.snapshot',
        {
          roomId,
          mode: 'active',
          recentMessages: [],
          voiceActiveSince: 1,
          room: { roomId, avatarUrl: null, createdAt: 1, isStatic: false, name: '', peers: 1, relationship: 'member' },
          peers: [
            {
              id: peer.peerId,
              name: peer.name,
              serverMuted: false,
              accountUserId: '',
              avatarAccent: null,
              avatarColorKey: '',
              avatarUrl: null
            }
          ]
        },
        request.id
      )
    );
  }

  close(code = 1000, reason = '') {
    this.readyState = FakeSocket.CLOSING;
    this.dispatchEvent(new CloseEvent('close', { code, reason }));
  }
}

function setup(camera = true) {
  const setCallActive = vi.fn<(active: boolean) => void>();
  const session = createWidgetSession({ camera, setCallActive });
  sessions.push(session);
  return { session, setCallActive };
}

beforeEach(() => {
  vi.clearAllMocks();
  setActivePinia(createPinia());
  state.joined = false;
  state.serverConnection = 'idle';
  state.voiceConnection = 'idle';
  vi.mocked(mountGuestRoomClient).mockImplementation(() => {
    callPageState().screen = 'room';
    return unmount;
  });
  vi.mocked(joinRoom).mockImplementation(async () => {
    state.serverConnection = 'connected';
    state.voiceConnection = 'connected';
    state.joined = true;
  });
});

afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  sockets.length = 0;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('checks a typed code anonymously and lets an unnamed guest join without proof of work', async () => {
  const fetch = vi.fn(async () => status());
  vi.stubGlobal('fetch', fetch);
  const { session } = setup();

  session.entry.name = '   ';
  await session.join(`  ${roomId}  `);

  expect(fetch).toHaveBeenCalledExactlyOnceWith(
    roomPath,
    expect.objectContaining({ credentials: 'omit', method: 'GET' })
  );
  expect(mountGuestRoomClient).toHaveBeenCalledExactlyOnceWith(roomId, 'Гость', expect.any(Number));
  expect(session.entry).toMatchObject({ joined: true, roomId, cameraAllowed: true });
});

test('solves proof of work before anonymous room creation and joins with the submitted name', async () => {
  const proof = {
    ok: true,
    required: true,
    algorithm: 'sha256',
    challenge: 'widget-proof',
    difficulty: 0,
    expiresAt: Date.now() + 60_000
  };
  const fetch = vi.fn(async (path: string) => {
    if (path === '/api/pow-challenge') return Response.json(proof);
    if (path === '/api/widget/rooms') return Response.json(createdRoom);
    if (path === roomPath) return status();
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('crypto', webcrypto);
  const { session } = setup();

  session.entry.name = '  Ada   Lovelace  ';
  await session.create();

  expect(fetch).toHaveBeenNthCalledWith(
    1,
    '/api/pow-challenge',
    expect.objectContaining({ credentials: 'omit', method: 'GET' })
  );
  expect(fetch).toHaveBeenNthCalledWith(
    2,
    '/api/widget/rooms',
    expect.objectContaining({
      credentials: 'omit',
      method: 'POST',
      body: JSON.stringify({ chat: false, proof: { challenge: proof.challenge, nonce: 0 } })
    })
  );
  expect(mountGuestRoomClient).toHaveBeenCalledExactlyOnceWith(roomId, 'Ada Lovelace', expect.any(Number));
  expect(session.entry).toMatchObject({ roomId, joined: true });
});

test('leave before a status lookup resolves prevents a late entry', async () => {
  const lookup = Promise.withResolvers<Response>();
  const fetch = vi.fn(() => lookup.promise);
  vi.stubGlobal('fetch', fetch);
  const { session, setCallActive } = setup();

  const joining = session.join(roomId);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  session.leave();
  lookup.resolve(status());
  await joining;

  expect(mountGuestRoomClient).not.toHaveBeenCalled();
  expect(session.entry.joined).toBe(false);
  expect(setCallActive).not.toHaveBeenCalledWith(true);
});

test.each([
  { cameraInEmbed: false, cameraOnServer: true },
  { cameraInEmbed: true, cameraOnServer: false }
])(
  'keeps the engine media policy and controls off when the embed or server forbids camera (%j)',
  async ({ cameraInEmbed, cameraOnServer }) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => status(cameraOnServer))
    );
    const { session } = setup(cameraInEmbed);
    vi.mocked(joinRoom).mockImplementationOnce(async () => {
      expect(session.ports.mediaPolicy.camera).toBe(false);
      state.serverConnection = 'connected';
      state.voiceConnection = 'connected';
      state.joined = true;
    });

    await session.join(roomId);

    expect(session.entry).toMatchObject({ joined: true, cameraAllowed: false });
    expect(session.ports.mediaPolicy.camera).toBe(false);
  }
);

test('media waits for the active widget roster and obeys the narrower admission capability', async () => {
  const fetch = vi.fn(async (path: string) => {
    if (path === roomPath) return status();
    if (path === tokenPath) return admissionResponse(false);
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('WebSocket', FakeSocket);
  const { session } = setup();
  const { transport, identity, mediaPolicy } = session.ports;
  const membership = { ...identity.credentials(roomId), roomId, name: 'Ada' };
  vi.mocked(joinRoom).mockImplementationOnce(async () => {
    expect(mediaPolicy.camera).toBe(true);
    transport.realtime.join(membership);
    const socket = sockets[0];
    if (!socket) throw new Error('Missing widget socket');
    socket.receive(buildServerEnvelope('ready', { guest: true }));
    const admission = transport.requestLiveKitToken(membership);
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(1);
    socket.attachRoster(membership);

    expect(await admission).toMatchObject({ urls: ['wss://gate.test'], capabilities: { camera: false } });
    expect(mediaPolicy.camera).toBe(false);
    state.serverConnection = 'connected';
    state.voiceConnection = 'connected';
    state.joined = true;
  });

  session.entry.name = membership.name;
  await session.join(roomId);

  expect(fetch).toHaveBeenNthCalledWith(
    2,
    tokenPath,
    expect.objectContaining({
      credentials: 'omit',
      method: 'POST',
      body: JSON.stringify(membership)
    })
  );
  expect(session.entry).toMatchObject({ joined: true, cameraAllowed: false });
});

test.each(['abortable', 'late-response'] as const)(
  'cancels a pending %s media admission on socket replacement and accepts the fresh roster',
  async (responseKind) => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
    const admitted = Promise.withResolvers<AbortSignal>();
    const response = Promise.withResolvers<Response>();
    let tokenRequests = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, init: RequestInit) => {
        if (path !== tokenPath) throw new Error(`Unexpected request: ${path}`);
        tokenRequests += 1;
        if (tokenRequests > 1) return admissionResponse(true);
        const signal = init.signal;
        if (!signal) throw new Error('Missing cancellation signal');
        admitted.resolve(signal);
        if (responseKind === 'abortable') {
          signal.addEventListener('abort', () => response.reject(new DOMException('Cancelled', 'AbortError')), {
            once: true
          });
        }
        return response.promise;
      })
    );
    const { session } = setup();
    const { transport, identity } = session.ports;
    const membership = { ...identity.credentials(roomId), roomId, name: 'Ada' };
    transport.realtime.join(membership);
    const original = sockets[0];
    if (!original) throw new Error('Missing original widget socket');
    original.receive(buildServerEnvelope('ready', { guest: true }));
    original.attachRoster(membership);
    const firstAdmission = transport
      .requestLiveKitToken(membership)
      .catch((error: unknown) => transport.failure(error));
    const oldSignal = await admitted.promise;

    original.close();
    expect(oldSignal.aborted).toBe(true);
    if (responseKind === 'abortable') expect(await firstAdmission).toMatchObject({ code: 'not_in_room' });

    const secondAdmission = transport.requestLiveKitToken(membership);
    await vi.advanceTimersByTimeAsync(1_000);
    const replacement = sockets[1];
    if (!replacement) throw new Error('Missing replacement widget socket');
    replacement.receive(buildServerEnvelope('ready', { guest: true }));
    expect(tokenRequests).toBe(1);
    replacement.attachRoster(membership);
    expect(await secondAdmission).toMatchObject({ urls: ['wss://gate.test'] });
    expect(tokenRequests).toBe(2);
    if (responseKind === 'late-response') {
      response.resolve(admissionResponse(false));
      expect(await firstAdmission).toMatchObject({ code: 'not_in_room' });
    }
  }
);

test('uses independent, stable same-room credentials even when browser storage is unavailable', () => {
  const blocked = () => {
    throw new DOMException('Storage disabled', 'SecurityError');
  };
  vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(blocked);
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(blocked);
  const first = setup().session.ports.identity;
  const second = setup().session.ports.identity;

  const firstJoin = first.credentials(roomId);
  const secondJoin = second.credentials(roomId);
  expect(firstJoin.peerId).not.toBe(secondJoin.peerId);
  expect(firstJoin.sessionToken).not.toBe(secondJoin.sessionToken);
  expect(first.credentials(roomId)).toEqual(firstJoin);
  expect(second.credentials(roomId)).toEqual(secondJoin);
});

test('reconnecting keeps the frame in call until an explicit leave', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => status())
  );
  const { session } = setup();

  await session.join(roomId);
  expect(session.entry.joined).toBe(true);
  state.serverConnection = 'reconnecting';
  await nextTick();
  expect(session.entry.joined).toBe(true);
  expect(session.entry.status).toContain('Переподключение');

  session.leave();
  await nextTick();
  expect(session.entry.joined).toBe(false);
  expect(unmount).toHaveBeenCalledOnce();
});

test('operator recovery tears down the frame session without retrying admission', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => status())
  );
  const { session } = setup();

  await session.join(roomId);
  const { realtime } = session.ports.transport;
  realtime.join({ ...session.ports.identity.credentials(roomId), roomId, name: 'Гость' });
  const socket = sockets[0];
  if (!socket) throw new Error('Missing widget socket');
  socket.receive(buildServerEnvelope('ready', { guest: true }));
  socket.close(1008, 'Widget admission disabled');

  expect(unmount).toHaveBeenCalledOnce();
  expect(session.entry.joined).toBe(false);
  expect(session.entry.error).toBe('Комната недоступна или заполнена');
  await vi.advanceTimersByTimeAsync(45_000);
  expect(sockets).toHaveLength(1);
});

test('widget realtime keeps one frame identity through reconnect and owns heartbeats through leave', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeSocket);
  const { session } = setup();
  const { realtime } = session.ports.transport;
  const target = { ...session.ports.identity.credentials(roomId), roomId };
  realtime.join({ ...target, name: 'Ada' });
  const original = sockets[0];
  if (!original) throw new Error('Missing widget socket');
  expect(original.url.pathname).toBe('/api/widget/ws');
  original.receive(buildServerEnvelope('ready', { guest: true }));
  const join = original.commands().find(({ type }) => type === 'room.join');
  expect(join?.payload).toMatchObject({ ...target, name: 'Ada' });
  expect(typeof join?.payload.guestId).toBe('string');
  expect(typeof join?.payload.clientId).toBe('string');
  await vi.advanceTimersByTimeAsync(15_000);
  expect(original.commands()).toContainEqual(expect.objectContaining({ type: 'ping' }));

  original.close();
  await vi.advanceTimersByTimeAsync(1_000);
  const replacement = sockets[1];
  if (!replacement) throw new Error('Missing replacement socket');
  replacement.receive(buildServerEnvelope('ready', { guest: true }));
  expect(replacement.commands().find(({ type }) => type === 'room.join')?.payload).toEqual(join?.payload);

  session.leave();
  expect(replacement.commands().at(-1)).toMatchObject({ type: 'room.leave', payload: target });
  const count = replacement.send.mock.calls.length;
  await vi.advanceTimersByTimeAsync(45_000);
  expect(replacement.send).toHaveBeenCalledTimes(count);
  expect(sockets).toHaveLength(2);
  expect(vi.getTimerCount()).toBe(0);
});
