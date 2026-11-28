import type pg from 'pg';
import { kyselyOn } from '../../platform/db/kysely.ts';
import { transaction } from '../../platform/db/pool.ts';
import { DomainError } from '../../platform/http/domain-error.ts';
import type { AccountMessage } from '../../realtime/account-events.ts';
import { createAttachmentRepository } from '../media/attachment.repository.ts';
import { lockUserPair } from '../social/social-records.ts';
import { hasActiveVoiceCall, purgeDirectConversation } from './dm-conversation-delete.repository.ts';

export function createDmConversationDeleteService(deps: {
  pool(): pg.Pool;
  notifyUser(userId: string, event: AccountMessage): void;
  refreshCallMisses(userId: string, peerId: string): void;
}) {
  async function removeLocked(client: pg.PoolClient, userId: string, peerId: string): Promise<boolean> {
    if (await hasActiveVoiceCall(client, userId, peerId)) {
      throw new DomainError('conversation_call_active', 409, 'End the voice call before deleting the conversation');
    }
    return purgeDirectConversation(client, userId, peerId, createAttachmentRepository({ pool: deps.pool() }));
  }

  function publish(userId: string, peerId: string): void {
    deps.notifyUser(userId, { type: 'dm.conversation.deleted', peerId });
    deps.notifyUser(peerId, { type: 'dm.conversation.deleted', peerId: userId });
    deps.refreshCallMisses(userId, peerId);
    deps.refreshCallMisses(peerId, userId);
  }

  async function remove(userId: string, peerId: string): Promise<void> {
    const deleted = await transaction(deps.pool(), async (client) => {
      await lockUserPair(kyselyOn(client), userId, peerId);
      return removeLocked(client, userId, peerId);
    });
    if (deleted) publish(userId, peerId);
  }

  return { remove, removeLocked, publish };
}
