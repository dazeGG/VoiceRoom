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

test('only the newest overlapping resync may replace the open thread', async () => {
  const { createDmThreadResyncCoordinator } = await loadCoordinator();
  const firstRequest = deferred();
  const secondRequest = deferred();
  const requests = [firstRequest, secondRequest];
  const applied = [];
  const coordinator = createDmThreadResyncCoordinator({
    fetchSnapshot: () => requests.shift().promise,
    isCurrent: () => true,
    applySnapshot: (_peerId, snapshot) => applied.push(snapshot.messages.map((entry) => entry.id)),
    isOwnMessage: (entry) => entry.senderId === 'self'
  });

  const first = coordinator.resync('peer');
  coordinator.recordDelete('peer', 'deleted-before-overlap');
  const second = coordinator.resync('peer');
  coordinator.recordUpsert('peer', message('during-overlap'));

  secondRequest.resolve({
    peer: peer(),
    messages: [message('newest-http'), message('deleted-before-overlap')]
  });
  await second;
  firstRequest.resolve({ peer: peer(), messages: [message('stale-http')] });
  await first;

  assert.deepEqual(applied, [['newest-http', 'during-overlap']]);
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
