import assert from 'node:assert/strict';
import { Pool } from 'pg';
import test, { type TestContext } from 'node:test';
import { transaction } from '../src/lib/db.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createNotificationService, type InboxCursorCodec } from '../src/domains/notifications/notification-service.ts';
import type { MentionEligibilityService } from '../src/domains/notifications/mention-eligibility-service.ts';
import type { NotificationOutboxRepository } from '../src/domains/notifications/notification-outbox-repository.ts';
import { fake } from './fakes/index.ts';
import { createMentionRepository } from '../src/domains/notifications/mention-repository.ts';
import { createInboxRepository } from '../src/domains/notifications/inbox-repository.ts';
import { createNotificationOutboxRepository } from '../src/domains/notifications/notification-outbox-repository.ts';
import { createTestDatabase } from './db-harness.ts';
async function fixture(t: TestContext) {
  const db = await createTestDatabase(t);
  await runMigrations({
    databaseUrl: db.databaseUrl,
    logger: { log() {}, info() {}, warn() {}, error() {} },
    noLock: true
  });
  const pool = new Pool({ connectionString: db.databaseUrl, max: 2 });
  t.after(async () => {
    await pool.end();
    await db.cleanup();
  });
  await pool.query(
    `INSERT INTO users(id,login,display_name,password_hash) VALUES ('actor','actor','Actor','x'),('target','target','Target','x');INSERT INTO rooms(id,creator_ip) VALUES ('room','');INSERT INTO room_memberships(id,room_id,user_id,role) VALUES ('ma','room','actor','member'),('mt','room','target','member')`
  );
  return pool;
}
function service(pool: Pool, outbox: NotificationOutboxRepository) {
  return createNotificationService({
    pool,
    inbox: createInboxRepository({ pool }),
    mentions: createMentionRepository({ pool }),
    outbox,
    eligibility: fake<MentionEligibilityService>({
      async validate({ targetUserIds }) {
        return targetUserIds as string[];
      }
    }),
    cursorCodec: fake<InboxCursorCodec>()
  });
}
test(
  'G57-A01 failure after outbox insert rolls message, mention, inbox and intent back',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const pool = await fixture(t);
    const actual = createNotificationOutboxRepository({ pool });
    const notifications = service(
      pool,
      fake<NotificationOutboxRepository>({
        async enqueue(input) {
          await actual.enqueue(input);
          throw new Error('injected');
        }
      })
    );
    await assert.rejects(
      transaction(pool, async (client) => {
        await client.query(`INSERT INTO room_messages(id,room_id,text) VALUES ('m1','room','hello')`);
        await notifications.createAddressedForMessage({
          roomId: 'room',
          messageId: 'm1',
          creatorUserId: 'actor',
          targetUserIds: ['target'],
          body: 'hello',
          client
        });
      }),
      /injected/
    );
    for (const table of ['room_messages', 'room_message_mentions', 'user_notifications', 'notification_outbox'])
      assert.equal(Number((await pool.query(`SELECT count(*) count FROM ${table}`)).rows[0].count), 0);
  }
);
test(
  'G57-A02 mention plus reply merges one inbox row and one intent',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const pool = await fixture(t);
    await pool.query(`INSERT INTO room_messages(id,room_id,text) VALUES ('m2','room','hello')`);
    const notifications = service(pool, createNotificationOutboxRepository({ pool }));
    await notifications.createAddressedForMessage({
      roomId: 'room',
      messageId: 'm2',
      creatorUserId: 'actor',
      targetUserIds: ['target'],
      replyTargetUserId: 'target',
      body: 'hello'
    });
    const n = await pool.query(`SELECT reasons FROM user_notifications`);
    assert.deepEqual(n.rows[0].reasons, ['mention', 'reply']);
    assert.equal(Number((await pool.query(`SELECT count(*) count FROM notification_outbox`)).rows[0].count), 1);
  }
);
