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

/** Mirrors the friends API relationship plus the guest case. */
export type ProfileCardRelationship = 'self' | 'friend' | 'outgoing' | 'incoming' | 'none' | 'unavailable';

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
