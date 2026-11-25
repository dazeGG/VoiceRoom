import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { localizeNotificationPayload } from '@voiceroom/shared/notification-text';
import { parseCallPushPayload, type CallPushPayload } from '@voiceroom/shared/notifications';
import { createCallPushService } from '../src/domains/rings/call-push.service.ts';
import { createCallRingRepository } from '../src/domains/rings/call-rings.repository.ts';
import { advanceCall } from '../src/domains/rings/call-lifecycle.policy.ts';
import { createPushService, type PushContext } from '../src/lib/push-service.ts';
import { createTestDatabase } from './db-harness.ts';

test('durable call jobs recheck alert settings and attempt state for web and native', async (t) => {
  const { pool, cleanup } = await createTestDatabase(t);
  t.after(cleanup);
  const caller = randomUUID();
  const recipient = randomUUID();
  const [low, high] = [caller, recipient].sort();
  await pool.query(`INSERT INTO users(id,login,password_hash) VALUES($1,'alice','x'),($2,'bob','x')`, [
    caller,
    recipient
  ]);
  await pool.query('INSERT INTO friendships(id,user_a_id,user_b_id) VALUES($1,$2,$3)', [randomUUID(), low, high]);
  let now = Date.now();
  const rings = createCallRingRepository(pool, () => now);
  const settings: { doNotDisturb: boolean; mutedPeerIds: string[]; privateNotifications: boolean } = {
    doNotDisturb: true,
    mutedPeerIds: [],
    privateNotifications: false
  };
  const web: { endpoint: string; payload: CallPushPayload; ttl?: number }[] = [];
  const native: Array<{ userId: string; payload: CallPushPayload; context: PushContext }> = [];
  const desktopEndpoint = 'https://fcm.googleapis.com/fcm/send/desktop-token';
  const webPush = createPushService({
    config: { enabled: true, subject: 'mailto:test@example.test', vapidPublicKey: 'test', privateKey: 'test' },
    now: () => now,
    store: {
      async listByUserId(userId) {
        assert.equal(userId, recipient);
        return [
          { endpoint: desktopEndpoint, keys: { p256dh: 'test', auth: 'test' }, platformClass: 'desktop' },
          {
            endpoint: 'https://fcm.googleapis.com/fcm/send/mobile-token',
            keys: { p256dh: 'test', auth: 'test' },
            platformClass: 'mobile'
          }
        ];
      },
      async removeByEndpoint() {},
      async markSuccess() {}
    },
    client: {
      setVapidDetails() {},
      async sendNotification({ endpoint }, body, options) {
        const payload = parseCallPushPayload(JSON.parse(body));
        assert.ok(payload);
        web.push({ endpoint, payload, ...(options ? { ttl: options.TTL } : {}) });
      }
    }
  });
  let fail = false;
  function worker() {
    return createCallPushService({
      pool: () => pool,
      clock: () => now,
      preferences: async () => settings,
      displayName: async () => 'Alice',
      webPush: webPush.sendToUser,
      nativePush: async (userId, payload, context) => {
        if (fail) throw new Error('Retry this provider');
        const projected = parseCallPushPayload(localizeNotificationPayload(payload, 'en'));
        assert.ok(projected);
        native.push({ userId, payload: projected, context });
      }
    });
  }
  async function drain() {
    const delivery = worker();
    await delivery.prune();
    while (await delivery.drainOnce()) {
      // Drain committed work, including obsolete jobs that become no-ops.
    }
  }
  async function start() {
    const result = await rings.start(caller, recipient, randomUUID(), { count: 0, windowMs: 0 });
    assert.equal(result.status, 'created');
    return result.call;
  }
  const first = await start();
  await drain();
  assert.deepEqual([web.length, native.length], [0, 0]);
  settings.doNotDisturb = false;
  settings.mutedPeerIds = [caller];
  now = first.ringingExpiresAt;
  await rings.update(first.id, null, (call) => ({
    call: advanceCall(call, now, true, [{ userId: caller, status: 'present', reconnectUntil: null }]),
    result: null
  }));
  await drain();
  assert.deepEqual(
    web.map(({ payload }) => payload.type),
    ['call.state']
  );
  assert.equal(native[0]?.payload.type, 'call.state');
  assert.equal((await rings.listMissed(recipient))[0]?.count, 1);

  now += 300_000;
  await rings.update(first.id, null, (call) => ({ call: advanceCall(call, now, true, []), result: null }));
  settings.mutedPeerIds = [];
  const second = await start();
  settings.privateNotifications = true;
  fail = true;
  await assert.rejects(worker().drainOnce(), /Call push delivery failed/);
  fail = false;
  now += 2_000;
  await drain();
  const incoming = web.filter(({ payload }) => payload.type === 'call.incoming');
  assert.equal(incoming.length, 2);
  assert.deepEqual(incoming[0]?.payload, incoming[1]?.payload);
  assert.equal(incoming[1]?.endpoint, desktopEndpoint);
  assert.equal(incoming[1]?.ttl, 43);
  const sent = native.find(({ payload }) => payload.type === 'call.incoming');
  assert.ok(sent);
  assert.equal(sent.userId, recipient);
  assert.equal(sent.payload.url, `/?call=${second.id}`);
  assert.equal(sent.payload.body, 'Open VoiceRoom to view the call.');
  assert.ok(!JSON.stringify(sent).includes('Alice'));
  assert.ok(!JSON.stringify(sent).includes(caller));

  await rings.update(second.id, recipient, (call) => ({
    call: { ...call, phase: 'connecting', attemptResult: 'accepted' },
    result: null
  }));
  settings.doNotDisturb = true;
  await drain();
  const dismissal = web.at(-1)?.payload;
  assert.equal(dismissal?.type, 'call.state');
  assert.equal(dismissal?.tag, sent.payload.tag);
  assert.ok(dismissal.revision > sent.payload.revision);

  now += 300_000;
  await rings.update(second.id, null, (call) => ({ call: advanceCall(call, now, true, []), result: null }));
  settings.doNotDisturb = false;
  settings.privateNotifications = false;
  const third = await start();
  now = third.ringingExpiresAt;
  await rings.update(third.id, null, (call) => ({
    call: advanceCall(call, now, true, [{ userId: caller, status: 'present', reconnectUntil: null }]),
    result: null
  }));
  await drain();
  const missed = native.find(({ payload }) => payload.type === 'call.missed');
  assert.equal(missed?.payload.body, 'Alice');
  assert.equal(missed.payload.url, `/?dm=${caller}`);
  assert.equal(missed.payload.dedupeKey, missed.payload.tag);
  assert.equal(missed.payload.expiresAt, now + 15 * 60_000);
  assert.equal(
    web.some(({ payload }) => payload.type === 'call.incoming' && payload.callId === third.id),
    false
  );
});
