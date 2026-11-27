import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { directMessageFence } from '../../../src/domains/messaging/dm-message-fence.repository.ts';

const message = { id: 'm-1', senderId: 'alice', recipientId: 'bob' };

test('a fence that cannot reach the database reports the failure and skips the emission', async (t) => {
  // Nothing listens on port 1, so every connection attempt is refused.
  const pool = new pg.Pool({
    connectionString: 'postgres://fence:fence@127.0.0.1:1/fence',
    connectionTimeoutMillis: 500
  });
  t.after(() => pool.end());
  const failures: unknown[] = [];
  const emitted: string[] = [];
  const fence = directMessageFence(
    () => pool,
    (error) => failures.push(error)
  );

  assert.equal(await fence(message, () => emitted.push('sent')), false);
  assert.deepEqual(emitted, []);
  assert.equal(failures.length, 1);
  assert.ok(failures[0] instanceof Error);
});

test('without a database the fence emits at once', async () => {
  const emitted: string[] = [];
  const fence = directMessageFence(
    () => null,
    () => assert.fail('no failure without a database')
  );

  assert.equal(await fence(message, () => emitted.push('sent')), true);
  assert.deepEqual(emitted, ['sent']);
});
