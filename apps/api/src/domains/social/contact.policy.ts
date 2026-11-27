import type { ContactAudience, ContactDecision } from '@voiceroom/shared/contracts/privacy';

export interface ContactLimits {
  daily: number;
  unanswered: number;
}

export interface ContactFacts {
  friends: boolean;
  blocked: boolean;
  active: boolean;
  hasMessages: boolean;
  messagesFrom: ContactAudience;
  callsFrom: ContactAudience;
  selectedForMessages: boolean;
  selectedForCalls: boolean;
  pair: { last_sender_id: string; unanswered_count: number } | null;
  newChatsToday: number;
  senderId: string;
}

export function isNewPair(facts: ContactFacts): boolean {
  return !facts.pair && !facts.hasMessages;
}

function audience(
  facts: Pick<ContactFacts, 'friends' | 'blocked' | 'active'>,
  { setting, selected }: { setting: ContactAudience; selected: boolean }
): ContactDecision {
  if (facts.blocked || !facts.active) return 'blocked';
  if (setting === 'friends' && !facts.friends) return 'friends_only';
  if (setting === 'selected' && !selected) return 'not_selected';
  return 'allowed';
}

export function canMessage(facts: ContactFacts, limits: ContactLimits): ContactDecision {
  const decision = audience(facts, { setting: facts.messagesFrom, selected: facts.selectedForMessages });
  if (decision !== 'allowed' || facts.friends) return decision;
  if (isNewPair(facts) && limits.daily > 0 && facts.newChatsToday >= limits.daily) return 'chat_cap';
  const { pair } = facts;
  if (pair?.last_sender_id === facts.senderId && limits.unanswered > 0 && pair.unanswered_count >= limits.unanswered)
    return 'unanswered_cap';
  return 'allowed';
}

export function canRead(facts: ContactFacts, limits: ContactLimits): ContactDecision {
  return facts.friends || facts.hasMessages ? 'allowed' : canMessage(facts, limits);
}

export function canCall(
  facts: Pick<ContactFacts, 'friends' | 'blocked' | 'active' | 'callsFrom' | 'selectedForCalls'>
): ContactDecision {
  return audience(facts, { setting: facts.callsFrom, selected: facts.selectedForCalls });
}

export const canType = canMessage;
