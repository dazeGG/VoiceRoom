// A conversation deletion that commits while a DM notification is still being
// prepared (the preferences lookup is slow) must stop the notice and the push:
// the dispatcher runs its last step under the same pair lock as the purge.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test, { type TestContext } from 'node:test';
import type { AccountMessage } from '../../../src/realtime/account-events.ts';
import { createNotificationDispatch } from '../../../src/domains/notifications/notification-dispatch.ts';
import { createDmConversationDeleteService } from '../../../src/domains/messaging/dm-conversation-delete.service.ts';
import { directMessageFence } from '../../../src/domains/messaging/dm-message-fence.repository.ts';
import { createTestDatabase } from '../../db-harness.ts';
import { storedUser } from '../../fakes/index.ts';

async function fixture(t: TestContext) {
  const db = await createTestDatabase(t);
  t.after(db.cleanup);
  const [alice, bob] = [crypto.randomUUID(), crypto.randomUUID()];
  await db.pool.query(`INSERT INTO users(id, login, password_hash) VALUES ($1, 'alice', 'x'), ($2, 'bob', 'x')`, [
    alice,
    bob
  ]);
  const notices: Array<[string, AccountMessage]> = [];
  const pushes: Array<{ userId: string; body: unknown }> = [];
  let gate: Promise<void> = Promise.resolve();
  const dispatch = createNotificationDispatch({
    push: () => ({
      config: { enabled: true },
      async sendToUser(userId, payload) {
        pushes.push({ userId, body: payload.body });
      }
    }),
    preferences: async () => {
      await gate;
      return { mutedPeerIds: [] };
    },
    notifyUser: (userId, event) => {
      notices.push([userId, event]);
      return 1;
    },
    logger: () => ({ warn() {}, error() {} }),
    whileMessageLive: directMessageFence(
      () => db.pool,
      (error) => {
        throw error;
      }
    )
  });
  const deletion = createDmConversationDeleteService({
    pool: () => db.pool,
    notifyUser: () => {},
    refreshCallMisses: () => {}
  });
  const message = async (body: string) => {
    const id = crypto.randomUUID();
    await db.pool.query(`INSERT INTO direct_messages(id, sender_id, recipient_id, body) VALUES ($1, $2, $3, $4)`, [
      id,
      alice,
      bob,
      body
    ]);
    return { id, body, createdAt: Date.now() };
  };
  const hold = () => {
    let release = () => {};
    gate = new Promise((resolve) => {
      release = resolve;
    });
    return release;
  };
  return { db, alice, bob, notices, pushes, dispatch, deletion, message, hold };
}

test(
  'a DM notice and push prepared before a conversation deletion never reach the recipient',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const f = await fixture(t);
    const sender = storedUser({ id: f.alice, login: 'alice', displayName: 'Alice' });

    const live = await f.message('Still here');
    assert.equal(await f.dispatch.broadcastDmNotification(f.bob, sender, live), 1);
    assert.deepEqual(
      f.notices.map(([userId, event]) => [userId, event.type]),
      [[f.bob, 'notification.dm.message']]
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(f.pushes, [{ userId: f.bob, body: 'Still here' }]);
    f.notices.length = 0;
    f.pushes.length = 0;

    const erased = await f.message('Erased secret');
    const release = f.hold();
    const pending = f.dispatch.broadcastDmNotification(f.bob, sender, erased);
    await f.deletion.remove(f.bob, f.alice);
    assert.equal((await f.db.pool.query('SELECT 1 FROM direct_messages')).rowCount, 0);
    release();
    assert.equal(await pending, 0);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(f.notices, []);
    assert.deepEqual(f.pushes, []);
  }
);
