import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

async function loadCoordinator() {
  const source = readFileSync(new URL('../src/lib/features/home/model/dm-thread-resync.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true
    },
    fileName: 'dm-thread-resync.ts'
  }).outputText;
  const dir = mkdtempSync(join(tmpdir(), 'voice-room-dm-thread-resync-'));
  const file = join(dir, 'dm-thread-resync.mjs');
  writeFileSync(file, output);
  try {
    return await import(`${pathToFileURL(file).href}?v=${Date.now()}-${Math.random()}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function message(id, overrides = {}) {
  return {
    id,
    senderId: overrides.senderId ?? 'peer',
    recipientId: overrides.recipientId ?? 'self',
    body: overrides.body ?? id,
    createdAt: overrides.createdAt ?? 1,
    editedAt: overrides.editedAt ?? null,
    readAt: overrides.readAt ?? null
  };
}

function peer(id = 'peer') {
  return { id, login: id, displayName: id, avatarUrl: null };
}

test('replays realtime message, edit, delete, and read mutations over a delayed HTTP snapshot', async () => {
  const { createDmThreadResyncCoordinator } = await loadCoordinator();
  const request = deferred();
  let applied;
  const coordinator = createDmThreadResyncCoordinator({
    fetchSnapshot: () => request.promise,
    isCurrent: () => true,
    applySnapshot: (_peerId, snapshot) => {
      applied = snapshot;
    },
    isOwnMessage: (entry) => entry.senderId === 'self'
  });

  const resync = coordinator.resync('peer');
  coordinator.recordUpsert('peer', message('new', { createdAt: 4 }));
  coordinator.recordUpsert('peer', message('edited', { body: 'edited now', editedAt: 5, createdAt: 2 }));
  coordinator.recordDelete('peer', 'deleted');
  coordinator.recordRead('peer', 9);
  request.resolve({
    peer: peer(),
    messages: [
      message('edited', { body: 'old body', createdAt: 2 }),
      message('deleted', { createdAt: 3 }),
      message('own-unread', { senderId: 'self', recipientId: 'peer', createdAt: 1 })
    ]
  });
  await resync;

  assert.deepEqual(applied.messages.map((entry) => entry.id), ['edited', 'own-unread', 'new']);
  assert.equal(applied.messages.find((entry) => entry.id === 'edited').body, 'edited now');
  assert.equal(applied.messages.find((entry) => entry.id === 'own-unread').readAt, 9);
});

test('keeps a newer HTTP message version and independently preserves the newest read marker', async () => {
  const { createDmThreadResyncCoordinator } = await loadCoordinator();
  const request = deferred();
  let applied;
  const coordinator = createDmThreadResyncCoordinator({
    fetchSnapshot: () => request.promise,
    isCurrent: () => true,
    applySnapshot: (_peerId, snapshot) => {
      applied = snapshot;
    },
    isOwnMessage: (entry) => entry.senderId === 'self'
  });

  const resync = coordinator.resync('peer');
  coordinator.recordUpsert(
    'peer',
    message('server-newer', { body: 'stale buffered body', editedAt: 5, readAt: 7 })
  );
  coordinator.recordUpsert(
    'peer',
    message('event-newer', { body: 'new realtime body', editedAt: 6, readAt: 10 })
  );
  request.resolve({
    peer: peer(),
    messages: [
      message('server-newer', { body: 'new HTTP body', editedAt: 10, readAt: 20 }),
      message('event-newer', { body: 'old HTTP body', editedAt: 4, readAt: 20 })
    ]
  });
  await resync;

  const serverNewer = applied.messages.find((entry) => entry.id === 'server-newer');
  assert.equal(serverNewer.body, 'new HTTP body');
  assert.equal(serverNewer.editedAt, 10);
  assert.equal(serverNewer.readAt, 20);
  const eventNewer = applied.messages.find((entry) => entry.id === 'event-newer');
  assert.equal(eventNewer.body, 'new realtime body');
  assert.equal(eventNewer.editedAt, 6);
  assert.equal(eventNewer.readAt, 20);
});

test('coalesces overlapping same-peer resync calls onto one successful request', async () => {
  const { createDmThreadResyncCoordinator } = await loadCoordinator();
  const request = deferred();
  let fetchCount = 0;
  const applied = [];
  const coordinator = createDmThreadResyncCoordinator({
    fetchSnapshot: () => {
      fetchCount += 1;
      if (fetchCount > 1) return Promise.reject(new Error('newer overlapping fetch failed'));
      return request.promise;
    },
    isCurrent: () => true,
    applySnapshot: (_peerId, snapshot) => applied.push(snapshot.messages.map((entry) => entry.id)),
    isOwnMessage: (entry) => entry.senderId === 'self'
  });

  const first = coordinator.resync('peer');
  const second = coordinator.resync('peer');
  coordinator.recordUpsert('peer', message('during-overlap'));

  assert.equal(first, second);
  assert.equal(fetchCount, 1);
  request.resolve({ peer: peer(), messages: [message('http')] });
  await Promise.all([first, second]);

  assert.deepEqual(applied, [['http', 'during-overlap']]);
});

test('a different-peer request invalidates an older response even if its peer becomes current again', async () => {
  const { createDmThreadResyncCoordinator } = await loadCoordinator();
  const firstRequest = deferred();
  const secondRequest = deferred();
  let activePeerId = 'first';
  const applied = [];
  const coordinator = createDmThreadResyncCoordinator({
    fetchSnapshot: (peerId) => (peerId === 'first' ? firstRequest.promise : secondRequest.promise),
    isCurrent: (peerId) => activePeerId === peerId,
    applySnapshot: (peerId) => applied.push(peerId),
    isOwnMessage: (entry) => entry.senderId === 'self'
  });

  const first = coordinator.resync('first');
  activePeerId = 'second';
  const second = coordinator.resync('second');
  activePeerId = 'first';
  firstRequest.resolve({ peer: peer('first'), messages: [message('stale')] });
  await first;
  activePeerId = 'second';
  secondRequest.resolve({ peer: peer('second'), messages: [message('current')] });
  await second;

  assert.deepEqual(applied, ['second']);
});

test('ignores a delayed initial load after the active peer changes', async () => {
  const { createDmThreadResyncCoordinator } = await loadCoordinator();
  const request = deferred();
  let activePeerId = 'peer';
  let applied = false;
  const coordinator = createDmThreadResyncCoordinator({
    fetchSnapshot: () => request.promise,
    isCurrent: (peerId) => activePeerId === peerId,
    applySnapshot: () => {
      applied = true;
    },
    isOwnMessage: (entry) => entry.senderId === 'self'
  });

  const initialLoad = coordinator.resync('peer');
  activePeerId = 'other-peer';
  request.resolve({ peer: peer(), messages: [message('stale')] });
  await initialLoad;

  assert.equal(applied, false);
});

test('invalidate prevents a delayed request from applying', async () => {
  const { createDmThreadResyncCoordinator } = await loadCoordinator();
  const request = deferred();
  let applied = false;
  const coordinator = createDmThreadResyncCoordinator({
    fetchSnapshot: () => request.promise,
    isCurrent: () => true,
    applySnapshot: () => {
      applied = true;
    },
    isOwnMessage: (entry) => entry.senderId === 'self'
  });

  const resync = coordinator.resync('peer');
  coordinator.invalidate();
  request.resolve({ peer: peer(), messages: [message('stale')] });
  await resync;

  assert.equal(applied, false);
});

test('lobby forwards DM realtime mutations to the active resync buffer', () => {
  const friends = readFileSync(new URL('../src/lib/features/home/model/friends.svelte.ts', import.meta.url), 'utf8');

  const openDmStart = friends.indexOf('export async function openDm');
  const openDmEnd = friends.indexOf('\nasync function resyncOpenThread', openDmStart);
  const openDm = friends.slice(openDmStart, openDmEnd);
  assert.match(openDm, /await threadResync\.resync\(userId\)/);
  assert.doesNotMatch(openDm, /fetchThread\(/);
  assert.match(openDm, /finally \{[\s\S]*friendsState\.selectedFriendId === userId[\s\S]*threadLoading = false/);

  assert.match(friends, /case 'dm\.message': \{[\s\S]*?threadResync\.recordUpsert\(peerId, message\)/);
  assert.match(friends, /case 'dm\.read': \{[\s\S]*?threadResync\.recordRead\(event\.payload\.userId, now\)/);
  assert.match(friends, /case 'dm\.message\.deleted': \{[\s\S]*?threadResync\.recordDelete\(peerId, mid\)/);
  assert.match(friends, /case 'dm\.message\.edited': \{[\s\S]*?threadResync\.recordUpsert\(peerId, message\)/);
});
