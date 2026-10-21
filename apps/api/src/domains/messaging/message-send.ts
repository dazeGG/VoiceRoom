// The part of sending a message that room chat and DMs share. The store runs
// the two callbacks around the insert, in the sender's transaction: first the
// idempotency check (a replay answers the stored message), then, with the new
// row, the reply-target lock, the attachment binding, the service's own
// extras, the delivery outbox and the idempotency completion.

import crypto from 'node:crypto';
import type pg from 'pg';
import type { ReplyPreview } from '@voice-room/shared/contracts/messages';
import { replayedMessage, type IdempotencyInput, type Reservation } from './message-idempotency.repository.ts';
import { requireReplyTarget } from './reply-projector.ts';

export type DbClient = Pick<pg.PoolClient, 'query'> | null | undefined;

/** What a send needs of the idempotency ledger and the delivery outbox. */
export interface SendDelivery {
  idempotency: {
    reserve(client: DbClient, input: IdempotencyInput): Promise<Reservation>;
    complete(
      client: DbClient,
      key: string,
      result: { body: unknown; messageId: string; statusCode: number }
    ): Promise<unknown>;
  };
  outbox: { enqueue(client: DbClient, event: Record<string, unknown>): Promise<unknown> };
}

interface SendUnitOfWorkOptions<Message extends { id: string }, ReplyTarget> {
  delivery: SendDelivery | null;
  /** The client's Idempotency-Key; '' sends without a ledger entry. */
  idempotencyKey: string;
  actor: { type: 'account' | 'guest'; id: string };
  conversation: { type: 'room' | 'dm'; id: string };
  fingerprint: string;
  /** Whether a replayed answer holds a message of this conversation's shape. */
  isStored(value: unknown): value is Message;
  replayMissing: string;
  /** Locks the quoted message in the transaction; null when the send is no reply. */
  lockReply: ((client: DbClient) => Promise<ReplyTarget | null>) | null;
  bindAttachments: ((client: DbClient, inserted: Message) => Promise<unknown>) | null;
  /** Runs after the reply lock and the attachments, before delivery. */
  afterInsert: ((client: DbClient, inserted: Message, replyTarget: ReplyTarget | null) => Promise<unknown>) | null;
  /** What the outbox announces for the inserted row. */
  outboxMessage(inserted: Message): unknown;
}

export function sendUnitOfWork<Message extends { id: string }, ReplyTarget>(
  options: SendUnitOfWorkOptions<Message, ReplyTarget>
) {
  const { delivery, conversation } = options;
  let ledgerKey = '';
  let replyPreview: ReplyPreview | null = null;

  const beforeUnitOfWork =
    options.idempotencyKey && delivery
      ? async (client: DbClient) => {
          const reservation = await delivery.idempotency.reserve(client, {
            actorType: options.actor.type,
            actorId: options.actor.id,
            conversation,
            key: options.idempotencyKey,
            fingerprint: options.fingerprint
          });
          if (reservation.kind === 'replay') {
            const message = replayedMessage(reservation);
            if (!options.isStored(message)) throw new Error(options.replayMissing);
            return { replay: true as const, message };
          }
          ledgerKey = reservation.ledgerKey;
          return null;
        }
      : null;

  const unitOfWork =
    options.lockReply || options.bindAttachments || options.afterInsert || delivery
      ? async (client: DbClient, inserted: Message) => {
          let replyTarget: ReplyTarget | null = null;
          if (options.lockReply) {
            replyTarget = await options.lockReply(client);
            replyPreview = await requireReplyTarget({ message: replyTarget, visibility: true });
          }
          if (options.bindAttachments) await options.bindAttachments(client, inserted);
          if (options.afterInsert) await options.afterInsert(client, inserted, replyTarget);
          if (!delivery) return;
          await delivery.outbox.enqueue(client, {
            eventId: crypto.randomUUID(),
            type: 'message.created',
            conversation,
            messageId: inserted.id,
            message: options.outboxMessage(inserted)
          });
          if (ledgerKey) {
            await delivery.idempotency.complete(client, ledgerKey, {
              body: { message: inserted },
              messageId: inserted.id,
              statusCode: 201
            });
          }
        }
      : null;

  return { beforeUnitOfWork, unitOfWork, replyPreview: () => replyPreview };
}
