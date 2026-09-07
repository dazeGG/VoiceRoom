// Cross-slice event-name contract for shared music.
//
// This file exists because of a real near-miss. The web listened for
// `room.music.session`; the API emitted `room.music.state` and
// `room.music.position`. Both slices' suites were green, because each asserted
// against its own constant and mocked the other side. The result would have been
// the exact silent room this feature is designed to avoid: every state update
// dropped on the floor, no error raised anywhere.
//
// So the assertions below deliberately do NOT go through either side's constant.
// They hard-code the strings that are the actual contract, and then check both
// the producer (apps/api) and the consumer (apps/web) against them. A rename on
// either side fails here, loudly.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const repoRoot = resolve(root, '..', '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const readRepo = (path) => readFileSync(resolve(repoRoot, path), 'utf8');

// The contract. Written out, not imported: a constant imported from one side
// cannot detect that side drifting.
const MUSIC_STATE_EVENT = 'room.music.state';
const MUSIC_POSITION_EVENT = 'room.music.position';
const MUSIC_SERVER_EVENTS = [MUSIC_STATE_EVENT, MUSIC_POSITION_EVENT];
const MUSIC_CLIENT_COMMANDS = [
  'room.music.enqueue',
  'room.music.remove',
  'room.music.skip',
  'room.music.stop'
];

const API_SESSION_SERVICE = 'apps/api/src/domains/music/music-session-service.js';
const API_ROOM_RUNTIME = 'apps/api/src/realtime/room-runtime.js';
const WEB_ROOM = 'src/lib/features/room/client/room/room.ts';
const WEB_REALTIME = 'src/lib/api/realtime.ts';
const WEB_STORE = 'src/lib/features/room/room-music.svelte.ts';

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

/** Every `room.music.*` string literal in a source file. */
function musicLiterals(source) {
  return sortedUnique([...source.matchAll(/'(room\.music\.[a-z.]+)'/g)].map((match) => match[1]));
}

test('the API emits exactly the two server events the web listens for', () => {
  const api = readRepo(API_SESSION_SERVICE);

  // Producer side: the constants the API publishes under.
  assert.match(api, new RegExp(`const MUSIC_STATE_EVENT = '${MUSIC_STATE_EVENT}';`));
  assert.match(api, new RegExp(`const MUSIC_POSITION_EVENT = '${MUSIC_POSITION_EVENT}';`));

  // Consumer side: the branches the web actually dispatches on.
  const handled = sortedUnique(
    [...read(WEB_ROOM).matchAll(/event\.type === '(room\.music\.[a-z.]+)'/g)].map((match) => match[1])
  );
  assert.deepEqual(handled, sortedUnique(MUSIC_SERVER_EVENTS));
});

test('each server event is routed to its own handler, not through one session path', () => {
  const room = read(WEB_ROOM);

  const stateBranch = room.slice(room.indexOf(`event.type === '${MUSIC_STATE_EVENT}'`));
  assert.match(stateBranch.slice(0, 200), /applyRoomMusicState\(event\.payload\)/);

  const positionBranch = room.slice(room.indexOf(`event.type === '${MUSIC_POSITION_EVENT}'`));
  assert.match(positionBranch.slice(0, 200), /applyRoomMusicPosition\(event\.payload\)/);

  // The 2s heartbeat must not rebuild the session: that is the whole reason the
  // position event is separate from the state event.
  const store = read(WEB_STORE);
  const applyPosition = store.slice(
    store.indexOf('export function applyRoomMusicPosition'),
    store.indexOf('// --- Local listening preferences')
  );
  assert.doesNotMatch(applyPosition, /readSession|buildMusicSession/);
  assert.match(applyPosition, /sessionEpoch/);
  assert.match(applyPosition, /itemId/);
});

test('the realtime event union declares the same two events and nothing else', () => {
  const declared = sortedUnique(
    [...read(WEB_REALTIME).matchAll(/type: '(room\.music\.[a-z.]+)';/g)].map((match) => match[1])
  );
  assert.deepEqual(declared, sortedUnique(MUSIC_SERVER_EVENTS));
});

test('no web source still references a music event the API never emits', () => {
  const known = new Set([...MUSIC_SERVER_EVENTS, ...MUSIC_CLIENT_COMMANDS]);
  for (const path of [WEB_ROOM, WEB_REALTIME, WEB_STORE]) {
    for (const literal of musicLiterals(read(path))) {
      assert.ok(known.has(literal), `${path} references unknown music event ${literal}`);
    }
  }
  // The name this contract test was written for: it must be gone everywhere.
  for (const path of [WEB_ROOM, WEB_REALTIME, WEB_STORE]) {
    assert.doesNotMatch(read(path), /room\.music\.session/);
  }
});

test('client command names match the frozen shared list on both sides', async () => {
  const shared = await import('@voice-room/shared/room-music');
  assert.deepEqual(sortedUnique(shared.MUSIC_CLIENT_COMMAND_TYPES), sortedUnique(MUSIC_CLIENT_COMMANDS));

  // The client→server direction needs no field-name guard of its own, and this
  // is why: every field the server reads comes back out of `normalizeMusicCommand`
  // — the same shared function the web builds the frame with — and the room comes
  // from the connection's own peer record, not from the payload. So there is no
  // pair of independently-written field names to drift, unlike the server→client
  // payloads guarded above. (The `roomId` the web sends is ignored by the music
  // branch; it is kept only for consistency with the sibling room commands.)
  //
  // The web builds every frame through `normalizeMusicCommand`, so the command
  // type it sends is the shared constant's, never a hand-written string.
  const realtime = read(WEB_REALTIME);
  const wrappers = realtime.slice(realtime.indexOf('// --- Shared music commands'));
  for (const command of MUSIC_CLIENT_COMMANDS) {
    assert.match(wrappers, new RegExp(`normalizeMusicCommand\\('${command}'`));
  }
  assert.match(wrappers, /const \{ type, \.\.\.payload \} = command/);
});

test('the snapshot siblings the API sets are the ones the web reads', () => {
  const runtime = readRepo(API_ROOM_RUNTIME);
  const store = read(WEB_STORE);

  // These three are siblings of `music`, not members of it: normalizeMusicSession
  // would strip an unknown key from the session object.
  for (const field of ['music', 'musicBotIdentity', 'musicIsMaster']) {
    assert.match(runtime, new RegExp(`snapshot\\.${field} =`), `API never sets snapshot.${field}`);
    assert.match(store, new RegExp(`snapshot\\.${field}\\b`), `web never reads snapshot.${field}`);
  }

  // Master status is the server's answer, never re-derived on the client: a
  // client-side owner mirror can drift from the server's permission check.
  assert.match(store, /roomMusic\.isMaster = Boolean\(snapshot\.musicIsMaster\)/);
  assert.doesNotMatch(store, /roomSettingsUi/);
});

test('the bot identity rides on both server events, not only the snapshot', () => {
  const api = readRepo(API_SESSION_SERVICE);
  const store = read(WEB_STORE);

  // The bot can leave the room on its own initiative — a 409/410 on a callback,
  // or five unacknowledged heartbeats — so a `null` identity has to be able to
  // arrive on either event and tear the lane down.
  const stateEmit = api.slice(api.indexOf('publish(state.roomId, MUSIC_STATE_EVENT'));
  const positionEmit = api.slice(api.indexOf('publish(state.roomId, MUSIC_POSITION_EVENT'));
  assert.match(stateEmit.slice(0, 300), /musicBotIdentity/);
  assert.match(positionEmit.slice(0, 300), /musicBotIdentity/);

  for (const handler of ['applyRoomMusicState', 'applyRoomMusicPosition']) {
    const body = store.slice(store.indexOf(`export function ${handler}`));
    assert.match(
      body.slice(0, 900),
      /setMusicBotIdentity\(readBotIdentity\(payload\.musicBotIdentity\)\)/,
      `${handler} does not honour musicBotIdentity`
    );
  }
});

// The payload field names, one level below the event names.
//
// Guarding the event name only proves the envelope matches. The fields inside it
// were still two independent guesses agreeing by luck: the API's own tests read
// its internal state object rather than the emitted payload, and the web's tests
// build their own fixtures, so a rename on either side changed one and not the
// other. `music` → `session` is the original bug exactly — `readSession(undefined)`
// leaves the player idle forever while the bot plays, with no error anywhere.
const MUSIC_EVENT_FIELDS = {
  MUSIC_STATE_EVENT: ['roomId', 'music', 'musicBotIdentity'],
  MUSIC_POSITION_EVENT: ['roomId', 'musicBotIdentity', 'sessionEpoch', 'itemId', 'positionMs', 'positionAt']
};

/** The object literal the API publishes for one event constant. */
function publishBlock(api, constantName) {
  const start = api.indexOf(`publish(state.roomId, ${constantName}`);
  assert.notEqual(start, -1, `API never publishes ${constantName}`);
  const end = api.indexOf('});', start);
  assert.notEqual(end, -1, `unterminated publish block for ${constantName}`);
  return api.slice(start, end);
}

test('every payload field the API emits is read under the same name by the web', () => {
  const api = readRepo(API_SESSION_SERVICE);
  const store = read(WEB_STORE);
  const readers = {
    MUSIC_STATE_EVENT: store.slice(store.indexOf('export function applyRoomMusicState'), store.indexOf('/**\n * Applies a `room.music.position`')),
    MUSIC_POSITION_EVENT: store.slice(store.indexOf('export function applyRoomMusicPosition'), store.indexOf('// --- Local listening preferences'))
  };

  for (const [constantName, fields] of Object.entries(MUSIC_EVENT_FIELDS)) {
    const emitted = publishBlock(api, constantName);
    for (const field of fields) {
      assert.match(emitted, new RegExp(`^\\s*${field}:`, 'm'), `API does not emit ${field} on ${constantName}`);
      assert.match(readers[constantName], new RegExp(`payload\\.${field}\\b`), `web does not read payload.${field} for ${constantName}`);
    }
  }
});

test('position staleness comes from the shared contract, never from a local literal', () => {
  const store = read(WEB_STORE);
  const panel = read('src/lib/features/room/components/RoomMusicPanel.svelte');

  assert.match(store, /isMusicPositionStale/);
  assert.match(store, /from '@voice-room\/shared\/room-music'/);
  // AC-10 authority is the bot's heartbeat via `positionAt`, not a wall clock
  // difference, and the 6000ms window is the shared module's to own.
  assert.doesNotMatch(`${store}\n${panel}`, /\b6000\b|MUSIC_POSITION_STALE_MS\s*=/);
  assert.doesNotMatch(`${store}\n${panel}`, /now\s*-\s*startedAt/);
});
