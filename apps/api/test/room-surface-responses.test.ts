import assert from 'node:assert/strict';
import test from 'node:test';
import { LiveKitAdmission } from '@voiceroom/shared/contracts/admission';
import { RoomCreated, RoomStatus } from '@voiceroom/shared/contracts/rooms';
import { WidgetRoomCreated, WidgetRoomInfo } from '@voiceroom/shared/contracts/widget';
import { Pool } from 'pg';
import { Type } from 'typebox';
import { createRoomStore } from '../src/app/room-store.ts';
import { createAdmissionService } from '../src/domains/admission/admission.service.ts';
import { createCredentialBoundaryService } from '../src/domains/admission/credential-boundary.service.ts';
import { createLiveKitCredentialProvider } from '../src/domains/admission/livekit-credential-provider.ts';
import { roomAllowsAdmission } from '../src/domains/rooms/room-surface.policy.ts';
import { createTestDatabase } from './db-harness.ts';
import { recordingLogger } from './fakes/index.ts';
import { request, startApiServer } from './fakes/server-process.ts';
import { checked } from './helpers/checked.ts';
import { joinVoiceRoom, openWs } from './ws-harness.ts';

const VideoGrant = Type.Object({ canPublishSources: Type.Array(Type.String()), canPublishData: Type.Boolean() });
const Claims = Type.Object({ video: VideoGrant });

function videoGrant(token: string) {
  const claims: unknown = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'));
  return checked(Claims, claims, 'LiveKit JWT claims').video;
}

test('main and widget serialize room status and issue surface-specific media grants', async (t) => {
  const server = await startApiServer(t, {
    env: {
      WIDGET_ENABLED: 'true',
      MAX_ROOM_PEERS: '7',
      LIVEKIT_URL: 'ws://livekit.example.test',
      LIVEKIT_API_KEY: 'test-key',
      LIVEKIT_API_SECRET: 'test-secret',
      LIVEKIT_GATE_PUBLIC_URL: 'wss://gate.example.test',
      LIVEKIT_GATE_SECRET: 'gate-secret-for-tests-0123456789abcdef'
    }
  });
  const pool = new Pool({ connectionString: server.databaseUrl });
  server.beforeCleanup(() => pool.end());
  await pool.query('UPDATE widget_boundary_activation SET widget_boundary_required=true,widget_admission_enabled=true');

  for (const surface of ['main', 'widget'] as const) {
    const widget = surface === 'widget';
    const prefix = widget ? '/api/widget' : '/api';
    const created = await request(
      server.socketPath,
      { method: 'POST', pathname: `${prefix}/rooms`, body: widget ? { chat: true } : { kind: 'meet' } },
      widget ? WidgetRoomCreated : RoomCreated
    );
    assert.equal(created.status, 201);
    const { roomId } = created.body;
    const statusPath = `${prefix}/rooms/${roomId}`;
    const expectedCapabilities = {
      screenShare: !widget,
      camera: true,
      chat: widget ? 'none' : 'persistent',
      maxPeers: 7
    };
    if (widget) {
      assert.deepEqual(created.body, { ok: true, roomId, chat: false, maxRoomPeers: 7 });
      const response = await request(server.socketPath, { pathname: statusPath }, WidgetRoomInfo);
      assert.equal(response.status, 200);
      assert.deepEqual(response.body.capabilities, expectedCapabilities);
      const { ok, chat, maxRoomPeers, peers } = response.body;
      assert.deepEqual(
        { ok, roomId: response.body.roomId, chat, maxRoomPeers, peers },
        {
          ok: true,
          roomId,
          chat: false,
          maxRoomPeers: 7,
          peers: 0
        }
      );
    } else {
      const response = await request(server.socketPath, { pathname: statusPath }, RoomStatus);
      assert.equal(response.status, 200);
      assert.deepEqual(response.body.capabilities, expectedCapabilities);
      const { ok, avatarUrl, createdAt, exists, isStatic, maxRoomPeers, name, peers } = response.body;
      assert.deepEqual(
        { ok, avatarUrl, exists, isStatic, maxRoomPeers, name, peers, roomId: response.body.roomId },
        {
          ok: true,
          avatarUrl: null,
          exists: true,
          isStatic: false,
          maxRoomPeers: 7,
          name: '',
          peers: 0,
          roomId
        }
      );
      assert.ok(createdAt > 0);
    }

    const socket = openWs(server.socketPath, { path: `${prefix}/ws` });
    t.after(() => socket.ws.close());
    await socket.ready;
    const join = { roomId, peerId: `${surface}-peer`, sessionToken: 'x'.repeat(32), name: 'Guest' };
    await joinVoiceRoom(socket, join);
    const response = await request(
      server.socketPath,
      {
        method: 'POST',
        pathname: `${prefix}/livekit-token`,
        body: { ...join, surface: widget ? 'main' : 'widget' },
        headers: { 'x-room-surface': widget ? 'main' : 'widget' }
      },
      LiveKitAdmission
    );
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.capabilities, expectedCapabilities);
    const { ok, room, token, ttlSeconds, url, gateCredentialId } = response.body;
    assert.equal(ok, true);
    assert.ok(room.endsWith(roomId));
    assert.ok(ttlSeconds > 0);
    assert.ok(gateCredentialId);
    const gate = new URL(url);
    assert.equal(gate.origin, 'wss://gate.example.test');
    assert.ok(gate.searchParams.get('vr_gate_credential'));
    const { canPublishSources, canPublishData } = videoGrant(token);
    assert.deepEqual(
      { canPublishSources, canPublishData },
      {
        canPublishSources: widget
          ? ['microphone', 'camera']
          : ['microphone', 'camera', 'screen_share', 'screen_share_audio'],
        canPublishData: false
      }
    );
  }
});

test('Meet admission uses the stored room and roster, independent of widget ownership', async (t) => {
  const { pool, cleanup } = await createTestDatabase(t);
  t.after(cleanup);
  const store = createRoomStore({ pool });
  const room = await store.createRoom({ roomId: 'meet-room', kind: 'meet' });
  const join = { roomId: room.id, peerId: 'meet-peer', sessionToken: 'x'.repeat(32), name: 'Guest' };
  const identity = await store.getOrCreatePeerIdentity(join);
  assert.ok(identity?.identity?.id);
  const peer = {
    sessionToken: join.sessionToken,
    gateGuestPrincipalId: identity.identity.id,
    transportId: 'meet-connection',
    accountUserId: null
  };
  const gateUrl = 'wss://gate.example.test';
  const gateSecret = 'gate-secret-for-tests-0123456789abcdef';
  const boundary = createCredentialBoundaryService({ roomStore: store, secret: gateSecret });
  const provider = createLiveKitCredentialProvider({ apiKey: 'test-key', apiSecret: 'test-secret', gateUrl, boundary });
  const service = createAdmissionService({
    maxRoomPeers: 7,
    livekitConfig: () => ({
      enabled: true,
      apiKey: 'test-key',
      apiSecret: 'test-secret',
      url: 'ws://livekit.example.test',
      adminUrl: 'http://livekit.example.test',
      gateUrl,
      gateSecret
    }),
    credentialProvider: () => provider,
    credentialBoundary: () => boundary,
    store: () => store,
    roomExists: async (id) => Boolean(await store.getRoom(id)),
    roomAllowed: async (id, surface) =>
      roomAllowsAdmission(await store.getRoom(id), surface, async () => {
        assert.fail('Meet admission must not consult the widget owner');
      }),
    findRoomBan: async () => null,
    waitForRosterPeer: async () => peer,
    currentRosterPeer: () => peer,
    memberships: () => null,
    roomName: (id) => `voice-room-${id}`,
    recordRevokeFailure: () => assert.fail('unexpected revoke failure')
  });
  const input = { ...join, user: null, clientIp: '203.0.113.9', log: recordingLogger() };
  for (const surface of ['main', 'widget'] as const) {
    assert.deepEqual(await service.admit({ ...input, surface }), { status: 'refused', reason: 'room_not_found' });
  }
  assert.deepEqual(await service.admit({ ...input, surface: 'meet', sessionToken: 'different' }), {
    status: 'refused',
    reason: 'invalid_session'
  });
  const admitted = await service.admit({ ...input, surface: 'meet' });
  assert.equal(admitted.status, 'issued');
  const json: unknown = JSON.parse(JSON.stringify({ ok: true, ...admitted.admission }));
  const answer = checked(LiveKitAdmission, json, 'Meet admission');
  assert.deepEqual(answer.capabilities, { screenShare: true, camera: true, chat: 'ephemeral', maxPeers: 7 });
  const { canPublishSources, canPublishData } = videoGrant(answer.token);
  assert.deepEqual(canPublishSources, ['microphone', 'camera', 'screen_share', 'screen_share_audio']);
  assert.equal(canPublishData, false);
});
