import type pg from 'pg';
import { kyselyOn } from '../../platform/db/kysely.ts';

type QueryClient = Pick<pg.PoolClient, 'query'>;

/** The message row locked for the caller's transaction, with its tombstone if it has one. */
export function lockRoomMessage(client: QueryClient, roomId: string, messageId: string) {
  return kyselyOn(client)
    .selectFrom('room_messages')
    .select(['id', 'room_id', 'deleted_at'])
    .where('room_id', '=', roomId)
    .where('id', '=', messageId)
    .limit(1)
    .forUpdate()
    .executeTakeFirst();
}

export async function tombstoneRoomMessage(
  client: QueryClient,
  roomId: string,
  messageId: string,
  at: Date
): Promise<void> {
  await kyselyOn(client)
    .updateTable('room_messages')
    .set({ deleted_at: at })
    .where('room_id', '=', roomId)
    .where('id', '=', messageId)
    .where('deleted_at', 'is', null)
    .execute();
}
