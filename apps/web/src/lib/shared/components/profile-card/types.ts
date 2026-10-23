import type { Relationship } from '@voice-room/shared/contracts/social';
import type { PresenceStatus } from '$lib/shared/presence';

/**
 * Everything the card needs to render a person. `userId` is null for room
 * guests, who have no account and therefore no social actions.
 */
export interface ProfileCardPerson {
  userId: string | null;
  name: string;
  login: string;
  avatarUrl: string | null;
  avatarColorKey: string;
  avatarAccent: string | null;
  presence: PresenceStatus;
}

/** The friends API relationship plus oneself and the guest case. */
export type ProfileCardRelationship = Relationship | 'self' | 'unavailable';

export interface ProfileCardProps {
  person: ProfileCardPerson;
  relationship: ProfileCardRelationship;
  /** Epoch millis the friendship started; only shown when relationship is 'friend'. */
  friendsSince?: number | null;
  busy?: boolean;
  onMessage?: () => void;
  onAddFriend?: () => void;
  onAcceptRequest?: () => void;
  onRemoveFriend?: () => void;
}
