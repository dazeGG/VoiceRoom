import { sql } from 'kysely';
import type { Database } from '../../platform/db/kysely.ts';
import { orderedPair } from './social-records.ts';

/** Mutation callers hold the canonical pair lock. The gate uses a fresh read. */
export async function ringPairRefusal(db: Database, caller: string, recipient: string) {
  const [low, high] = orderedPair(caller, recipient);
  const { activeAccounts, friends, blocked } = await db
    .selectNoFrom((eb) => [
      eb
        .selectFrom('users')
        .select(eb.fn.countAll<number>().$castTo<number>().as('count'))
        .where('id', 'in', [low, high])
        .where('deleted_at', 'is', null)
        .where('deletion_requested_at', 'is', null)
        .where((users) =>
          users.or([users('blocked_at', 'is', null), users('blocked_until', '<=', sql<Date>`clock_timestamp()`)])
        )
        .as('activeAccounts'),
      eb
        .exists(eb.selectFrom('friendships').select('id').where('user_a_id', '=', low).where('user_b_id', '=', high))
        .as('friends'),
      eb
        .exists(
          eb
            .selectFrom('user_blocks')
            .select('blocker_id')
            .where((blocks) =>
              blocks.or([
                blocks.and([blocks('blocker_id', '=', low), blocks('blocked_id', '=', high)]),
                blocks.and([blocks('blocker_id', '=', high), blocks('blocked_id', '=', low)])
              ])
            )
        )
        .as('blocked')
    ])
    .executeTakeFirstOrThrow();
  if (Number(activeAccounts) !== 2) return 'account_deleted' as const;
  if (!friends) return 'not_friends' as const;
  if (blocked) return 'blocked' as const;
  return null;
}
