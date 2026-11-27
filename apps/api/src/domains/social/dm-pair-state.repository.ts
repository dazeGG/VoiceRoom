import { sql } from 'kysely';
import type { Database } from '../../platform/db/kysely.ts';
import { orderedPair } from './social-records.ts';

export async function countNewChats(db: Database, sender: string): Promise<number> {
  const row = await newChats(db, sender).executeTakeFirstOrThrow();
  return row.count;
}

export function newChats(db: Database, sender: string) {
  return db
    .selectFrom('dm_pair_state')
    .select(sql<number>`count(*)::int`.as('count'))
    .where('initiator_id', '=', sender)
    .where('first_message_at', '>', sql<Date>`clock_timestamp() - interval '24 hours'`)
    .where('started_as_strangers', '=', true);
}

export async function recordPairMessage(
  tx: Database,
  sender: string,
  recipient: string,
  startedAsStrangers: boolean,
  kind: 'message' | 'call' = 'message'
) {
  const [low, high] = orderedPair(sender, recipient);
  const initialCount = kind === 'message' ? 1 : 0;
  await tx
    .insertInto('dm_pair_state')
    .values({
      user_low: low,
      user_high: high,
      initiator_id: sender,
      first_message_at: sql<Date>`clock_timestamp()`,
      last_sender_id: sender,
      unanswered_count: initialCount,
      started_as_strangers: startedAsStrangers
    })
    .onConflict((oc) =>
      oc.columns(['user_low', 'user_high']).doUpdateSet((eb) => ({
        last_sender_id: sender,
        unanswered_count: eb
          .case()
          .when('dm_pair_state.last_sender_id', '=', sender)
          .then(eb('dm_pair_state.unanswered_count', '+', initialCount))
          .else(initialCount)
          .end()
      }))
    )
    .execute();
}
