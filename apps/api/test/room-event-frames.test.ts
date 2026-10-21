// Characterization of what each kind of room subscriber receives for every
// roster and room change: voice peers, a socket that previews the room and is
// in its call, a preview-only watcher and an account tab outside the room.
// Clients of the previous release read these frames, so their names, payloads
// and order per socket must not change.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import type { ServerFrame } from '@voice-room/shared/contracts/realtime';
import { RoomCreated } from '@voice-room/shared/contracts/rooms';
import { isArray, isRecord } from '@voice-room/shared/guards';
import { joinVoiceRoom, openWs, sendWs, subscribeRoomPreview, type WsSession } from './ws-harness.ts';
import { registerAccount, request, startApiServer, wait } from './fakes/server-process.ts';

// The frames a room change produces; the rest (summaries, snapshots, pings) is not this test's.
const ROOM_EVENTS = new Set<string>([
  'room.peer.joined',
  'room.peer.updated',
  'room.peer.left',
  'room.updated',
  'room.deleted',
  'room.kicked',
  'room.banned',
  'room.left'
]);
// Values that differ per run; their presence and type still count.
const VOLATILE = new Set(['joinedAt', 'createdAt', 'emptySince', 'lastMessageAt', 'avatarColorKey']);
// Every field a peer carries, with the value most peers have.
const PEER_DEFAULTS: Record<string, unknown> = {
  accountUserId: '',
  avatarAccent: null,
  avatarColorKey: '<string>',
  avatarUrl: null,
  deafened: false,
  id: '',
  joinedAt: '<number>',
  muted: false,
  name: '',
  screen: false,
  screenAudio: false,
  screenProfileId: '',
  screenStreamId: '',
  serverMuted: false,
  viewedScreenPeerId: ''
};

/** Waits until no socket has received a frame for a while, so every fan-out of the last step landed. */
async function settle(sessions: WsSession[]): Promise<void> {
  const deadline = Date.now() + 5000;
  let last = sessions.map((session) => session.frames.length).join();
  for (;;) {
    await wait(150);
    const now = sessions.map((session) => session.frames.length).join();
    if (now === last) return;
    assert.ok(Date.now() <= deadline, 'the sockets kept receiving frames for 5 s');
    last = now;
  }
}

test('every room change reaches voice peers, preview watchers and account tabs with the same frames', async (t) => {
  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-frames-'));
  t.after(() => fs.rmSync(uploadsDir, { recursive: true, force: true }));
  const { socketPath } = await startApiServer(t, { env: { AUTH_RATE_LIMIT: '0', UPLOADS_DIR: uploadsDir } });

  const ownerCookie = await registerAccount(socketPath, 'frames-owner');
  const kickedCookie = await registerAccount(socketPath, 'frames-kicked');
  const bannedCookie = await registerAccount(socketPath, 'frames-banned');
  const watcherCookie = await registerAccount(socketPath, 'frames-watcher');

  const created = await request(
    socketPath,
    { method: 'POST', pathname: '/api/rooms', cookie: ownerCookie, body: { isStatic: true, name: 'Frames' } },
    RoomCreated
  );
  assert.equal(created.status, 201);
  const { roomId } = created.body;

  const sockets = {
    owner: openWs(socketPath, { cookie: ownerCookie }),
    guest: openWs(socketPath),
    dual: openWs(socketPath),
    kicked: openWs(socketPath, { cookie: kickedCookie }),
    kickedTab: openWs(socketPath, { cookie: kickedCookie }),
    banned: openWs(socketPath, { cookie: bannedCookie }),
    watcher: openWs(socketPath, { cookie: watcherCookie })
  };
  type Name = keyof typeof sockets;
  const names: Name[] = ['owner', 'guest', 'dual', 'kicked', 'kickedTab', 'banned', 'watcher'];
  const sessions = names.map((name) => sockets[name]);
  t.after(() => {
    for (const session of sessions) session.ws.terminate();
  });
  const labels = new Map<string, string>([[roomId, '<room>']]);
  for (const name of names) {
    const ready = await sockets[name].ready;
    if (ready.payload.userId) labels.set(ready.payload.userId, `<user:${name.replace('Tab', '')}>`);
  }

  function normalize(value: unknown, key = ''): unknown {
    if (VOLATILE.has(key) && value !== undefined && value !== null) return `<${typeof value}>`;
    if (key === 'avatarUrl' && typeof value === 'string') return '<avatar>';
    if (typeof value === 'string') return labels.get(value) ?? value;
    if (isArray(value)) return value.map((item) => normalize(item));
    if (isRecord(value)) {
      return Object.fromEntries(Object.entries(value).map(([field, item]) => [field, normalize(item, field)]));
    }
    return value;
  }
  // A peer prints only the fields that differ from PEER_DEFAULTS; `-field` marks one it lacks.
  function peerFields(peer: Record<string, unknown>): string {
    const fields = new Set([...Object.keys(PEER_DEFAULTS), ...Object.keys(peer)]);
    return [...fields]
      .filter((field) => JSON.stringify(peer[field]) !== JSON.stringify(PEER_DEFAULTS[field]))
      .map((field) => (field in peer ? `${field}=${JSON.stringify(peer[field])}` : `-${field}`))
      .join(' ');
  }
  function render(payload: unknown): string {
    const normalized = normalize(payload);
    if (!isRecord(normalized)) return JSON.stringify(normalized);
    return Object.entries(normalized)
      .map(([field, value]) =>
        field === 'peer' && isRecord(value) ? `peer={${peerFields(value)}}` : `${field}=${JSON.stringify(value)}`
      )
      .join(' ');
  }
  function line(frame: ServerFrame): string {
    if (frame.type === 'error') return `${frame.type} ${JSON.stringify(frame.error)}`;
    return `${frame.type} ${render(frame.payload)}`;
  }

  const recorded: Record<string, Partial<Record<Name, string[]>>> = {};
  async function step(name: string, action: () => Promise<unknown> | void): Promise<void> {
    const marks = sessions.map((session) => session.frames.length);
    await action();
    await settle(sessions);
    const frames: Partial<Record<Name, string[]>> = {};
    names.forEach((socket, index) => {
      const seen = sockets[socket].frames
        .slice(marks[index])
        .filter((frame) => ROOM_EVENTS.has(frame.type))
        .map(line);
      if (seen.length > 0) frames[socket] = seen;
    });
    recorded[name] = frames;
  }

  const target = (peerId: string, sessionToken: string) => ({ roomId, peerId, sessionToken });
  const OWNER = target('owner-peer', 'o'.repeat(32));
  const GUEST = target('guest-peer', 'g'.repeat(32));
  const DUAL = target('dual-peer', 'd'.repeat(32));
  const KICKED = target('kicked-peer', 'k'.repeat(32));
  const BANNED = target('banned-peer', 'b'.repeat(32));
  const ownerPost = (pathname: string, body: unknown) =>
    request(socketPath, { method: 'POST', pathname, cookie: ownerCookie, body });

  await step('watcher previews the empty room', () => subscribeRoomPreview(sockets.watcher, roomId));
  await step('owner joins', () => joinVoiceRoom(sockets.owner, { ...OWNER, name: 'Owner' }));
  await step('guest joins', () => joinVoiceRoom(sockets.guest, { ...GUEST, name: 'Guest' }));
  await step('dual previews then joins', async () => {
    await subscribeRoomPreview(sockets.dual, roomId);
    await joinVoiceRoom(sockets.dual, { ...DUAL, name: 'Dual' });
  });
  await step('kicked and banned accounts join', async () => {
    await joinVoiceRoom(sockets.kicked, { ...KICKED, name: 'Kicked' });
    await joinVoiceRoom(sockets.banned, { ...BANNED, name: 'Banned' });
  });
  await step('guest mutes', () => sendWs(sockets.guest.ws, 'room.peer.update', { ...GUEST, patch: { muted: true } }));
  await step('guest unmutes', () =>
    sendWs(sockets.guest.ws, 'room.peer.update', { ...GUEST, patch: { muted: false } })
  );
  await step('guest starts a screen', () =>
    sendWs(sockets.guest.ws, 'room.peer.update', { ...GUEST, patch: { screen: true, screenStreamId: 'stream-1' } })
  );
  await step('dual watches the screen', () =>
    sendWs(sockets.dual.ws, 'room.peer.update', { ...DUAL, patch: { viewedScreenPeerId: GUEST.peerId } })
  );
  await step('guest stops the screen', () =>
    sendWs(sockets.guest.ws, 'room.peer.update', { ...GUEST, patch: { screen: false } })
  );
  await step('guest renames itself', () =>
    sendWs(sockets.guest.ws, 'room.peer.update', { ...GUEST, patch: { name: 'Renamed guest' } })
  );
  await step('kicked account renames its profile', async () => {
    const renamed = await request(socketPath, {
      method: 'POST',
      pathname: '/api/auth/profile',
      cookie: kickedCookie,
      body: { displayName: 'Kicked renamed' }
    });
    assert.equal(renamed.status, 200);
  });
  await step('kicked account uploads an avatar', async () => {
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 10, g: 90, b: 200 } } })
      .png()
      .toBuffer();
    const boundary = '----voice-room-frames-avatar';
    const uploaded = await request(socketPath, {
      method: 'POST',
      pathname: '/api/auth/avatar',
      cookie: kickedCookie,
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      rawBody: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="avatar"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`
        ),
        png,
        Buffer.from(`\r\n--${boundary}--\r\n`)
      ])
    });
    assert.equal(uploaded.status, 200);
  });
  await step('owner server-mutes the banned account', () =>
    ownerPost(`/api/rooms/${roomId}/server-mute`, { peerId: BANNED.peerId, muted: true })
  );
  await step('owner renames the room', async () => {
    const renamed = await request(socketPath, {
      method: 'PUT',
      pathname: `/api/rooms/${roomId}`,
      cookie: ownerCookie,
      body: { name: 'Frames renamed' }
    });
    assert.equal(renamed.status, 200);
  });
  await step('owner kicks an account', async () => {
    const kicked = await ownerPost(`/api/rooms/${roomId}/kick`, { peerId: KICKED.peerId });
    assert.equal(kicked.status, 200);
  });
  await step('owner bans an account', async () => {
    const banned = await ownerPost(`/api/rooms/${roomId}/ban`, { peerId: BANNED.peerId });
    assert.equal(banned.status, 201);
  });
  await step('guest leaves', () => sendWs(sockets.guest.ws, 'room.leave', GUEST));
  await step('owner deletes the room', async () => {
    const deleted = await request(socketPath, {
      method: 'DELETE',
      pathname: `/api/rooms/${roomId}`,
      cookie: ownerCookie
    });
    assert.equal(deleted.status, 200);
  });

  assert.deepEqual(recorded, EXPECTED);
});

// Recorded from the server as it was, quirks included (the kicked and the banned
// socket get their frame twice, the deleting owner hears no peer.left). Only a
// deliberate wire change may edit it.
const EXPECTED: Record<string, Record<string, string[]>> = {
  'watcher previews the empty room': {},
  'owner joins': {
    watcher: [
      'room.peer.joined roomId="<room>" peer={accountUserId="<user:owner>" id="owner-peer" name="frames-owner"}'
    ]
  },
  'guest joins': {
    owner: ['room.peer.joined roomId="<room>" peer={id="guest-peer" name="Guest"}'],
    watcher: ['room.peer.joined roomId="<room>" peer={id="guest-peer" name="Guest"}']
  },
  'dual previews then joins': {
    owner: ['room.peer.joined roomId="<room>" peer={id="dual-peer" name="Dual"}'],
    guest: ['room.peer.joined roomId="<room>" peer={id="dual-peer" name="Dual"}'],
    watcher: ['room.peer.joined roomId="<room>" peer={id="dual-peer" name="Dual"}']
  },
  'kicked and banned accounts join': {
    owner: [
      'room.peer.joined roomId="<room>" peer={accountUserId="<user:kicked>" id="kicked-peer" name="frames-kicked"}',
      'room.peer.joined roomId="<room>" peer={accountUserId="<user:banned>" id="banned-peer" name="frames-banned"}'
    ],
    guest: [
      'room.peer.joined roomId="<room>" peer={accountUserId="<user:kicked>" id="kicked-peer" name="frames-kicked"}',
      'room.peer.joined roomId="<room>" peer={accountUserId="<user:banned>" id="banned-peer" name="frames-banned"}'
    ],
    dual: [
      'room.peer.joined roomId="<room>" peer={accountUserId="<user:kicked>" id="kicked-peer" name="frames-kicked"}',
      'room.peer.joined roomId="<room>" peer={accountUserId="<user:banned>" id="banned-peer" name="frames-banned"}'
    ],
    kicked: [
      'room.peer.joined roomId="<room>" peer={accountUserId="<user:banned>" id="banned-peer" name="frames-banned"}'
    ],
    watcher: [
      'room.peer.joined roomId="<room>" peer={accountUserId="<user:kicked>" id="kicked-peer" name="frames-kicked"}',
      'room.peer.joined roomId="<room>" peer={accountUserId="<user:banned>" id="banned-peer" name="frames-banned"}'
    ]
  },
  'guest mutes': {
    owner: ['room.peer.updated roomId="<room>" peer={id="guest-peer" muted=true name="Guest"}'],
    guest: ['room.peer.updated roomId="<room>" peer={id="guest-peer" muted=true name="Guest"}'],
    dual: ['room.peer.updated roomId="<room>" peer={id="guest-peer" muted=true name="Guest"}'],
    kicked: ['room.peer.updated roomId="<room>" peer={id="guest-peer" muted=true name="Guest"}'],
    banned: ['room.peer.updated roomId="<room>" peer={id="guest-peer" muted=true name="Guest"}'],
    watcher: ['room.peer.updated roomId="<room>" peer={id="guest-peer" muted=true name="Guest"}']
  },
  'guest unmutes': {
    owner: ['room.peer.updated roomId="<room>" peer={id="guest-peer" name="Guest"}'],
    guest: ['room.peer.updated roomId="<room>" peer={id="guest-peer" name="Guest"}'],
    dual: ['room.peer.updated roomId="<room>" peer={id="guest-peer" name="Guest"}'],
    kicked: ['room.peer.updated roomId="<room>" peer={id="guest-peer" name="Guest"}'],
    banned: ['room.peer.updated roomId="<room>" peer={id="guest-peer" name="Guest"}'],
    watcher: ['room.peer.updated roomId="<room>" peer={id="guest-peer" name="Guest"}']
  },
  'guest starts a screen': {
    owner: [
      'room.peer.updated roomId="<room>" peer={id="guest-peer" name="Guest" screen=true screenStreamId="stream-1"}'
    ],
    guest: [
      'room.peer.updated roomId="<room>" peer={id="guest-peer" name="Guest" screen=true screenStreamId="stream-1"}'
    ],
    dual: [
      'room.peer.updated roomId="<room>" peer={id="guest-peer" name="Guest" screen=true screenStreamId="stream-1"}'
    ],
    kicked: [
      'room.peer.updated roomId="<room>" peer={id="guest-peer" name="Guest" screen=true screenStreamId="stream-1"}'
    ],
    banned: [
      'room.peer.updated roomId="<room>" peer={id="guest-peer" name="Guest" screen=true screenStreamId="stream-1"}'
    ],
    watcher: [
      'room.peer.updated roomId="<room>" peer={id="guest-peer" name="Guest" screen=true screenStreamId="stream-1"}'
    ]
  },
  'dual watches the screen': {
    owner: ['room.peer.updated roomId="<room>" peer={id="dual-peer" name="Dual" viewedScreenPeerId="guest-peer"}'],
    guest: ['room.peer.updated roomId="<room>" peer={id="dual-peer" name="Dual" viewedScreenPeerId="guest-peer"}'],
    dual: ['room.peer.updated roomId="<room>" peer={id="dual-peer" name="Dual" viewedScreenPeerId="guest-peer"}'],
    kicked: ['room.peer.updated roomId="<room>" peer={id="dual-peer" name="Dual" viewedScreenPeerId="guest-peer"}'],
    banned: ['room.peer.updated roomId="<room>" peer={id="dual-peer" name="Dual" viewedScreenPeerId="guest-peer"}'],
    watcher: ['room.peer.updated roomId="<room>" peer={id="dual-peer" name="Dual" viewedScreenPeerId="guest-peer"}']
  },
  'guest stops the screen': {
    owner: [
      'room.peer.updated roomId="<room>" peer={id="dual-peer" name="Dual"}',
      'room.peer.updated roomId="<room>" peer={id="guest-peer" name="Guest" screenStreamId="stream-1"}'
    ],
    guest: [
      'room.peer.updated roomId="<room>" peer={id="dual-peer" name="Dual"}',
      'room.peer.updated roomId="<room>" peer={id="guest-peer" name="Guest" screenStreamId="stream-1"}'
    ],
    dual: [
      'room.peer.updated roomId="<room>" peer={id="dual-peer" name="Dual"}',
      'room.peer.updated roomId="<room>" peer={id="guest-peer" name="Guest" screenStreamId="stream-1"}'
    ],
    kicked: [
      'room.peer.updated roomId="<room>" peer={id="dual-peer" name="Dual"}',
      'room.peer.updated roomId="<room>" peer={id="guest-peer" name="Guest" screenStreamId="stream-1"}'
    ],
    banned: [
      'room.peer.updated roomId="<room>" peer={id="dual-peer" name="Dual"}',
      'room.peer.updated roomId="<room>" peer={id="guest-peer" name="Guest" screenStreamId="stream-1"}'
    ],
    watcher: [
      'room.peer.updated roomId="<room>" peer={id="dual-peer" name="Dual"}',
      'room.peer.updated roomId="<room>" peer={id="guest-peer" name="Guest" screenStreamId="stream-1"}'
    ]
  },
  'guest renames itself': {
    owner: ['room.peer.updated roomId="<room>" peer={id="guest-peer" name="Renamed guest" screenStreamId="stream-1"}'],
    guest: ['room.peer.updated roomId="<room>" peer={id="guest-peer" name="Renamed guest" screenStreamId="stream-1"}'],
    dual: ['room.peer.updated roomId="<room>" peer={id="guest-peer" name="Renamed guest" screenStreamId="stream-1"}'],
    kicked: ['room.peer.updated roomId="<room>" peer={id="guest-peer" name="Renamed guest" screenStreamId="stream-1"}'],
    banned: ['room.peer.updated roomId="<room>" peer={id="guest-peer" name="Renamed guest" screenStreamId="stream-1"}'],
    watcher: ['room.peer.updated roomId="<room>" peer={id="guest-peer" name="Renamed guest" screenStreamId="stream-1"}']
  },
  'kicked account renames its profile': {
    owner: [
      'room.peer.updated roomId="<room>" peer={accountUserId="<user:kicked>" id="kicked-peer" name="Kicked renamed"}'
    ],
    guest: [
      'room.peer.updated roomId="<room>" peer={accountUserId="<user:kicked>" id="kicked-peer" name="Kicked renamed"}'
    ],
    dual: [
      'room.peer.updated roomId="<room>" peer={accountUserId="<user:kicked>" id="kicked-peer" name="Kicked renamed"}'
    ],
    kicked: [
      'room.peer.updated roomId="<room>" peer={accountUserId="<user:kicked>" id="kicked-peer" name="Kicked renamed"}'
    ],
    banned: [
      'room.peer.updated roomId="<room>" peer={accountUserId="<user:kicked>" id="kicked-peer" name="Kicked renamed"}'
    ],
    watcher: [
      'room.peer.updated roomId="<room>" peer={accountUserId="<user:kicked>" id="kicked-peer" name="Kicked renamed"}'
    ]
  },
  'kicked account uploads an avatar': {
    owner: [
      'room.peer.updated roomId="<room>" peer={accountUserId="<user:kicked>" avatarAccent="#193c71" avatarUrl="<avatar>" id="kicked-peer" name="Kicked renamed"}'
    ],
    guest: [
      'room.peer.updated roomId="<room>" peer={accountUserId="<user:kicked>" avatarAccent="#193c71" avatarUrl="<avatar>" id="kicked-peer" name="Kicked renamed"}'
    ],
    dual: [
      'room.peer.updated roomId="<room>" peer={accountUserId="<user:kicked>" avatarAccent="#193c71" avatarUrl="<avatar>" id="kicked-peer" name="Kicked renamed"}'
    ],
    kicked: [
      'room.peer.updated roomId="<room>" peer={accountUserId="<user:kicked>" avatarAccent="#193c71" avatarUrl="<avatar>" id="kicked-peer" name="Kicked renamed"}'
    ],
    banned: [
      'room.peer.updated roomId="<room>" peer={accountUserId="<user:kicked>" avatarAccent="#193c71" avatarUrl="<avatar>" id="kicked-peer" name="Kicked renamed"}'
    ],
    watcher: [
      'room.peer.updated roomId="<room>" peer={accountUserId="<user:kicked>" avatarAccent="#193c71" avatarUrl="<avatar>" id="kicked-peer" name="Kicked renamed"}'
    ]
  },
  'owner server-mutes the banned account': {
    owner: [
      'room.peer.updated roomId="<room>" peer={accountUserId="<user:banned>" id="banned-peer" muted=true name="frames-banned" serverMuted=true}'
    ],
    guest: [
      'room.peer.updated roomId="<room>" peer={accountUserId="<user:banned>" id="banned-peer" muted=true name="frames-banned" serverMuted=true}'
    ],
    dual: [
      'room.peer.updated roomId="<room>" peer={accountUserId="<user:banned>" id="banned-peer" muted=true name="frames-banned" serverMuted=true}'
    ],
    kicked: [
      'room.peer.updated roomId="<room>" peer={accountUserId="<user:banned>" id="banned-peer" muted=true name="frames-banned" serverMuted=true}'
    ],
    banned: [
      'room.peer.updated roomId="<room>" peer={accountUserId="<user:banned>" id="banned-peer" muted=true name="frames-banned" serverMuted=true}'
    ],
    watcher: [
      'room.peer.updated roomId="<room>" peer={accountUserId="<user:banned>" id="banned-peer" muted=true name="frames-banned" serverMuted=true}'
    ]
  },
  'owner renames the room': {
    owner: [
      'room.updated room={"avatarUrl":null,"createdAt":"<number>","isStatic":true,"name":"Frames renamed","peers":5,"relationship":"owner","roomId":"<room>","emptySince":null}'
    ],
    guest: [
      'room.updated room={"avatarUrl":null,"createdAt":"<number>","isStatic":true,"name":"Frames renamed","peers":5,"relationship":"owner","roomId":"<room>","emptySince":null}'
    ],
    dual: [
      'room.updated room={"avatarUrl":null,"createdAt":"<number>","isStatic":true,"name":"Frames renamed","peers":5,"relationship":"owner","roomId":"<room>","emptySince":null}'
    ],
    kicked: [
      'room.updated room={"avatarUrl":null,"createdAt":"<number>","isStatic":true,"name":"Frames renamed","peers":5,"relationship":"owner","roomId":"<room>","emptySince":null}'
    ],
    banned: [
      'room.updated room={"avatarUrl":null,"createdAt":"<number>","isStatic":true,"name":"Frames renamed","peers":5,"relationship":"owner","roomId":"<room>","emptySince":null}'
    ],
    watcher: [
      'room.updated room={"avatarUrl":null,"createdAt":"<number>","isStatic":true,"name":"Frames renamed","peers":5,"relationship":"owner","roomId":"<room>","emptySince":null}'
    ]
  },
  'owner kicks an account': {
    owner: ['room.peer.left roomId="<room>" peerId="kicked-peer" reason="kicked"'],
    guest: ['room.peer.left roomId="<room>" peerId="kicked-peer" reason="kicked"'],
    dual: ['room.peer.left roomId="<room>" peerId="kicked-peer" reason="kicked"'],
    kicked: ['room.kicked roomId="<room>" peerId="kicked-peer"', 'room.kicked roomId="<room>" peerId="kicked-peer"'],
    kickedTab: ['room.kicked roomId="<room>" peerId="kicked-peer"'],
    banned: ['room.peer.left roomId="<room>" peerId="kicked-peer" reason="kicked"'],
    watcher: ['room.peer.left roomId="<room>" peerId="kicked-peer" reason="kicked"']
  },
  'owner bans an account': {
    owner: ['room.peer.left roomId="<room>" peerId="banned-peer" reason="banned"'],
    guest: ['room.peer.left roomId="<room>" peerId="banned-peer" reason="banned"'],
    dual: ['room.peer.left roomId="<room>" peerId="banned-peer" reason="banned"'],
    banned: ['room.banned roomId="<room>" peerId="banned-peer"', 'room.banned roomId="<room>" peerId="banned-peer"'],
    watcher: ['room.peer.left roomId="<room>" peerId="banned-peer" reason="banned"']
  },
  'guest leaves': {
    owner: ['room.peer.left roomId="<room>" peerId="guest-peer" reason="left"'],
    dual: ['room.peer.left roomId="<room>" peerId="guest-peer" reason="left"'],
    watcher: ['room.peer.left roomId="<room>" peerId="guest-peer" reason="left"']
  },
  'owner deletes the room': {
    owner: ['room.deleted roomId="<room>"'],
    dual: ['room.deleted roomId="<room>"', 'room.peer.left roomId="<room>" peerId="owner-peer" reason="deleted"'],
    watcher: [
      'room.deleted roomId="<room>"',
      'room.peer.left roomId="<room>" peerId="owner-peer" reason="deleted"',
      'room.peer.left roomId="<room>" peerId="dual-peer" reason="deleted"'
    ]
  }
};
