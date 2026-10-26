// The Android app's push service: one RuStore message per live token, tokens
// forgotten only when RuStore says they are gone, strict failures only for
// retryable answers, and rings kept from apps below the minimum version.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativePushService } from '../src/domains/notifications/native-push.service.ts';
import type { DeviceTokenTarget } from '../src/domains/notifications/device-token.repository.ts';
import type { RuStoreMessage, RuStoreSendOutcome } from '../src/lib/rustore-push.ts';
import { recordingLogger } from './fakes/index.ts';

const ON = { enabled: true, projectId: 'p', serviceToken: 's' };
const OFF = { enabled: false, projectId: '', serviceToken: '' };
const NOW = 1_000;
const DM = { type: 'dm.message', title: 'Ада', body: 'привет', dedupeKey: 'dm:m1', url: '/?dm=ada' };

const target = (token: string, appVersion: string | null = '1.0.0'): DeviceTokenTarget => ({
  provider: 'rustore',
  token,
  appVersion
});

function harness({
  config = ON,
  targets = [target('phone')],
  outcomes = {},
  minVersion = '',
  loadFails = false
}: {
  config?: typeof ON;
  targets?: DeviceTokenTarget[];
  outcomes?: Record<string, RuStoreSendOutcome>;
  minVersion?: string;
  loadFails?: boolean;
} = {}) {
  const calls: { listed: Array<[string, number]>; removed: string[]; sent: RuStoreMessage[] } = {
    listed: [],
    removed: [],
    sent: []
  };
  const logger = recordingLogger();
  const service = createNativePushService({
    config,
    minVersion,
    now: () => NOW,
    logger,
    tokens: () => ({
      async listByUserId(userId, now) {
        if (loadFails) throw new Error('db');
        calls.listed.push([userId, now ?? 0]);
        return targets;
      },
      async removeToken({ token }) {
        calls.removed.push(token);
      }
    }),
    client: {
      async send(message) {
        calls.sent.push(message);
        const outcome = outcomes[message.token] ?? 'sent';
        return { outcome, httpStatus: outcome === 'sent' ? 200 : 400, status: 'STATUS', message: 'why' };
      }
    }
  });
  const events = (level: string) =>
    logger.records.filter((record) => record.level === level).map((record) => record.evt);
  return { calls, events, logger, service };
}

test('a push goes to every live token of the account', async () => {
  const { calls, service } = harness({ targets: [target('phone'), target('tablet')] });

  const result = await service.sendToUser('ada', DM, { ttl: 3600, nativeData: { peerUserId: 'bob', messageId: 'm1' } });

  assert.deepEqual(result, { enabled: true, sent: 2, removed: 0 });
  assert.deepEqual(calls.listed, [['ada', NOW]]);
  assert.deepEqual(
    calls.sent.map((message) => message.token),
    ['phone', 'tablet']
  );
  const [first] = calls.sent;
  assert.deepEqual(first?.notification, { title: 'Ада', body: 'привет' });
  assert.deepEqual(first?.android, { ttl: '3600s', notification: { channel_id: 'messages' } });
  assert.equal(first?.data.peerUserId, 'bob');
  assert.equal(first?.data.messageId, 'm1');
  assert.equal(first?.data.type, 'dm.message');
});

test('only a token RuStore no longer knows is forgotten', async () => {
  const { calls, events, service } = harness({
    targets: [target('gone'), target('refused'), target('denied-1'), target('denied-2'), target('ok')],
    outcomes: { gone: 'expired_token', refused: 'rejected', 'denied-1': 'unauthorized', 'denied-2': 'unauthorized' }
  });

  const result = await service.sendToUser('ada', DM, { strictFailures: true });

  assert.deepEqual(result, { enabled: true, sent: 1, removed: 1 });
  assert.deepEqual(calls.removed, ['gone']);
  assert.deepEqual(events('info'), ['push.native_token_pruned']);
  assert.deepEqual(events('error').sort(), ['push.native_rejected', 'push.native_unauthorized']);
});

test('a bad service key is logged once per send, not once per token', async () => {
  const { events, logger, service } = harness({
    targets: [target('a'), target('b'), target('c')],
    outcomes: { a: 'unauthorized', b: 'unauthorized', c: 'unauthorized' }
  });
  assert.deepEqual(await service.sendToUser('ada', DM, { strictFailures: true }), {
    enabled: true,
    sent: 0,
    removed: 0
  });
  assert.deepEqual(events('error'), ['push.native_unauthorized']);
  assert.equal(logger.records[0]?.tokens, 3);
});

test('a retryable answer throws only under strictFailures, and only when no phone got the push', async () => {
  const strict = harness({
    targets: [target('busy'), target('down')],
    outcomes: { busy: 'retryable', down: 'retryable' }
  });
  await assert.rejects(strict.service.sendToUser('ada', DM, { strictFailures: true }), AggregateError);
  assert.deepEqual(strict.events('warn'), ['push.native_send_failed', 'push.native_send_failed']);

  // A retry would repeat the push on the phone that already got it.
  const partly = harness({ targets: [target('busy'), target('ok')], outcomes: { busy: 'retryable' } });
  assert.deepEqual(await partly.service.sendToUser('ada', DM, { strictFailures: true }), {
    enabled: true,
    sent: 1,
    removed: 0
  });
  assert.deepEqual(partly.events('warn'), ['push.native_send_failed']);

  const lenient = harness({ outcomes: { phone: 'retryable' } });
  assert.deepEqual(await lenient.service.sendToUser('ada', DM), { enabled: true, sent: 0, removed: 0 });
});

test('off, or skipped for this push, it never opens the token store', async () => {
  const off = harness({ config: OFF });
  assert.deepEqual(await off.service.sendToUser('ada', DM), { enabled: false, sent: 0, removed: 0 });
  assert.equal(off.service.config.enabled, false);
  assert.deepEqual(off.calls.listed, []);

  const skipped = harness();
  assert.deepEqual(await skipped.service.sendToUser('ada', DM, { skipNative: true }), {
    enabled: true,
    sent: 0,
    removed: 0
  });
  assert.deepEqual(skipped.calls.listed, []);
  assert.deepEqual(skipped.calls.sent, []);
});

test('a ring is data-only, expires with the ring, and is not sent once it is over', async () => {
  const { calls, service } = harness();
  const ring = { type: 'ring', title: 'Ада зовёт вас', body: 'Комната', dedupeKey: 'ring:k', url: '/r/r1' };

  await service.sendToUser(
    'bob',
    { ...ring, expiresAt: NOW + 20_000 },
    {
      expiresAt: NOW + 20_000,
      nativeData: { fromUserId: 'ada', roomId: 'r1' }
    }
  );
  const [message] = calls.sent;
  assert.ok(message);
  assert.equal('notification' in message, false);
  assert.deepEqual(message.android, { ttl: '20s' });
  assert.equal(message.data.fromUserId, 'ada');

  assert.deepEqual(await service.sendToUser('bob', ring, { expiresAt: NOW - 1 }), {
    enabled: true,
    sent: 0,
    removed: 0
  });
  assert.equal(calls.sent.length, 1);
});

test('rings skip apps below the minimum version or of an unknown one; other pushes do not', async () => {
  const targets = [target('old', '1.1.9'), target('unknown', null), target('equal', '1.2.0'), target('new', '2.0.0')];
  const { calls, service } = harness({ targets, minVersion: '1.2.0' });

  await service.sendToUser('bob', { type: 'ring', title: 'T', body: 'B' }, {});
  assert.deepEqual(
    calls.sent.map((message) => message.token),
    ['equal', 'new']
  );

  calls.sent.length = 0;
  await service.sendToUser('bob', DM, {});
  assert.deepEqual(
    calls.sent.map((message) => message.token),
    ['old', 'unknown', 'equal', 'new']
  );

  const unbounded = harness({ targets });
  await unbounded.service.sendToUser('bob', { type: 'ring', title: 'T', body: 'B' }, {});
  assert.equal(unbounded.calls.sent.length, 4);
});

test('a message too large for RuStore is not sent, and is logged', async () => {
  const { calls, events, service } = harness({ targets: [target('x'.repeat(4096)), target('phone')] });
  assert.deepEqual(await service.sendToUser('ada', DM, {}), { enabled: true, sent: 1, removed: 0 });
  assert.deepEqual(
    calls.sent.map((message) => message.token),
    ['phone']
  );
  assert.deepEqual(events('error'), ['push.native_too_large']);
});

test('a token store failure is logged, and thrown only under strictFailures', async () => {
  const lenient = harness({ loadFails: true });
  assert.deepEqual(await lenient.service.sendToUser('ada', DM), { enabled: true, sent: 0, removed: 0 });
  assert.deepEqual(lenient.events('warn'), ['push.subscription_load_failed']);

  const strict = harness({ loadFails: true });
  await assert.rejects(strict.service.sendToUser('ada', DM, { strictFailures: true }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(error.cause instanceof Error);
    assert.equal(error.cause.message, 'db');
    return true;
  });
});

test('only string extra data and string payload fields reach the push', async () => {
  const { calls, service } = harness();
  await service.sendToUser('ada', { ...DM, title: 42, body: null }, { nativeData: { peerUserId: 'bob', count: 3 } });
  const [message] = calls.sent;
  assert.equal(message?.data.peerUserId, 'bob');
  assert.equal('count' in (message?.data ?? {}), false);
  assert.deepEqual(message?.notification, { title: 'VoiceRoom', body: '' });

  await service.sendToUser('ada', 'not a payload', { nativeData: 'not a map' });
  assert.equal(calls.sent[1]?.data.type, 'unknown');
});

test('Ring strict partial failures retry failed siblings without changing ordinary push policy', async () => {
  const { service } = harness({ targets: [target('ok'), target('retry')], outcomes: { retry: 'retryable' } });
  await assert.rejects(
    service.sendToUser(
      'ada',
      { type: 'ring.state', url: '', dedupeKey: 'r:2' },
      {
        strictFailures: true,
        strictPartialFailures: true,
        ttl: 300,
        nativeData: { ringId: 'r', ringState: 'cancelled', recipientUserId: 'ada', ringRevision: '2' }
      }
    ),
    /delivery failed/
  );
});

test('Ring terminal data never asks RuStore to post an ordinary notification', async () => {
  const { service, calls } = harness();
  await service.sendToUser(
    'ada',
    { type: 'ring.state', url: '', dedupeKey: 'r:2' },
    {
      strictFailures: true,
      strictPartialFailures: true,
      ttl: 300,
      nativeData: { ringId: 'r', ringState: 'expired', recipientUserId: 'ada', ringRevision: '2' }
    }
  );
  assert.equal(calls.sent[0]?.notification, undefined);
  assert.deepEqual(calls.sent[0]?.android, { ttl: '300s' });
  assert.equal(calls.sent[0]?.data.ringState, 'expired');
});

test('mentions routing is per device, never inferred from version; Rings remain data-only', async () => {
  const { calls, service } = harness({
    targets: [
      target('legacy', '99.0.0'),
      { ...target('new'), notificationChannels: ['messages', 'mentions'] },
      { ...target('no-mentions'), notificationChannels: ['messages'] }
    ]
  });
  await service.sendToUser('ada', { notificationId: 'n1', title: 'mention', body: 'reply' });
  assert.deepEqual(
    calls.sent.map((message) => message.android?.notification?.channel_id),
    ['messages', 'mentions', 'messages']
  );
  calls.sent.length = 0;
  await service.sendToUser('ada', DM);
  assert.deepEqual(
    calls.sent.map((message) => message.android?.notification?.channel_id),
    ['messages', 'messages', 'messages']
  );
  for (const type of ['ring', 'ring.state']) {
    calls.sent.length = 0;
    await service.sendToUser('ada', { type, title: 'Ring', expiresAt: NOW + 10000 });
    assert.equal(calls.sent.length, 3);
    assert.equal(
      calls.sent.every((message) => !message.notification && !message.android?.notification),
      true
    );
  }
});
