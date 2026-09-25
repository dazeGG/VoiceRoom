import { test } from 'vitest';
import { freshImport } from './helpers/fresh-module.ts';
import type * as DmThreadResync from '../src/lib/features/home/model/dm-thread-resync.ts';
import assert from 'node:assert/strict';

async function loadCoordinator() {
  return freshImport<typeof DmThreadResync>('/src/lib/features/home/model/dm-thread-resync.ts');
}

type Snapshot = Parameters<Parameters<typeof DmThreadResync.createDmThreadResyncCoordinator>[0]['applySnapshot']>[1];
// The fixtures carry only the fields the coordinator reads.
type FakeSnapshot = { peer: ReturnType<typeof peer>; messages: Array<ReturnType<typeof message>> };

function deferred() {
  let resolve = (_snapshot: FakeSnapshot) => {};
  let reject = (_error: unknown) => {};
  const promise = new Promise<Snapshot>((resolvePromise, rejectPromise) => {
    resolve = (snapshot) => resolvePromise(snapshot as unknown as Snapshot);
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function message(
  id: string,
  overrides: {
    senderId?: string;
    recipientId?: string;
    body?: string;
    createdAt?: number;
    editedAt?: number | null;
    readAt?: number | null;
  } = {}
) {
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
  let applied = undefined as Snapshot | undefined;
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
  assert.ok(applied);

  assert.deepEqual(
    applied.messages.map((entry) => entry.id),
    ['edited', 'own-unread', 'new']
  );
  assert.equal(applied.messages.find((entry) => entry.id === 'edited')?.body, 'edited now');
  assert.equal(applied.messages.find((entry) => entry.id === 'own-unread')?.readAt, 9);
});

test('keeps a newer HTTP message version and independently preserves the newest read marker', async () => {
  const { createDmThreadResyncCoordinator } = await loadCoordinator();
  const request = deferred();
  let applied = undefined as Snapshot | undefined;
  const coordinator = createDmThreadResyncCoordinator({
    fetchSnapshot: () => request.promise,
    isCurrent: () => true,
    applySnapshot: (_peerId, snapshot) => {
      applied = snapshot;
    },
    isOwnMessage: (entry) => entry.senderId === 'self'
  });

  const resync = coordinator.resync('peer');
  coordinator.recordUpsert('peer', message('server-newer', { body: 'stale buffered body', editedAt: 5, readAt: 7 }));
  coordinator.recordUpsert('peer', message('event-newer', { body: 'new realtime body', editedAt: 6, readAt: 10 }));
  request.resolve({
    peer: peer(),
    messages: [
      message('server-newer', { body: 'new HTTP body', editedAt: 10, readAt: 20 }),
      message('event-newer', { body: 'old HTTP body', editedAt: 4, readAt: 20 })
    ]
  });
  await resync;
  assert.ok(applied);

  const serverNewer = applied.messages.find((entry) => entry.id === 'server-newer');
  assert.ok(serverNewer);
  assert.equal(serverNewer.body, 'new HTTP body');
  assert.equal(serverNewer.editedAt, 10);
  assert.equal(serverNewer.readAt, 20);
  const eventNewer = applied.messages.find((entry) => entry.id === 'event-newer');
  assert.ok(eventNewer);
  assert.equal(eventNewer.body, 'new realtime body');
  assert.equal(eventNewer.editedAt, 6);
  assert.equal(eventNewer.readAt, 20);
});

test('coalesces overlapping same-peer resync calls onto one successful request', async () => {
  const { createDmThreadResyncCoordinator } = await loadCoordinator();
  const request = deferred();
  let fetchCount = 0;
  const applied: unknown[] = [];
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

test('queues a forced reconnect behind an active fetch and keeps one logical promise', async () => {
  const { createDmThreadResyncCoordinator } = await loadCoordinator();
  const firstRequest = deferred();
  const reconnectRequest = deferred();
  const requests = [firstRequest, reconnectRequest];
  let fetchCount = 0;
  const applied: unknown[] = [];
  const coordinator = createDmThreadResyncCoordinator({
    fetchSnapshot: () => {
      fetchCount += 1;
      return requests.shift()?.promise ?? Promise.reject(new Error('no request left'));
    },
    isCurrent: () => true,
    applySnapshot: (_peerId, snapshot) => applied.push(snapshot.messages.map((entry) => entry.id)),
    isOwnMessage: (entry) => entry.senderId === 'self'
  });

  const initial = coordinator.resync('peer');
  coordinator.recordUpsert('peer', message('buffered-before-reconnect', { createdAt: 3 }));
  const reconnect = coordinator.resync('peer', { force: true });
  let settled = false;
  void initial.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    }
  );

  assert.equal(initial, reconnect);
  assert.equal(fetchCount, 1);
  firstRequest.resolve({ peer: peer(), messages: [message('stale-http')] });
  await new Promise(setImmediate);

  assert.equal(fetchCount, 2);
  assert.deepEqual(applied, []);
  assert.equal(settled, false);
  reconnectRequest.resolve({ peer: peer(), messages: [message('fresh-http')] });
  await initial;

  assert.equal(settled, true);
  assert.deepEqual(applied, [['fresh-http', 'buffered-before-reconnect']]);
});

test('queued reconnect recovers when the initial request rejects', async () => {
  const { createDmThreadResyncCoordinator } = await loadCoordinator();
  const firstRequest = deferred();
  const reconnectRequest = deferred();
  const requests = [firstRequest, reconnectRequest];
  let fetchCount = 0;
  const applied: unknown[] = [];
  const coordinator = createDmThreadResyncCoordinator({
    fetchSnapshot: () => {
      fetchCount += 1;
      return requests.shift()?.promise ?? Promise.reject(new Error('no request left'));
    },
    isCurrent: () => true,
    applySnapshot: (_peerId, snapshot) => applied.push(snapshot.messages.map((entry) => entry.id)),
    isOwnMessage: (entry) => entry.senderId === 'self'
  });

  const initial = coordinator.resync('peer');
  const reconnect = coordinator.resync('peer', { force: true });
  assert.equal(initial, reconnect);
  firstRequest.reject(new Error('initial fetch failed'));
  await new Promise(setImmediate);

  assert.equal(fetchCount, 2);
  reconnectRequest.resolve({ peer: peer(), messages: [message('fresh-after-failure')] });
  await initial;

  assert.deepEqual(applied, [['fresh-after-failure']]);
});

test('uses a successful initial snapshot as fallback when the queued reconnect fails', async () => {
  const { createDmThreadResyncCoordinator } = await loadCoordinator();
  const firstRequest = deferred();
  const reconnectRequest = deferred();
  const requests = [firstRequest, reconnectRequest];
  let fetchCount = 0;
  const applied: unknown[] = [];
  const coordinator = createDmThreadResyncCoordinator({
    fetchSnapshot: () => {
      fetchCount += 1;
      return requests.shift()?.promise ?? Promise.reject(new Error('no request left'));
    },
    isCurrent: () => true,
    applySnapshot: (_peerId, snapshot) => applied.push(snapshot.messages.map((entry) => entry.id)),
    isOwnMessage: (entry) => entry.senderId === 'self'
  });

  const initial = coordinator.resync('peer');
  coordinator.recordDelete('peer', 'deleted-before-reconnect');
  const reconnect = coordinator.resync('peer', { force: true });
  firstRequest.resolve({
    peer: peer(),
    messages: [message('fallback-http'), message('deleted-before-reconnect')]
  });
  await new Promise(setImmediate);

  assert.equal(initial, reconnect);
  assert.equal(fetchCount, 2);
  assert.deepEqual(applied, []);
  reconnectRequest.reject(new Error('reconnect fetch failed'));
  await initial;

  assert.deepEqual(applied, [['fallback-http']]);
});

test('a different-peer request invalidates an older response even if its peer becomes current again', async () => {
  const { createDmThreadResyncCoordinator } = await loadCoordinator();
  const firstRequest = deferred();
  const secondRequest = deferred();
  let activePeerId = 'first';
  const applied: unknown[] = [];
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
