import type { ContactDecision } from '@voiceroom/shared/contracts/privacy';
import type { DirectContact } from '@voiceroom/shared/contracts/messages';
import type { Database } from '../../platform/db/kysely.ts';
import { lockKeys, lockXact } from '../../platform/db/locks.ts';
import { DomainError } from '../../platform/http/domain-error.ts';
import { loadContactFacts } from './contact-facts.repository.ts';
import { countNewChats } from './dm-pair-state.repository.ts';
import {
  canCall,
  canMessage,
  canRead,
  canType,
  isNewPair,
  officialExemption,
  type ContactFacts,
  type ContactLimits
} from './contact.policy.ts';
import { lockUserPair } from './social-records.ts';

export function createContactService(db: () => Database, limits: ContactLimits) {
  async function status(sender: string, recipient: string) {
    const facts = await loadContactFacts(db(), sender, recipient);
    if (!facts) return null;
    return {
      canRead: canRead(facts, limits) === 'allowed',
      ...projectContact(facts, limits)
    };
  }

  async function typing(sender: string, recipient: string) {
    const facts = await loadContactFacts(db(), sender, recipient);
    return facts !== null && canType(facts, limits) === 'allowed';
  }

  return { status, typing };
}

export function projectContact(
  facts: NonNullable<Awaited<ReturnType<typeof loadContactFacts>>>,
  limits: ContactLimits
): DirectContact {
  const messageReason = canMessage(facts, limits);
  return {
    peer: facts.peer,
    isFriend: facts.friends,
    canMessage: messageReason === 'allowed',
    messageReason,
    canCall: canCall(facts) === 'allowed'
  };
}

export async function withPairLock<T>(
  tx: Database,
  sender: string,
  recipient: string,
  run: (facts: Awaited<ReturnType<typeof loadContactFacts>>) => Promise<T>
): Promise<T> {
  await lockUserPair(tx, sender, recipient);
  return run(await loadContactFacts(tx, sender, recipient));
}

export function messageRefusal(reason: Exclude<ContactDecision, 'allowed'>): DomainError {
  switch (reason) {
    case 'blocked':
      return new DomainError('relationship_blocked', 403, 'Messaging is unavailable');
    case 'chat_cap':
      return new DomainError('chat_cap_reached', 429, 'Daily new-chat limit reached');
    case 'unanswered_cap':
      return new DomainError('unanswered_cap_reached', 429, 'Unanswered message limit reached');
    default:
      return new DomainError('messages_closed', 403, 'Recipient does not accept messages from this account');
  }
}

export async function authorizeMessage(tx: Database, sender: string, recipient: string, limits: ContactLimits) {
  return withPairLock(tx, sender, recipient, async (facts) => {
    if (!facts?.active) throw new DomainError('account_deleted', 403, 'Account is unavailable');
    const decision = canMessage(facts, limits);
    if (decision === 'blocked' || decision === 'friends_only' || decision === 'not_selected')
      throw messageRefusal(decision);
    const { startedAsStrangers, capped } = await newChatStart(tx, facts, limits.daily);
    const refusal = capped
      ? messageRefusal('chat_cap')
      : decision === 'unanswered_cap'
        ? messageRefusal(decision)
        : null;
    return { startedAsStrangers, refusal };
  });
}

// The pair lock is already held. Only new stranger pairs share a sender-wide budget.
export async function newChatStart(tx: Database, facts: ContactFacts | null, daily: number) {
  // A chat with the official account is no stranger chat: it spends no budget.
  const startedAsStrangers = facts !== null && !facts.friends && !officialExemption(facts) && isNewPair(facts);
  if (!startedAsStrangers || daily <= 0) return { startedAsStrangers, capped: false };
  await lockXact(tx, lockKeys.dmNewChat(facts.senderId));
  return { startedAsStrangers, capped: (await countNewChats(tx, facts.senderId)) >= daily };
}

export function authorizeMessageEdit(facts: ContactFacts | null, limits: ContactLimits): void {
  if (!facts?.active) throw new DomainError('account_deleted', 403, 'Account is unavailable');
  const decision = canMessage(facts, limits);
  if (decision !== 'allowed') throw messageRefusal(decision);
}

export function callRefusal(facts: Awaited<ReturnType<typeof loadContactFacts>>) {
  if (!facts?.active) return 'account_deleted' as const;
  const decision = canCall(facts);
  if (decision === 'allowed') return null;
  return decision === 'blocked' ? ('blocked' as const) : ('calls_closed' as const);
}

export async function getCallRefusal(db: Database, caller: string, recipient: string) {
  return callRefusal(await loadContactFacts(db, caller, recipient));
}
