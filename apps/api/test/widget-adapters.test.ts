import test from 'node:test';
import { isRecord } from '../src/platform/record.ts';
import { LOG_EVENTS } from '../src/lib/log-events.ts';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { createRoomStore } from '../src/app/room-store.ts';
import { WidgetRoomCreated, WidgetRoomInfo } from '@voice-room/shared/contracts/widget';
import { RoomCreated } from '@voice-room/shared/contracts/rooms';
import { startApiServer, request, registerAccount } from './fakes/server-process.ts';
import { openWs, joinVoiceRoom, waitForWsType, waitForClose, sendWs } from './ws-harness.ts';

test('real widget adapters ignore account cookies and isolate room lookup, WS, snapshots and chat policy', async (t) => {
  const server = await startApiServer(t, {
    env: {
      WIDGET_ENABLED: 'true',
      LOG_LEVEL: 'info',
      AUTH_RATE_LIMIT: '0',
      ROOM_CREATE_RATE_LIMIT: '0',
      ROOM_CREATE_POW_DIFFICULTY: '0'
    }
  });
  const pool = new Pool({ connectionString: server.databaseUrl });
  server.beforeCleanup(() => pool.end());
  await pool.query('UPDATE widget_boundary_activation SET widget_boundary_required=true,widget_admission_enabled=true');
  const cookie = await registerAccount(server.socketPath, 'widget-cookie');
  const off = await request(
    server.socketPath,
    { method: 'POST', pathname: '/api/widget/rooms', body: { chat: false }, cookie },
    WidgetRoomCreated
  );
  assert.equal(off.status, 201);
  assert.equal(off.body.chat, false);
  const on = await request(
    server.socketPath,
    { method: 'POST', pathname: '/api/widget/rooms', body: { chat: true } },
    WidgetRoomCreated
  );
  assert.equal(on.status, 201);
  assert.equal(on.body.chat, false);
  const store = createRoomStore({ pool });
  assert.equal((await store.getRoom(on.body.roomId))?.widgetChatEnabled, false);
  const legacy = await store.createRoom({ creatorIp: '', kind: 'widget', widgetChatEnabled: true });
  assert.equal(legacy.widgetChatEnabled, true);
  await store.appendMessage(legacy.id, {
    id: 'legacy-widget-message',
    peerId: 'legacy-peer',
    authorUserId: null,
    name: 'Legacy',
    text: 'must stay hidden',
    createdAt: Date.now()
  });
  const main = await request(server.socketPath, { method: 'POST', pathname: '/api/rooms', body: {} }, RoomCreated);
  assert.equal(main.status, 201);
  assert.equal((await request(server.socketPath, { pathname: `/api/rooms/${off.body.roomId}` })).status, 404);
  assert.equal((await request(server.socketPath, { pathname: `/api/widget/rooms/${main.body.roomId}` })).status, 404);
  assert.equal(
    (await request(server.socketPath, { pathname: `/api/widget/rooms/${legacy.id}` }, WidgetRoomInfo)).body.chat,
    false
  );
  const widget = openWs(server.socketPath, { path: '/api/widget/ws', cookie });
  t.after(() => widget.ws.close());
  assert.equal((await widget.ready).payload.guest, true);
  const join = { roomId: off.body.roomId, peerId: 'widget-peer1', sessionToken: 'w'.repeat(32), name: 'Guest' };
  const snapshot = await joinVoiceRoom(widget, join);
  assert.equal(snapshot.payload.peers[0]?.accountUserId, '');
  assert.deepEqual(snapshot.payload.recentMessages, []);
  assert.equal(
    (await request(server.socketPath, { method: 'POST', pathname: '/api/livekit-token', body: join, cookie })).status,
    404
  );
  assert.equal((await request(server.socketPath, { method: 'POST', pathname: '/api/state', body: join })).status, 404);
  assert.equal(
    (await request(server.socketPath, { pathname: `/api/widget/rooms/${off.body.roomId}/messages`, cookie })).status,
    404
  );
  assert.equal(
    (
      await request(server.socketPath, {
        method: 'POST',
        pathname: `/api/widget/rooms/${off.body.roomId}/messages`,
        body: { ...join, text: 'hidden' }
      })
    ).status,
    404
  );
  sendWs(widget.ws, 'room.preview.subscribe', { roomId: off.body.roomId });
  assert.equal((await waitForWsType(widget.frames, 'error')).error.code, 'forbidden');
  const normal = openWs(server.socketPath);
  t.after(() => normal.ws.close());
  await normal.ready;
  sendWs(normal.ws, 'room.join', join);
  assert.equal((await waitForWsType(normal.frames, 'error')).error.code, 'room_not_found');
  const talk = openWs(server.socketPath, { path: '/api/widget/ws', cookie });
  t.after(() => talk.ws.close());
  await talk.ready;
  const writer = { ...join, roomId: legacy.id, peerId: 'widget-peer2', sessionToken: 'v'.repeat(32) };
  assert.deepEqual((await joinVoiceRoom(talk, writer)).payload.recentMessages, []);
  const messages = `/api/widget/rooms/${legacy.id}/messages`;
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
    const pathname = method === 'PATCH' || method === 'DELETE' ? `${messages}/legacy-widget-message` : messages;
    const body = method === 'GET' ? undefined : { ...writer, text: 'hello' };
    assert.equal((await request(server.socketPath, { method, pathname, body, cookie })).status, 404);
  }
  assert.equal((await store.listMessages(legacy.id, { limit: 10 }))[0]?.text, 'must stay hidden');
  sendWs(talk.ws, 'room.chat.typing', { roomId: legacy.id });
  assert.equal((await waitForWsType(talk.frames, 'error')).error.code, 'forbidden');
  for (const path of ['chat', 'chat/history', 'pins', 'members', 'peers'])
    assert.ok(
      [403, 404].includes(
        (await request(server.socketPath, { pathname: `/api/rooms/${legacy.id}/${path}`, cookie })).status
      ),
      path
    );
  const beforeScreen = widget.frames.length;
  sendWs(widget.ws, 'room.media.request', { ...join, kind: 'screen', profileId: 'high-60' });
  assert.equal((await waitForWsType(widget.frames, 'error', () => true, 5000, beforeScreen)).error.code, 'forbidden');
  const beforeScreenPatch = widget.frames.length;
  sendWs(widget.ws, 'room.peer.update', {
    roomId: join.roomId,
    peerId: join.peerId,
    sessionToken: join.sessionToken,
    patch: { screen: true }
  });
  assert.equal(
    (await waitForWsType(widget.frames, 'error', () => true, 5000, beforeScreenPatch)).error.code,
    'forbidden'
  );
  sendWs(widget.ws, 'room.media.request', { ...join, kind: 'camera' });
  assert.deepEqual((await waitForWsType(widget.frames, 'room.media.grant')).payload, {
    roomId: join.roomId,
    kind: 'camera',
    granted: true
  });
  const stale = openWs(server.socketPath, { path: '/api/widget/ws' });
  t.after(() => stale.ws.close());
  await stale.ready;
  sendWs(stale.ws, 'room.join', { ...writer, sessionToken: 'z'.repeat(32) });
  assert.equal((await waitForWsType(stale.frames, 'error')).error.code, 'invalid_session');
  const logDeadline = Date.now() + 3000;
  while (!server.logs.stdout.includes(LOG_EVENTS.ROOM_JOIN_REJECTED) && Date.now() < logDeadline)
    await new Promise((resolve) => setTimeout(resolve, 10));
  const records: unknown[] = server.logs.stdout
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line): unknown => JSON.parse(line));
  const rejected = records
    .filter(isRecord)
    .find((record) => record.evt === LOG_EVENTS.ROOM_JOIN_REJECTED && record.code === 'invalid_session');
  assert.ok(rejected, 'actual failed guest join must be observed without exposing its room code');
  assert.equal(Object.hasOwn(rejected, 'roomId'), false);
  assert.equal(server.logs.stdout.includes(legacy.id), false, 'failed join logs must not expose widget room code');
  assert.equal(server.logs.stdout.includes('z'.repeat(32)), false, 'failed join logs must not expose guest secret');
  const replacement = openWs(server.socketPath, { path: '/api/widget/ws', cookie });
  t.after(() => replacement.ws.close());
  await replacement.ready;
  const resumed = await joinVoiceRoom(replacement, writer);
  assert.equal(resumed.payload.peers.filter((peer) => peer.id === writer.peerId).length, 1);
  await pool.query('UPDATE widget_boundary_activation SET widget_admission_enabled=false');
  assert.equal((await request(server.socketPath, { pathname: `/api/widget/rooms/${legacy.id}` })).status, 404);
});

test('main and widget apply the same room seat limit while reserving a disconnected peer’s seat for rejoin', async (t) => {
  const server = await startApiServer(t, {
    env: { WIDGET_ENABLED: 'true', MAX_ROOM_PEERS: '1', MAX_VOICE_PEERS: '0', MEDIA_BUDGET_MBPS: '0' }
  });
  const pool = new Pool({ connectionString: server.databaseUrl });
  server.beforeCleanup(() => pool.end());
  await pool.query('UPDATE widget_boundary_activation SET widget_boundary_required=true,widget_admission_enabled=true');

  for (const surface of ['main', 'widget'] as const) {
    const prefix = surface === 'widget' ? '/api/widget' : '/api';
    const create =
      surface === 'widget'
        ? await request(
            server.socketPath,
            { method: 'POST', pathname: `${prefix}/rooms`, body: { chat: false } },
            WidgetRoomCreated
          )
        : await request(server.socketPath, { method: 'POST', pathname: `${prefix}/rooms`, body: {} }, RoomCreated);
    assert.equal(create.status, 201);
    const seated = {
      roomId: create.body.roomId,
      peerId: `${surface}-seated`,
      sessionToken: 's'.repeat(32),
      name: 'Seated'
    };
    const newcomer = { ...seated, peerId: `${surface}-newcomer`, sessionToken: 'n'.repeat(32), name: 'Newcomer' };
    const path = `${prefix}/ws`;
    const first = openWs(server.socketPath, { path });
    const second = openWs(server.socketPath, { path });
    t.after(() => first.ws.close());
    t.after(() => second.ws.close());
    await Promise.all([first.ready, second.ready]);
    await joinVoiceRoom(first, seated);

    if (surface === 'main') {
      sendWs(first.ws, 'room.media.request', { ...seated, kind: 'screen', profileId: 'high-60' });
      assert.deepEqual((await waitForWsType(first.frames, 'room.media.grant')).payload, {
        roomId: seated.roomId,
        kind: 'screen',
        granted: true,
        profileId: 'high-60'
      });
      sendWs(first.ws, 'room.peer.update', { ...seated, patch: { screen: true } });
      const update = await waitForWsType(
        first.frames,
        'room.peer.updated',
        (frame) => frame.payload.peer.screen === true
      );
      assert.equal(update.payload.peer.id, seated.peerId);
    }

    const closed = waitForClose(first.ws);
    first.ws.close();
    await closed;
    sendWs(second.ws, 'room.join', newcomer);
    assert.deepEqual((await waitForWsType(second.frames, 'room.full')).payload, {
      roomId: seated.roomId,
      maxRoomPeers: 1
    });
    const resumed = await joinVoiceRoom(second, seated);
    assert.deepEqual(
      resumed.payload.peers.map((peer) => peer.id),
      [seated.peerId]
    );
    const write = await request(server.socketPath, {
      method: 'POST',
      pathname: '/api/state',
      body: { ...seated, screen: true }
    });
    assert.equal(write.status, surface === 'main' ? 409 : 404);
    assert.equal(write.body.code, surface === 'main' ? 'state_updates_require_websocket' : 'room_not_found');
  }
});
