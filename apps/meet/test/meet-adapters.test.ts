import { voiceAssetUrls } from '@voiceroom/call/voice-assets';
import { RealtimeRecoveryController } from '@voiceroom/call/engine/recovery/realtime-recovery';
import { MEET_CHAT_MAX_BYTES, type ClientCommand, type ServerFrame } from '@voiceroom/shared/contracts/realtime';
import type { RoomCapabilities } from '@voiceroom/shared/contracts/rooms';
import { validateClientCommand } from '@voiceroom/shared/realtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { consumeOwnerLink, createMeetApi } from '@/adapters/meet-api';
import { createMeetIdentity } from '@/adapters/meet-identity';
import { createMeetPorts } from '@/adapters/meet-ports';
import { createMeetTransport, type MeetTransport } from '@/adapters/meet-transport';

const roomId = 'cal9';
const guest = { roomId, name: 'Alice', peerId: 'peer-alice', sessionToken: 'x'.repeat(64) };
const capabilities: RoomCapabilities = { camera: true, chat: 'ephemeral', maxPeers: 8, screenShare: true };
const admission = {
  ok: true as const,
  room: roomId,
  capabilities,
  token: 'livekit-token',
  gateCredentialId: 'gate-id',
  ttlSeconds: 100,
  url: 'wss://meet.example/rtc?vr_gate_credential=gate-token',
  urls: ['wss://meet.example/?vr_gate_credential=gate-token']
};

describe('Meet HTTP and identity adapters', () => {
  beforeEach(() => sessionStorage.clear());

  it('exchanges the owner fragment once against the API and sends its bearer only on room creation', async () => {
    history.replaceState(null, '', '/#owner=link-secret');
    const token = consumeOwnerLink();
    expect(token).toBe('link-secret');
    expect(location.hash).toBe('');
    expect(consumeOwnerLink()).toBe('');
    const fetcher = vi.fn<typeof fetch>();
    fetcher.mockResolvedValueOnce(Response.json({ ok: true, token: 'create-only' }));
    fetcher.mockResolvedValueOnce(Response.json({ ok: true, roomId, joinUrl: `https://meet.example/room/${roomId}` }));
    fetcher.mockResolvedValueOnce(Response.json({ ok: true, roomId, capabilities, peers: 0 }));

    const api = createMeetApi(fetcher);
    await expect(api.createMeeting()).rejects.toMatchObject({ code: 'authentication_required', status: 401 });
    expect(fetcher).not.toHaveBeenCalled();
    await api.exchangeOwnerLink(token);
    await expect(api.createMeeting()).resolves.toMatchObject({ joinUrl: `https://meet.example/room/${roomId}` });
    await expect(api.status(roomId)).resolves.toMatchObject({ capabilities });
    expect(fetcher.mock.calls).toEqual([
      [
        '/api/meet/owner/exchange',
        expect.objectContaining({
          credentials: 'omit',
          body: '{"token":"link-secret"}',
          headers: { 'Content-Type': 'application/json' }
        })
      ],
      [
        '/api/meet/rooms',
        expect.objectContaining({ credentials: 'omit', headers: { Authorization: 'Bearer create-only' } })
      ],
      [`/api/meet/rooms/${roomId}/status`, expect.objectContaining({ credentials: 'omit', cache: 'no-store' })]
    ]);
    expect(fetcher.mock.calls[2]?.[1]?.headers).toBeUndefined();
    expect(sessionStorage.length).toBe(0);
  });

  it('keeps guest admission credential-free at HTTP level and preserves the gate query on the configured URL', async () => {
    const fetcher = vi.fn<typeof fetch>();
    fetcher.mockResolvedValueOnce(
      Response.json({
        contractVersion: 'voice-room.runtime-config/v1',
        schemaVersion: 1,
        livekit: { wsUrl: 'wss://gate.example', connectFallbacks: [] }
      })
    );
    fetcher.mockResolvedValueOnce(Response.json(admission));
    const { urls } = await createMeetApi(fetcher).admit(guest, new AbortController().signal);
    expect(urls).toEqual([
      'wss://gate.example/?vr_gate_credential=gate-token',
      'wss://meet.example/?vr_gate_credential=gate-token'
    ]);
    expect(fetcher.mock.calls).toEqual([
      ['/runtime-config.json', expect.objectContaining({ credentials: 'omit' })],
      [
        '/api/meet/livekit-token',
        expect.objectContaining({
          credentials: 'omit',
          body: JSON.stringify(guest),
          headers: { 'Content-Type': 'application/json' }
        })
      ]
    ]);
  });

  it('distinguishes missing rooms and bad payloads without exposing server text', async () => {
    const fetcher = vi.fn<typeof fetch>();
    fetcher.mockResolvedValueOnce(Response.json({ error: 'secret detail' }, { status: 404 }));
    fetcher.mockResolvedValueOnce(Response.json({ error: 'secret detail' }));
    fetcher.mockResolvedValueOnce(
      Response.json({ error: 'secret detail', code: 'invalid_credentials' }, { status: 401 })
    );
    const api = createMeetApi(fetcher);
    await expect(api.status(roomId)).resolves.toBeNull();
    await expect(api.status(roomId)).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(api.exchangeOwnerLink('expired')).rejects.toMatchObject({
      code: 'invalid_credentials',
      message: 'meet.error.ownerLink'
    });
  });

  it('persists just the name and gives independent instances different credentials in the same room', () => {
    const first = createMeetIdentity();
    expect(first.displayName()).toBe('');
    first.setDisplayName(' Alice   Jones ');
    const credentials = first.credentials(roomId);
    expect(first.credentials(roomId)).toEqual(credentials);
    const second = createMeetIdentity();
    expect(second.displayName()).toBe('Alice Jones');
    expect(second.credentials(roomId)).not.toEqual(credentials);
    expect(first.rotateCredentials(roomId)).not.toEqual(credentials);
    expect(sessionStorage.length).toBe(1);
    const key = sessionStorage.key(0);
    expect(key && sessionStorage.getItem(key)).toBe('Alice Jones');
  });

  it('uses memory for the name and credentials when storage is blocked', async () => {
    const identity = createMeetIdentity(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    identity.setDisplayName('Alice');
    const entry = await identity.verifyEntry();
    expect(entry.identity.profile?.displayName).toBe('Alice');
    expect(entry.isCurrent()).toBe(true);
    expect(identity.credentials(roomId).sessionToken).toHaveLength(64);
    identity.setDisplayName('Bob');
    expect(entry.isCurrent()).toBe(false);
  });
});

class TestSocket extends EventTarget {
  readyState: number = WebSocket.OPEN;
  readonly sent: ClientCommand[] = [];

  send(raw: string): void {
    const frame: unknown = JSON.parse(raw);
    const parsed = validateClientCommand(frame);
    if (!parsed.ok) throw new Error('Invalid outgoing frame');
    this.sent.push(parsed.envelope);
  }

  receive(frame: ServerFrame): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(frame) }));
  }

  close(): void {
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(new Event('close'));
  }
}

function snapshot(socket: TestSocket, peerId = guest.peerId, mode: 'preview' | 'active' = 'active'): void {
  const id = socket.sent.findLast((frame) => frame.type === 'room.join')?.id;
  if (!id) throw new Error('No room.join was sent');
  socket.receive({
    id,
    type: 'room.snapshot',
    payload: {
      roomId,
      room: { avatarUrl: null, createdAt: 1, isStatic: false, name: '', relationship: 'member', peers: 1, roomId },
      peers: [
        {
          id: peerId,
          accountUserId: '',
          avatarAccent: null,
          avatarColorKey: '',
          avatarUrl: null,
          serverMuted: false,
          name: 'Alice'
        }
      ],
      recentMessages: [],
      voiceActiveSince: 1,
      mode
    }
  });
}

describe('Meet realtime adapter', () => {
  let sockets: TestSocket[];
  let transport: MeetTransport;
  const admit = vi.fn(async () => admission);

  function currentSocket(): TestSocket {
    const socket = sockets.at(-1);
    if (!socket) throw new Error('No websocket was opened');
    return socket;
  }

  function ready(): TestSocket {
    const socket = currentSocket();
    socket.receive({ type: 'ready', payload: { guest: true } });
    return socket;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    admit.mockClear();
    transport = createMeetTransport(
      { status: async () => null, admit },
      {
        origin: 'https://meet.example',
        openSocket(url) {
          expect(url.href).toBe('wss://meet.example/api/meet/ws');
          const socket = new TestSocket();
          sockets.push(socket);
          return socket;
        }
      }
    );
  });

  afterEach(() => {
    transport.disconnect();
    vi.useRealTimers();
  });

  it('waits for the guest roster acknowledgement before requesting media credentials', async () => {
    const onEvent = vi.fn();
    transport.realtime.subscribeRoom(roomId, onEvent);
    transport.realtime.join(guest);
    const request = transport.requestLiveKitToken(guest);
    expect(admit).not.toHaveBeenCalled();
    const socket = ready();
    expect(socket.sent).toHaveLength(1);
    expect(socket.sent[0]).toMatchObject({ type: 'room.join', payload: guest });
    snapshot(socket, 'some-other-peer');
    snapshot(socket, guest.peerId, 'preview');
    await Promise.resolve();
    expect(admit).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
    snapshot(socket);
    await expect(request).resolves.toEqual(admission);
    expect(onEvent).toHaveBeenCalledOnce();
    expect(transport.capabilities.value).toEqual(capabilities);
  });

  it('rejoins the same roster on a new socket after loss and stops reconnecting after leave', async () => {
    const stateChanged = vi.fn<(connected: boolean, epoch: number) => void>();
    transport.realtime.onStateChange(stateChanged);
    transport.realtime.join(guest);
    const first = ready();
    snapshot(first);
    first.close();
    await vi.advanceTimersByTimeAsync(400);
    const second = ready();
    expect(second).not.toBe(first);
    expect(second.sent[0]).toMatchObject({ type: 'room.join', payload: guest });
    expect(transport.realtime.requestResync(1, 2)).toBe(true);
    expect(second.sent).toHaveLength(1);
    snapshot(second);
    transport.realtime.leave(guest);
    expect(second.sent.at(-1)).toEqual({
      type: 'room.leave',
      payload: { roomId, peerId: guest.peerId, sessionToken: guest.sessionToken }
    });
    expect(stateChanged.mock.calls).toEqual([
      [true, 1],
      [false, 1],
      [true, 2],
      [false, 2]
    ]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sockets).toHaveLength(2);
    expect(transport.capabilities.value).toBeNull();
  });

  it('bounds a lost guest restore acknowledgement when the socket opens before the network online event', async () => {
    const realtime = transport.realtime;
    const attemptReplacement = vi.fn(async () => ({ ok: true as const }));
    const controller = new RealtimeRecoveryController({
      attemptReplacement,
      requestAppSnapshot: ({ epoch, appEpoch, fresh }) => realtime.requestResync(epoch, appEpoch, fresh)
    });
    controller.activate({ appEpoch: 0, appConnected: false });
    realtime.onStateChange((connected, epoch) => {
      if (connected) controller.appWsRestored(epoch);
      else controller.appWsLost(epoch);
    });
    realtime.setResyncFailureHandler((failure) => controller.appSnapshotRequestFailed(failure));
    realtime.subscribeRoom(roomId, (event) => {
      if (event.type === 'room.snapshot')
        controller.appSnapshotApplied({ appEpoch: realtime.getConnectionEpoch(), active: true, hasLocalPeer: true });
    });
    realtime.join(guest);
    const first = ready();
    snapshot(first);
    controller.livekitReconciled();
    controller.networkOffline();
    first.close();
    controller.livekitDisconnected();
    await vi.advanceTimersByTimeAsync(400);
    const restored = ready();
    expect(restored).not.toBe(first);
    controller.networkOnline();
    await vi.advanceTimersByTimeAsync(4_000);

    expect(restored.sent.filter(({ type }) => type === 'room.join')).toHaveLength(1);
    expect(attemptReplacement).not.toHaveBeenCalled();
    expect(controller.getSnapshot().phase).toBe('failed');
    controller.cancel();
  });

  it('sends chat only on an admitted active roster and never sends a rejected draft after reconnect', async () => {
    const { chat } = transport;
    expect(chat.send('Before joining')).toBe(false);
    transport.realtime.join(guest);
    const first = ready();
    snapshot(first, guest.peerId, 'preview');
    expect(chat.send('Before roster attachment')).toBe(false);
    snapshot(first);
    expect(chat.send('Before admission')).toBe(false);
    await transport.requestLiveKitToken(guest);
    expect(chat.ready.value).toBe(true);
    expect(chat.send('   ')).toBe(false);
    expect(chat.send('é'.repeat(MEET_CHAT_MAX_BYTES / 2 + 1))).toBe(false);
    expect(chat.send(' A live message ')).toBe(true);
    expect(first.sent.filter((frame) => frame.type === 'meet.chat.send')).toEqual([
      { id: first.sent.at(-1)?.id, type: 'meet.chat.send', payload: { text: 'A live message' } }
    ]);

    first.close();
    expect(chat.ready.value).toBe(false);
    expect(chat.send('During disconnect')).toBe(false);
    await vi.advanceTimersByTimeAsync(400);
    const second = ready();
    expect(chat.send('While the new socket joins')).toBe(false);
    snapshot(second);
    expect(chat.ready.value).toBe(true);
    expect(second.sent.map(({ type }) => type)).toEqual(['room.join']);
  });

  it('keeps the most recent delivered messages in memory until leave and routes chat refusals to the panel', async () => {
    const { chat } = transport;
    const onEvent = vi.fn();
    transport.realtime.subscribeRoom(roomId, onEvent);
    transport.realtime.join(guest);
    const socket = ready();
    const deliver = (index: number) => {
      socket.receive({
        type: 'meet.chat.message',
        payload: { id: `chat-${index}`, authorId: guest.peerId, displayName: 'Alice', text: `Message ${index}` }
      });
    };

    deliver(0);
    expect(chat.messages.value).toEqual([]);
    snapshot(socket);
    await transport.requestLiveKitToken(guest);
    for (let index = 1; index <= 101; index += 1) deliver(index);
    expect(chat.messages.value).toHaveLength(100);
    expect(chat.messages.value[0]?.text).toBe('Message 2');
    expect(chat.messages.value.at(-1)?.text).toBe('Message 101');
    expect(chat.send('Rate limited')).toBe(true);
    const id = socket.sent.at(-1)?.id;
    if (!id) throw new Error('No chat request was sent');
    socket.receive({ id, type: 'error', error: { code: 'rate_limited', message: 'slow down' } });
    expect(chat.error.value).toBe('rate_limited');
    expect(onEvent).toHaveBeenCalledOnce();

    socket.close();
    await vi.advanceTimersByTimeAsync(400);
    snapshot(ready());
    expect(chat.messages.value).toHaveLength(100);
    transport.realtime.leave(guest);
    expect(chat.messages.value).toEqual([]);
    expect(chat.error.value).toBeNull();
  });

  it('drops an in-flight admission after leave even if its response still arrives', async () => {
    const pending = Promise.withResolvers<typeof admission>();
    admit.mockReturnValueOnce(pending.promise);
    transport.realtime.join(guest);
    const socket = ready();
    snapshot(socket);
    const request = transport.requestLiveKitToken(guest);
    await Promise.resolve();
    expect(admit).toHaveBeenCalledOnce();
    transport.realtime.leave(guest);
    pending.resolve(admission);
    await expect(request).rejects.toMatchObject({ code: 'not_in_room' });
    expect(transport.capabilities.value).toBeNull();
  });

  it('correlates media grants to the right request and denies a pending request across socket loss', async () => {
    transport.realtime.join(guest);
    const socket = ready();
    snapshot(socket);
    const pending = transport.realtime.requestMediaGrant({ ...guest, kind: 'screen' });
    const id = socket.sent.at(-1)?.id;
    if (!id) throw new Error('No media request was sent');
    socket.receive({ id, type: 'room.media.grant', payload: { roomId, kind: 'screen', granted: true } });
    await expect(pending).resolves.toMatchObject({ granted: true });
    const interrupted = transport.realtime.requestMediaGrant({ ...guest, kind: 'camera' });
    socket.close();
    await expect(interrupted).resolves.toMatchObject({ granted: false, reason: 'server_busy' });
  });

  it('reflects the media capability from admission in the engine camera policy', async () => {
    admit.mockResolvedValueOnce({ ...admission, capabilities: { ...capabilities, camera: false } });
    const ports = createMeetPorts({
      identity: createMeetIdentity(),
      transport,
      assets: voiceAssetUrls(),
      navigateToRoom: () => {},
      goHome: () => {}
    });
    transport.realtime.join(guest);
    snapshot(ready());
    await transport.requestLiveKitToken(guest);
    expect(ports.mediaPolicy.camera).toBe(false);
    transport.realtime.leave(guest);
    expect(transport.capabilities.value).toBeNull();
  });
});
