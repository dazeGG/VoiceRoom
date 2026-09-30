import { sql } from 'kysely';
import type pg from 'pg';
import { kyselyOn } from '../../platform/db/kysely.ts';
import { fromMicros } from '../../platform/db/micros.ts';

type ReadTuple = { id: string; createdAtMicros: string | number | bigint };
type ReadCursorRow = { last_read_message_created_at: unknown; last_read_message_id: string };
export type ReadAdvance = ReadCursorRow | { unchanged: true } | null;

export type MessageReadRepository = Readonly<{
  advanceDm(input: { peerId: string; userId: string; tuple: ReadTuple }): Promise<ReadAdvance>;
  advanceRoom(input: { roomId: string; userId: string; tuple: ReadTuple }): Promise<ReadAdvance>;
}>;

function createMessageReadRepository({ pool }: { pool: pg.Pool }): MessageReadRepository {
  const db = kyselyOn(pool);

  // Timestamps are bound as the cursor's exact microseconds, never as the
  // created_at node-pg hands back: that arrives as a JS Date, which keeps only
  // milliseconds. Direct messages are stored to the microsecond, so a bound of
  // 09:57:28.853 excluded the very message at 09:57:28.853795 — the newest one
  // never got read_at and its unread badge came back on every reload. The
  // SELECT above each write has already matched created_at to these exact
  // micros, so reusing them names the same instant.
  async function advanceRoom({
    roomId,
    userId,
    tuple
  }: {
    roomId: string;
    userId: string;
    tuple: ReadTuple;
  }): Promise<ReadAdvance> {
    const at = fromMicros(tuple.createdAtMicros);
    return db.transaction().execute(async (trx): Promise<ReadAdvance> => {
      const target = await trx
        .selectFrom('room_messages')
        .select('id')
        .where('room_id', '=', roomId)
        .where('id', '=', tuple.id)
        .where('deleted_at', 'is', null)
        .where((eb) => eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', sql<Date>`current_timestamp`)]))
        .where('created_at', '=', at)
        .forShare()
        .executeTakeFirst();
      if (!target) return null;
      // room_chat_reads has no updated_at column: 20260718122000 gave one only
      // to the new direct_message_read_cursors table. Writing it here made every
      // cursor-based room read fail in the database, so nothing was ever stored
      // and the unread count came back on reload.
      const advanced = await trx
        .insertInto('room_chat_reads')
        .values({
          room_id: roomId,
          user_id: userId,
          last_read_at: at,
          last_read_message_created_at: at,
          last_read_message_id: target.id
        })
        .onConflict((oc) =>
          oc
            .columns(['room_id', 'user_id'])
            .doUpdateSet((eb) => ({
              last_read_at: sql<Date>`GREATEST(room_chat_reads.last_read_at, EXCLUDED.last_read_at)`,
              last_read_message_created_at: eb.ref('excluded.last_read_message_created_at'),
              last_read_message_id: eb.ref('excluded.last_read_message_id')
            }))
            .where(
              sql<boolean>`room_chat_reads.last_read_message_created_at IS NULL
                OR (room_chat_reads.last_read_message_created_at, room_chat_reads.last_read_message_id)
                   < (EXCLUDED.last_read_message_created_at, EXCLUDED.last_read_message_id)`
            )
        )
        .returning(['last_read_message_created_at', 'last_read_message_id'])
        .executeTakeFirst();
      return (advanced as ReadCursorRow | undefined) || { unchanged: true };
    });
  }

  async function advanceDm({
    peerId,
    userId,
    tuple
  }: {
    peerId: string;
    userId: string;
    tuple: ReadTuple;
  }): Promise<ReadAdvance> {
    const at = fromMicros(tuple.createdAtMicros);
    return db.transaction().execute(async (trx): Promise<ReadAdvance> => {
      const target = await trx
        .selectFrom('direct_messages')
        .select('id')
        .where('id', '=', tuple.id)
        .where('deleted_at', 'is', null)
        .where((eb) =>
          eb.or([
            eb.and([eb('sender_id', '=', userId), eb('recipient_id', '=', peerId)]),
            eb.and([eb('sender_id', '=', peerId), eb('recipient_id', '=', userId)])
          ])
        )
        .where('created_at', '=', at)
        .forShare()
        .executeTakeFirst();
      if (!target) return null;
      const advanced = await trx
        .insertInto('direct_message_read_cursors')
        .values({
          user_id: userId,
          peer_user_id: peerId,
          last_read_message_created_at: at,
          last_read_message_id: target.id,
          updated_at: sql<Date>`current_timestamp`
        })
        .onConflict((oc) =>
          oc
            .columns(['user_id', 'peer_user_id'])
            .doUpdateSet((eb) => ({
              last_read_message_created_at: eb.ref('excluded.last_read_message_created_at'),
              last_read_message_id: eb.ref('excluded.last_read_message_id'),
              updated_at: sql<Date>`current_timestamp`
            }))
            .where(
              sql<boolean>`(direct_message_read_cursors.last_read_message_created_at, direct_message_read_cursors.last_read_message_id)
                < (EXCLUDED.last_read_message_created_at, EXCLUDED.last_read_message_id)`
            )
        )
        .returning(['last_read_message_created_at', 'last_read_message_id'])
        .executeTakeFirst();
      // Everything the peer sent up to the cursor is read.
      await trx
        .updateTable('direct_messages')
        .set({ read_at: sql<Date>`COALESCE(read_at, current_timestamp)` })
        .where('sender_id', '=', peerId)
        .where('recipient_id', '=', userId)
        .where('deleted_at', 'is', null)
        .where(sql<boolean>`(created_at, id) <= (${at}, ${target.id})`)
        .execute();
      return (advanced as ReadCursorRow | undefined) || { unchanged: true };
    });
  }

  return Object.freeze({ advanceDm, advanceRoom });
}

export { createMessageReadRepository };
