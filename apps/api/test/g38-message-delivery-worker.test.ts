import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  DeliveryLease,
  OutboxEvent,
  createMessageOutboxRepository
} from '../src/domains/messaging/message-outbox-repository.ts';
import { LEASE_IDENTITY, createMessageDeliveryWorker } from '../src/workers/message-delivery.ts';
import { fake } from './fakes/index.ts';

type MessageOutbox = ReturnType<typeof createMessageOutboxRepository>;

test('G38-A01 the worker claims under its own lease identity', () => {
  assert.equal(LEASE_IDENTITY, 'message-delivery.G38');
});

test('G38-A02 one claimed event is delivered and committed under its fencing token', async () => {
  const delivered = Promise.withResolvers<void>();
  let claimed = false;
  let marked: { eventId: string; lease: DeliveryLease } | undefined;
  const event: OutboxEvent = {
    eventId: 'e',
    logicalKey: 'k',
    type: 'message.created',
    conversation: { type: 'room', id: 'r' },
    messageId: 'm',
    revision: 1,
    payload: { type: 'message.created' },
    attempts: 1,
    fencingToken: 7
  };
  const outbox = fake<MessageOutbox>({
    acquireLease: async () => ({ acquired: true as const, fencingToken: 7, expiresAt: null }),
    renewLease: async () => ({ renewed: true as const, expiresAt: null }),
    releaseLease: async () => {},
    recordHeartbeat: async () => true,
    claimBatch: async () => (claimed ? [] : ((claimed = true), [event])),
    markDelivered: async (eventId, lease) => {
      marked = { eventId, lease };
      delivered.resolve();
    },
    reschedule: async () => {},
    publishPostgres: async () => {}
  });
  const worker = createMessageDeliveryWorker({ outbox, idleMs: 5, leaseMs: 100, renewMs: 50, deliver: async () => {} });
  void worker.start();
  await delivered.promise;
  await worker.stop();
  assert.equal(marked?.eventId, 'e');
  assert.equal(marked?.lease.fencingToken, 7);
  assert.equal(marked?.lease.identity, LEASE_IDENTITY);
});
