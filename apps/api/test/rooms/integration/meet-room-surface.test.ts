import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import test from 'node:test';
import type { ClientCommand, ServerFrame } from '@voiceroom/shared/contracts/realtime';
import { parseServerFrame } from '@voiceroom/shared/realtime';
import { Pool } from 'pg';
import { createRoomStore } from '../../../src/app/room-store.ts';
import { createConnectionRegistry } from '../../../src/realtime/registry.ts';
import { createRoomPresence, type PresenceRoom } from '../../../src/realtime/room-presence.ts';
import { createRoomRealtimeRuntime } from '../../../src/realtime/room-runtime.ts';
import { createVoiceStays } from '../../../src/realtime/voice-stays.ts';
import { createWsHandler } from '../../../src/realtime/ws-handler.ts';
import { dbRoom, fake, recordingLogger } from '../../fakes/index.ts';
import { runtimeDeps } from '../../fakes/room-runtime.ts';
import { request, startApiServer } from '../../fakes/server-process.ts';
import { openWs, sendRawWs, waitForWsType } from '../../ws-harness.ts';

class MeetSocket extends EventEmitter {
  readyState = 1;
  frames: ServerFrame[] = [];

  send(data: string) {
    const result = parseServerFrame(JSON.parse(data));
    assert.ok(result.ok, data);
    this.frames.push(result.frame);
  }

  close(code = 1000, reason = '') {
    this.readyState = 3;
    this.emit('close', code, reason);
  }

  command(frame: ClientCommand) {
    this.emit('message', JSON.stringify(frame));
  }
}

test('Meet shares roster capacity and media grants while refusing persistent chat and previews', async (t) => {
  const meet = dbRoom('meet-room', { kind: 'meet', isStatic: false });
  const main = dbRoom('main-room');
  const widget = dbRoom('widget-room', { kind: 'widget', isStatic: false });
  const rooms = new Map([meet, main, widget].map((room) => [room.id, room]));
  const getRoom = async (roomId: string) => rooms.get(roomId) ?? null;
  const logger = recordingLogger();
  const recordedRoomIds: string[] = [];
  const registry = createConnectionRegistry({
    maxConnectionsPerUser: 4,
    keepaliveMs: 15_000,
    getFriendIds: async () => [],
    logger
  });
  const stays = createVoiceStays({
    rooms: (): Iterable<PresenceRoom> => presence.rooms.values(),
    logger: () => logger,
    sessions: () => ({
      async recordSessions(sessions) {
        recordedRoomIds.push(...sessions.map((session) => session.roomId));
      }
    })
  });
  const presence = createRoomPresence({
    sockets: registry,
    onPeerLeft: stays.recordPeerLeft,
    logger: () => logger,
    roster: { waitMs: 10, pollMs: 1 },
    occupancyRetry: { baseMs: 1, maxMs: 2 },
    store: () => ({
      getRoom,
      markRoomActive: async () => {},
      markRoomEmpty: async () => {},
      pruneRooms: async () => {}
    })
  });
  t.after(presence.reset);
  let historyReads = 0;
  const runtime = createRoomRealtimeRuntime(
    runtimeDeps({
      wsRegistry: registry,
      presenceRooms: presence.rooms,
      async getRoom(roomId) {
        const room = await getRoom(roomId);
        return room ? presence.attach({ id: room.id, kind: room.kind }) : null;
      },
      publishRoomEvent: presence.publish,
      queueRoomOccupancyTransition: async () => {},
      MAX_ROOM_PEERS: 2,
      MAX_ROOM_SCREENS: 1,
      store: {
        getRoom,
        async listMessages() {
          historyReads += 1;
          return [];
        },
        async getOrCreatePeerIdentity({ roomId, peerId }) {
          return {
            status: 'created',
            identity: {
              id: `identity-${peerId}`,
              roomId,
              peerId,
              avatarColorKey: 'blue',
              displayName: '',
              createdAt: 0,
              lastSeenAt: 0,
              sessionTokenHash: ''
            }
          };
        },
        isRoomServerMuted: async () => false,
        normalizeGatePrincipal: () => ({ principalType: 'guest', principalId: 'guest' })
      }
    })
  );
  const handler = createWsHandler({
    registry,
    roomRuntime: runtime,
    surface: 'meet',
    getBoundary: getRoom,
    resolveSessionUser: async () => null,
    getFriendIds: async () => [],
    isUserOnline: () => false,
    logger
  });

  const first = new MeetSocket();
  const second = new MeetSocket();
  const third = new MeetSocket();
  for (const socket of [first, second, third]) t.after(() => socket.close());
  await Promise.all([first, second, third].map((socket) => handler.handleConnection(socket, fake<IncomingMessage>())));

  const alice = { roomId: meet.id, peerId: 'meet-alice', sessionToken: 'a'.repeat(32), name: 'Alice' };
  const bob = { ...alice, peerId: 'meet-bob', sessionToken: 'b'.repeat(32), name: 'Bob' };
  const casey = { ...alice, peerId: 'meet-casey', sessionToken: 'c'.repeat(32), name: 'Casey' };
  first.command({ type: 'room.join', payload: alice });
  const firstSnapshot = (await waitForWsType(first.frames, 'room.snapshot')).payload;
  assert.deepEqual(firstSnapshot.recentMessages, []);
  assert.equal(firstSnapshot.mode, 'active');
  assert.equal(firstSnapshot.peers[0]?.name, 'Alice');
  second.command({ type: 'room.join', payload: bob });
  const secondSnapshot = (await waitForWsType(second.frames, 'room.snapshot')).payload;
  assert.deepEqual(secondSnapshot.recentMessages, []);
  assert.deepEqual(secondSnapshot.peers.map((peer) => peer.id).sort(), [alice.peerId, bob.peerId]);
  assert.equal(historyReads, 0);

  third.command({ type: 'room.join', payload: casey });
  assert.deepEqual((await waitForWsType(third.frames, 'room.full')).payload, { roomId: meet.id, maxRoomPeers: 2 });
  third.command({ id: 'unseated-screen', type: 'room.media.request', payload: { ...alice, kind: 'screen' } });
  assert.equal(
    (await waitForWsType(third.frames, 'error', ({ id }) => id === 'unseated-screen')).error.code,
    'not_active_peer'
  );

  first.command({
    id: 'screen',
    type: 'room.media.request',
    payload: { ...alice, kind: 'screen', profileId: 'high-60' }
  });
  assert.deepEqual((await waitForWsType(first.frames, 'room.media.grant', ({ id }) => id === 'screen')).payload, {
    roomId: meet.id,
    kind: 'screen',
    granted: true,
    profileId: 'high-60'
  });
  first.command({ id: 'camera', type: 'room.media.request', payload: { ...alice, kind: 'camera' } });
  assert.deepEqual((await waitForWsType(first.frames, 'room.media.grant', ({ id }) => id === 'camera')).payload, {
    roomId: meet.id,
    kind: 'camera',
    granted: true
  });
  first.command({ type: 'room.peer.update', payload: { ...alice, patch: { screen: true } } });
  const update = (await waitForWsType(second.frames, 'room.peer.updated')).payload.peer;
  assert.equal(update.id, alice.peerId);
  assert.equal(update.screen, true);
  second.command({
    type: 'room.voice.report',
    payload: {
      ...bob,
      rttMs: 40,
      jitterBufferMs: 30,
      transport: 'udp',
      uplink: { packets: 150, lost: 0 },
      heard: [{ peerId: alice.peerId, packets: 150, lost: 0, concealedSamples: 0, gaps: 0 }]
    }
  });
  assert.equal((await waitForWsType(second.frames, 'room.voice.quality')).payload.level, 'good');
  for (const peer of presence.room(meet.id).peers.values()) {
    assert.deepEqual(peer.voice?.minutes, []);
    assert.deepEqual(peer.voice?.events, []);
  }
  second.command({ id: 'screen-full', type: 'room.media.request', payload: { ...bob, kind: 'screen' } });
  assert.deepEqual((await waitForWsType(second.frames, 'room.media.grant', ({ id }) => id === 'screen-full')).payload, {
    roomId: meet.id,
    kind: 'screen',
    granted: false,
    reason: 'room_screens_full',
    maxRoomScreens: 1
  });

  for (const type of ['room.chat.typing', 'room.preview.subscribe'] as const) {
    first.command({ id: type, type, payload: { roomId: meet.id } });
    assert.equal((await waitForWsType(first.frames, 'error', ({ id }) => id === type)).error.code, 'forbidden');
  }
  for (const roomId of [main.id, widget.id]) {
    first.command({ id: roomId, type: 'room.join', payload: { ...alice, roomId } });
    assert.equal((await waitForWsType(first.frames, 'error', ({ id }) => id === roomId)).error.code, 'room_not_found');
  }
  first.close(1000, 'guest-controlled private contents');
  assert.doesNotMatch(JSON.stringify(logger.records), /guest-controlled private contents/);
  await stays.recordOpenSessions();
  assert.deepEqual(recordedRoomIds, []);
});

test('the full server does not expose a stored Meet room through main, widget or Meet endpoints', async (t) => {
  const server = await startApiServer(t, { env: { WIDGET_ENABLED: 'true' } });
  const pool = new Pool({ connectionString: server.databaseUrl });
  server.beforeCleanup(() => pool.end());
  await pool.query('UPDATE widget_boundary_activation SET widget_boundary_required=true,widget_admission_enabled=true');
  const meet = await createRoomStore({ pool }).createRoom({ creatorIp: '', kind: 'meet' });
  const join = { roomId: meet.id, peerId: 'meet-guest', sessionToken: 's'.repeat(32), name: 'Guest', surface: 'meet' };

  for (const prefix of ['/api', '/api/widget', '/api/meet']) {
    const info = await request(server.socketPath, {
      pathname: `${prefix}/rooms/${meet.id}`,
      headers: { 'x-room-surface': 'meet' }
    });
    assert.equal(info.status, 404);
    // This marker is ignored; only the endpoint selects a surface.
    const token = await request(server.socketPath, { method: 'POST', pathname: `${prefix}/livekit-token`, body: join });
    assert.equal(token.status, 404);
  }
  const create = await request(server.socketPath, { method: 'POST', pathname: '/api/meet/rooms', body: {} });
  assert.equal(create.status, 404);
  const meetConnection = openWs(server.socketPath, { path: '/api/meet/ws' });
  t.after(() => meetConnection.ws.close());
  await assert.rejects(meetConnection.ready, { message: 'Unexpected server response: 404' });
  for (const path of ['/api/ws', '/api/widget/ws']) {
    const connection = openWs(server.socketPath, { path, headers: { 'x-room-surface': 'meet' } });
    t.after(() => connection.ws.close());
    await connection.ready;
    sendRawWs(connection.ws, { type: 'room.join', payload: join });
    assert.equal((await waitForWsType(connection.frames, 'error')).error.code, 'room_not_found');
  }
});
