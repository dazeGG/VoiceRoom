import { sql, type OperandValueExpressionOrList } from 'kysely';
import type { ContactAudience } from '@voiceroom/shared/contracts/privacy';
import type { Database } from '../../platform/db/kysely.ts';
import type { DB } from '../../platform/db/schema.ts';
import { OFFICIAL_ACCOUNT_ID } from '@voiceroom/shared/official-account';
import { cleanBadge } from '../account/user-records.ts';
import { newChats } from './dm-pair-state.repository.ts';
import { mapPublicUser, orderedPair } from './social-records.ts';

type AccountId = OperandValueExpressionOrList<DB, 'user_blocks', 'blocker_id'>;

export function pairBlocks(db: Database, a: AccountId, b: AccountId) {
  return db
    .selectFrom('user_blocks')
    .select('blocker_id')
    .where((eb) =>
      eb.or([
        eb.and([eb('blocker_id', '=', a), eb('blocked_id', '=', b)]),
        eb.and([eb('blocker_id', '=', b), eb('blocked_id', '=', a)])
      ])
    );
}

export function contactAudience(value: string | null | undefined, fallback: ContactAudience): ContactAudience {
  return value === 'everyone' || value === 'friends' || value === 'selected' ? value : fallback;
}

export async function loadContactFacts(db: Database, senderId: string, recipientId: string) {
  const [low, high] = orderedPair(senderId, recipientId);
  const row = await db
    .selectFrom('users as sender')
    .innerJoin('users as recipient', (join) => join.on('recipient.id', '=', recipientId))
    .leftJoin('dm_pair_state as pair', (join) => join.on('pair.user_low', '=', low).on('pair.user_high', '=', high))
    .where('sender.id', '=', senderId)
    .select([
      'sender.messages_from as senderMessagesFrom',
      'sender.calls_from as senderCallsFrom',
      'sender.badge as senderBadge',
      'recipient.messages_from as messagesFrom',
      'recipient.calls_from as callsFrom',
      'recipient.badge as recipientBadge',
      'recipient.id',
      'recipient.login',
      'recipient.display_name',
      'recipient.avatar_accent',
      'recipient.avatar_color_key',
      'recipient.avatar_key',
      'recipient.created_at',
      'recipient.dnd',
      'recipient.presence_status',
      'pair.last_sender_id',
      'pair.unanswered_count'
    ])
    .select((eb) => [
      eb
        .and([
          eb('sender.id', '!=', recipientId),
          eb('sender.deleted_at', 'is', null),
          eb('sender.deletion_requested_at', 'is', null),
          eb.or([eb('sender.blocked_at', 'is', null), eb('sender.blocked_until', '<=', sql<Date>`clock_timestamp()`)]),
          eb('recipient.deleted_at', 'is', null),
          eb('recipient.deletion_requested_at', 'is', null),
          eb.or([
            eb('recipient.blocked_at', 'is', null),
            eb('recipient.blocked_until', '<=', sql<Date>`clock_timestamp()`)
          ])
        ])
        .as('active'),
      eb
        .exists(eb.selectFrom('friendships').select('id').where('user_a_id', '=', low).where('user_b_id', '=', high))
        .as('friends'),
      eb.exists(pairBlocks(db, low, high)).as('blocked'),
      eb
        .exists(
          eb
            .selectFrom('direct_messages')
            .select('id')
            .where(sql<string>`least(sender_id, recipient_id)`, '=', low)
            .where(sql<string>`greatest(sender_id, recipient_id)`, '=', high)
        )
        .as('hasMessages'),
      eb
        .exists(
          eb
            .selectFrom('contact_allow_list')
            .select('allowed_id')
            .where('owner_id', '=', recipientId)
            .where('allowed_id', '=', senderId)
            .where('kind', '=', 'messages')
        )
        .as('selectedForMessages'),
      eb
        .exists(
          eb
            .selectFrom('contact_allow_list')
            .select('allowed_id')
            .where('owner_id', '=', recipientId)
            .where('allowed_id', '=', senderId)
            .where('kind', '=', 'calls')
        )
        .as('selectedForCalls'),
      newChats(db, senderId).as('newChatsToday')
    ])
    .executeTakeFirst();
  if (!row) return null;
  const { last_sender_id, unanswered_count, ...facts } = row;
  return {
    ...facts,
    senderId,
    active: Boolean(facts.active),
    friends: Boolean(facts.friends),
    blocked: Boolean(facts.blocked),
    hasMessages: Boolean(facts.hasMessages),
    selectedForMessages: Boolean(facts.selectedForMessages),
    selectedForCalls: Boolean(facts.selectedForCalls),
    peer: { ...mapPublicUser(row), badge: cleanBadge(row.recipientBadge) },
    senderOfficial: senderId === OFFICIAL_ACCOUNT_ID,
    recipientOfficial: recipientId === OFFICIAL_ACCOUNT_ID,
    pair: last_sender_id === null || unanswered_count === null ? null : { last_sender_id, unanswered_count },
    messagesFrom: contactAudience(facts.messagesFrom, 'everyone'),
    callsFrom: contactAudience(facts.callsFrom, 'friends'),
    newChatsToday: facts.newChatsToday ?? 0
  };
}
