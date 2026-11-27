// A delivery fence for direct-message fan-out. Conversation deletion takes
// the pair lock before it purges the messages, so running the final existence
// check and the emission under the same lock orders every emission either
// before the purge commits (and before `dm.conversation.deleted`) or not at all.

import type pg from 'pg';
import { kyselyOn, withTransaction } from '../../platform/db/kysely.ts';
import { lockUserPair } from '../social/social-records.ts';

export interface FencedDirectMessage {
  id: string;
  senderId: string;
  recipientId: string;
}

/**
 * Runs `emit` while the message still exists, holding the pair lock. `emit`
 * must only start work (send frames, start a push): the lock is held until it
 * returns. Returns whether it ran.
 */
export async function whileDirectMessageLive(
  pool: pg.Pool,
  message: FencedDirectMessage,
  emit: () => void
): Promise<boolean> {
  return withTransaction(kyselyOn(pool), async (tx) => {
    await lockUserPair(tx, message.senderId, message.recipientId);
    const current = await tx
      .selectFrom('direct_messages')
      .select('id')
      .where('id', '=', message.id)
      .where('sender_id', '=', message.senderId)
      .where('recipient_id', '=', message.recipientId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!current) return false;
    emit();
    return true;
  });
}

export type DirectMessageFence = (message: FencedDirectMessage, emit: () => void) => Promise<boolean>;

/**
 * The fence for a lazily available pool; without a database it emits directly.
 * The message is already committed when the fence runs, so a fence failure
 * (pool wait, statement timeout, dropped connection) skips this live emission
 * and is reported instead of failing the request; clients catch up on resync.
 */
export function directMessageFence(
  pool: () => pg.Pool | null,
  onFailure: (error: unknown) => void
): DirectMessageFence {
  return async (message, emit) => {
    const connection = pool();
    if (!connection) {
      emit();
      return true;
    }
    try {
      return await whileDirectMessageLive(connection, message, emit);
    } catch (error) {
      onFailure(error);
      return false;
    }
  };
}
