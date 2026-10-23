// The push fan-out over Web Push and the Android app: on while either is on,
// counts summed, and a strict failure only when nobody got the push.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPushFanout,
  failedPushProviders,
  localPushFailure,
  type PushSender
} from '../src/domains/notifications/push-fanout.ts';

type Behaviour = { enabled?: boolean; sent?: number; removed?: number; fails?: boolean };

function sender(name: string, { enabled = true, sent = 0, removed = 0, fails = false }: Behaviour = {}) {
  const calls: unknown[] = [];
  const provider: PushSender = {
    name,
    config: { enabled },
    async sendToUser(userId, payload, context) {
      calls.push({ userId, payload, context });
      if (fails) throw new Error(`${name} failed`);
      return { enabled, sent, removed };
    }
  };
  return { calls, provider };
}

const fanout = (web: Behaviour, rustore: Behaviour) => {
  const a = sender('web', web);
  const b = sender('rustore', rustore);
  return { web: a, rustore: b, push: createPushFanout(() => [a.provider, b.provider]) };
};

const STRICT = { strictFailures: true };

test('the fan-out is on while either provider is on, and sums what they did', async () => {
  assert.equal(fanout({ enabled: false }, { enabled: false }).push.config.enabled, false);
  assert.equal(fanout({ enabled: true }, { enabled: false }).push.config.enabled, true);
  assert.equal(fanout({ enabled: false }, { enabled: true }).push.config.enabled, true);

  const both = fanout({ sent: 2, removed: 1 }, { sent: 1, removed: 1 });
  assert.deepEqual(await both.push.sendToUser('u', { title: 'T' }, { ttl: 60 }), {
    enabled: true,
    sent: 3,
    removed: 2
  });
  assert.deepEqual(both.web.calls, [{ userId: 'u', payload: { title: 'T' }, context: { ttl: 60 } }]);
  assert.deepEqual(both.rustore.calls, both.web.calls);
});

test('a provider that is off is not asked, and with both off the push is disabled', async () => {
  const webOnly = fanout({ sent: 1 }, { enabled: false });
  assert.deepEqual(await webOnly.push.sendToUser('u', {}), { enabled: true, sent: 1, removed: 0 });
  assert.deepEqual(webOnly.rustore.calls, []);

  const off = fanout({ enabled: false }, { enabled: false });
  assert.deepEqual(await off.push.sendToUser('u', {}, STRICT), { enabled: false, sent: 0, removed: 0 });
});

test('a RuStore failure does not throw while Web Push delivered', async () => {
  const { push } = fanout({ sent: 1 }, { fails: true });
  assert.deepEqual(await push.sendToUser('u', {}, STRICT), { enabled: true, sent: 1, removed: 0 });
});

test('a Web Push failure does not throw while RuStore delivered', async () => {
  const { push } = fanout({ fails: true }, { sent: 1 });
  assert.deepEqual(await push.sendToUser('u', {}, STRICT), { enabled: true, sent: 1, removed: 0 });
});

test('nobody delivered and a provider failed: an AggregateError naming the failed providers', async () => {
  const cases: Array<[Behaviour, Behaviour, string[]]> = [
    [{ fails: true }, { fails: true }, ['web', 'rustore']],
    [{ sent: 0 }, { fails: true }, ['rustore']],
    [{ fails: true }, { sent: 0 }, ['web']],
    [{ fails: true }, { enabled: false }, ['web']]
  ];
  for (const [web, rustore, failed] of cases) {
    const { push } = fanout(web, rustore);
    const error = await push.sendToUser('u', {}, STRICT).then(
      () => assert.fail('expected the fan-out to throw'),
      (thrown: unknown) => thrown
    );
    assert.ok(error instanceof AggregateError);
    assert.equal(error.message, 'Push delivery failed');
    assert.deepEqual(failedPushProviders(error), failed);
  }
});

test("a sender's own failure, before its provider, is thrown but names no provider", async () => {
  const web = sender('web', { fails: true });
  const local: PushSender = {
    name: 'rustore',
    config: { enabled: true },
    async sendToUser() {
      throw localPushFailure(new Error('db'));
    }
  };
  for (const [providers, failed] of [
    [[local], []],
    [[web.provider, local], ['web']]
  ] as const) {
    const push = createPushFanout(() => providers);
    const error = await push.sendToUser('u', {}, STRICT).then(
      () => assert.fail('expected the fan-out to throw'),
      (thrown: unknown) => thrown
    );
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(failedPushProviders(error), failed);
  }
});

test('without strictFailures the fan-out never throws', async () => {
  const { push } = fanout({ fails: true }, { fails: true });
  assert.deepEqual(await push.sendToUser('u', {}), { enabled: true, sent: 0, removed: 0 });
});

test('failedPushProviders reads nothing from any other error', () => {
  assert.deepEqual(failedPushProviders(new Error('plain')), []);
  assert.deepEqual(failedPushProviders(null), []);
  assert.deepEqual(failedPushProviders('text'), []);
  assert.deepEqual(failedPushProviders({ failedProviders: 'web' }), []);
  assert.deepEqual(failedPushProviders({ failedProviders: ['web', 7, 'rustore'] }), ['web', 'rustore']);
});
