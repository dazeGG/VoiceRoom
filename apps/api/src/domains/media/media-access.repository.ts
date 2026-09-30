import { sql } from 'kysely';
import type pg from 'pg';
import { kyselyOn } from '../../platform/db/kysely.ts';

// Who may see the message an attachment belongs to.
export function createMediaAccessRepository({ pool }: { pool: Pick<pg.Pool, 'query'> }) {
  const db = kyselyOn(pool);

  // The room of a live room message the viewer is a member of, or null.
  async function roomOfVisibleRoomMessage({
    messageId,
    viewerId
  }: {
    messageId: string;
    viewerId: string;
  }): Promise<string | null> {
    const row = await db
      .selectFrom('room_messages as message')
      .innerJoin('rooms as room', (join) =>
        join.onRef('room.id', '=', 'message.room_id').on('room.deleted_at', 'is', null)
      )
      .innerJoin('room_memberships as membership', (join) =>
        join.onRef('membership.room_id', '=', 'room.id').on('membership.user_id', '=', viewerId)
      )
      .select('room.id as room_id')
      .where('message.id', '=', messageId)
      .where('message.deleted_at', 'is', null)
      .where((eb) =>
        eb.or([eb('message.expires_at', 'is', null), eb('message.expires_at', '>', sql<Date>`current_timestamp`)])
      )
      .limit(1)
      .executeTakeFirst();
    return row?.room_id ?? null;
  }

  // Whether the viewer sent or received a live direct message.
  async function canSeeDirectMessage({ messageId, viewerId }: { messageId: string; viewerId: string }) {
    const row = await db
      .selectFrom('direct_messages')
      .select('id')
      .where('id', '=', messageId)
      .where('deleted_at', 'is', null)
      .where((eb) => eb.or([eb('sender_id', '=', viewerId), eb('recipient_id', '=', viewerId)]))
      .limit(1)
      .executeTakeFirst();
    return Boolean(row);
  }

  return { canSeeDirectMessage, roomOfVisibleRoomMessage };
}
