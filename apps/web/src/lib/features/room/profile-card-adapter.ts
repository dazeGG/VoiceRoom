// Turns a room participant into the shape the shared profile card renders.
// Room presence deliberately does not carry @logins for strangers, so the login
// is looked up from people we already know and left blank otherwise.

import type { ProfileCardPerson } from '$lib/shared/components/profile-card';
import { friendsState, getKnownLogin } from '$lib/features/home/model/friends.svelte';
import type { PresenceStatus } from '$lib/shared/presence';
import type { Participant } from './client/model/participants';

function presenceFor(accountUserId: string): PresenceStatus {
  if (!accountUserId) return 'online';
  const friend = friendsState.friends.find((entry) => entry.user.id === accountUserId);
  // Not a friend: they are visibly in the room, so treat them as online rather
  // than claiming an offline status we cannot actually observe.
  if (!friend) return 'online';
  if (!friend.online) return 'offline';
  if (friend.user.doNotDisturb) return 'dnd';
  return (friend.user.presenceStatus as PresenceStatus) || 'online';
}

export function participantProfilePerson(participant: Participant): ProfileCardPerson {
  const userId = participant.accountUserId || null;
  return {
    userId,
    name: participant.name,
    login: userId ? getKnownLogin(userId) : '',
    avatarUrl: participant.avatarUrl || null,
    avatarColorKey: participant.avatarColorKey || '',
    avatarAccent: participant.avatarAccent || null,
    presence: userId ? presenceFor(userId) : 'online'
  };
}
