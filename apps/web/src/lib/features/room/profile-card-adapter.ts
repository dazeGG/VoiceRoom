// Turns a room participant into the shape the shared profile card renders.
// Room presence deliberately does not carry @logins for strangers, so the login
// is looked up from people we already know and left blank otherwise.

import type { ProfileCardPerson } from '$lib/shared/components/profile-card';
import type { RoomSocial } from './social';
import type { PresenceStatus } from '$lib/shared/presence';
import type { Participant } from './client/model/participants';
import type { ChatMessage } from '$lib/api/rooms';
import type { MembershipMember } from '@voice-room/shared/membership';

function presenceFor(social: RoomSocial, accountUserId: string): PresenceStatus {
  if (!accountUserId) return 'online';
  const friend = social.friends().find((entry) => entry.user.id === accountUserId);
  // Not a friend: they are visibly in the room, so treat them as online rather
  // than claiming an offline status we cannot actually observe.
  if (!friend) return 'online';
  if (!friend.online) return 'offline';
  if (friend.user.doNotDisturb) return 'dnd';
  return (friend.user.presenceStatus as PresenceStatus) || 'online';
}

export function participantProfilePerson(social: RoomSocial, participant: Participant): ProfileCardPerson {
  const userId = participant.accountUserId || null;
  return {
    userId,
    name: participant.name,
    login: userId ? social.knownLogin(userId) : '',
    avatarUrl: participant.avatarUrl || null,
    avatarColorKey: participant.avatarColorKey || '',
    avatarAccent: participant.avatarAccent || null,
    presence: userId ? presenceFor(social, userId) : 'online'
  };
}

export function roomMessageProfilePerson(social: RoomSocial, message: ChatMessage): ProfileCardPerson {
  const userId = message.authorUserId || null;
  return {
    userId,
    name: message.name,
    login: userId ? social.knownLogin(userId) : '',
    avatarUrl: message.avatarUrl || null,
    avatarColorKey: message.avatarColorKey || '',
    avatarAccent: message.avatarAccent || null,
    presence: userId ? presenceFor(social, userId) : 'online'
  };
}

/**
 * A mention carries only a user id and the label it was written with, so the
 * card is filled in from whoever we already know about that person — the room
 * membership first, then a live participant — and falls back to the label when
 * they are a stranger who has since left.
 */
export function mentionProfilePerson(
  social: RoomSocial,
  userId: string,
  label: string,
  members: readonly MembershipMember[],
  participants: readonly Participant[]
): ProfileCardPerson {
  const member = members.find((entry) => entry.userId === userId);
  if (member) {
    return {
      userId,
      name: member.displayName || member.login,
      login: member.login,
      avatarUrl: member.avatarUrl,
      avatarColorKey: member.avatarColorKey || '',
      avatarAccent: member.avatarAccent,
      presence: presenceFor(social, userId)
    };
  }

  const participant = participants.find((entry) => entry.accountUserId === userId);
  if (participant) return participantProfilePerson(social, participant);

  return {
    userId,
    name: label.replace(/^@/, ''),
    login: social.knownLogin(userId),
    avatarUrl: null,
    avatarColorKey: '',
    avatarAccent: null,
    presence: presenceFor(social, userId)
  };
}
