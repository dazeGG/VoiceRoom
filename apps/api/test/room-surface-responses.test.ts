import assert from 'node:assert/strict';
import test from 'node:test';
import { LiveKitAdmission } from '@voice-room/shared/contracts/admission';
import { RoomCreated, RoomStatus } from '@voice-room/shared/contracts/rooms';
import { WidgetRoomCreated, WidgetRoomInfo } from '@voice-room/shared/contracts/widget';
import { Pool } from 'pg';
import { Type } from 'typebox';
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
      { method: 'POST', pathname: `${prefix}/rooms`, body: widget ? { chat: true } : {} },
      widget ? WidgetRoomCreated : RoomCreated
    );
    assert.equal(created.status, 201);
    const { roomId } = created.body;
    const statusPath = `${prefix}/rooms/${roomId}`;
    if (widget) {
      const response = await request(server.socketPath, { pathname: statusPath }, WidgetRoomInfo);
      assert.equal(response.status, 200);
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
