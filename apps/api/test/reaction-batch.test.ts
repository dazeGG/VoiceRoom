// A chat asks for the reactions of many messages in one request. One by one they
// took the whole connection pool and a join waited behind them for its token, so
// this must answer with one query per kind of thing, and show nobody a message
// the single read would have refused.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { MAX_REACTION_BATCH } from '@voice-room/shared/contracts/messages';
import { createReactionRepository } from '../src/domains/messaging/reaction.repository.ts';
import { createReactionService, type ReactionRepository } from '../src/domains/messaging/reaction.service.ts';
import { createCursorCodec } from '../src/platform/cursor-codec.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';
import { fake } from './fakes/index.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const skip = !process.env.TEST_DATABASE_URL;
const codec = createCursorCodec({ keys: ['reaction-test-secret-must-be-at-least-32-bytes'] });
const SUMMARY = { emoji: '👍', count: 2, reactedByMe: true, revision: '7' };

function service(visible: string[]) {
  const asked: string[][] = [];
  const reactions = createReactionService({
    repository: fake<ReactionRepository>({
      async listSummariesForMessages({ messageIds }) {
        asked.push(messageIds);
        return new Map(messageIds.map((id) => [id, [SUMMARY]]));
      }
    }),
    cursorCodec: codec,
    requireVisible: async () => {
      throw new Error('a batch must not check its messages one at a time');
    },
    listVisible: async ({ messageIds }) => messageIds.filter((id) => visible.includes(id)),
    publish: () => false
  });
  return { reactions, asked };
}

const CONVERSATION = { type: 'room', id: 'kitchen' };

test('many messages cost one read, and a message the viewer may not see is left out', async () => {
  const shown = randomUUID();
  const hidden = randomUUID();
  const { reactions, asked } = service([shown]);

  const answer = await reactions.getSummariesForMessages({ conversation: CONVERSATION, messageIds: [shown, hidden] });

  assert.deepEqual(answer, { [shown]: [SUMMARY] });
  assert.deepEqual(asked, [[shown]]);
});

test('the same message asked twice counts once', async () => {
  const id = randomUUID();
  const { reactions, asked } = service([id]);

  await reactions.getSummariesForMessages({ conversation: CONVERSATION, messageIds: [id, id, ` ${id} `] });

  assert.deepEqual(asked, [[id]]);
});

test('a batch that is too long or holds something that is no message id is refused', async () => {
  const { reactions } = service([]);
  const tooMany = Array.from({ length: MAX_REACTION_BATCH + 1 }, () => randomUUID());

  await assert.rejects(reactions.getSummariesForMessages({ conversation: CONVERSATION, messageIds: tooMany }), {
    code: 'invalid_message'
  });
  await assert.rejects(reactions.getSummariesForMessages({ conversation: CONVERSATION, messageIds: ["1' OR 1=1"] }), {
    code: 'invalid_message'
  });
});

test('a conversation of no known kind is refused', async () => {
  const { reactions } = service([]);
  await assert.rejects(
    reactions.getSummariesForMessages({ conversation: { type: 'nope', id: 'x' }, messageIds: [randomUUID()] }),
    { code: 'invalid_conversation' }
  );
});

test('only messages standing in this room, or between these two people, are listed', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });

  const user = async (login: string) => {
    const id = randomUUID();
    await pool.query(`INSERT INTO users (id, login, password_hash) VALUES ($1, $2, 'x')`, [id, login]);
    return id;
  };
  const [ann, bob, eve] = [await user('ann'), await user('bob'), await user('eve')];
  for (const id of ['kitchen', 'attic']) await pool.query('INSERT INTO rooms (id) VALUES ($1)', [id]);
  const roomMessage = async (roomId: string, deleted = false) => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO room_messages (id, room_id, text, deleted_at) VALUES ($1, $2, 'hi', ${deleted ? 'now()' : 'NULL'})`,
      [id, roomId]
    );
    return id;
  };
  const direct = async (sender: string, recipient: string, deleted = false) => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO direct_messages (id, sender_id, recipient_id, body, deleted_at)
       VALUES ($1, $2, $3, 'hi', ${deleted ? 'now()' : 'NULL'})`,
      [id, sender, recipient]
    );
    return id;
  };
  const repository = createReactionRepository({ client: pool });

  const here = await roomMessage('kitchen');
  const gone = await roomMessage('kitchen', true);
  const elsewhere = await roomMessage('attic');
  assert.deepEqual(await repository.listRoomMessageIds('kitchen', [here, gone, elsewhere]), [here]);
  assert.deepEqual(await repository.listRoomMessageIds('kitchen', []), []);

  const fromAnn = await direct(ann, bob);
  const fromBob = await direct(bob, ann);
  const removed = await direct(ann, bob, true);
  const others = await direct(ann, eve);
  const listed = await repository.listDirectMessageIds(ann, bob, [fromAnn, fromBob, removed, others]);
  assert.deepEqual([...listed].sort(), [fromAnn, fromBob].sort());
  // A third person gets nothing of a thread that is not theirs.
  assert.deepEqual(await repository.listDirectMessageIds(eve, bob, [fromAnn, fromBob]), []);
});
