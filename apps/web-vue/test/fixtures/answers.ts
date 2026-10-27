// Server answers shaped like their contracts, for stubbed fetch routes. The
// API client checks every success body against its schema, so a stub that
// leaves a field out is refused the way a broken server would be.

import type { MembershipMember } from '@voice-room/shared/contracts/membership';
import type { DirectHistoryMessage, DirectMessage } from '@voice-room/shared/contracts/messages';
import type { LobbyRoom, RoomCreated, RoomStatus } from '@voice-room/shared/contracts/rooms';
import type { Friend, IncomingRequest, OutgoingRequest } from '@voice-room/shared/contracts/social';
import type { PublicUser } from '@voice-room/shared/contracts/users';

export function roomStatus(overrides: Partial<RoomStatus> = {}): RoomStatus {
  return {
    ok: true,
    exists: true,
    roomId: 'abc123',
    name: 'Комната',
    isStatic: false,
    avatarUrl: null,
    createdAt: 1,
    maxRoomPeers: 25,
    peers: 0,
    ...overrides
  };
}

export function lobbyRoom(overrides: Partial<LobbyRoom> = {}): LobbyRoom {
  return {
    roomId: 'abc123',
    name: 'Комната',
    avatarUrl: null,
    createdAt: 1,
    isStatic: true,
    peers: 0,
    relationship: 'owner',
    ...overrides
  };
}

export function roomCreated(overrides: Partial<RoomCreated> = {}): RoomCreated {
  return {
    ok: true,
    roomId: 'abc123',
    name: '',
    avatarUrl: null,
    createdAt: 1,
    isStatic: false,
    maxRooms: 10,
    maxRoomPeers: 25,
    owned: false,
    ...overrides
  };
}

export function publicUser(overrides: Partial<PublicUser> = {}): PublicUser {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    login: 'bob',
    displayName: 'Боб',
    avatarUrl: null,
    avatarColorKey: 'blue',
    avatarAccent: null,
    createdAt: 1,
    doNotDisturb: false,
    presenceStatus: 'offline',
    ...overrides
  };
}

export function friend(overrides: Partial<Friend> = {}): Friend {
  return { user: publicUser(), friendsSince: 1, online: false, unreadCount: 0, lastMessage: null, ...overrides };
}

export function incomingRequest(overrides: Partial<IncomingRequest> = {}): IncomingRequest {
  return { id: 'request-in', user: publicUser(), createdAt: 1, mutualFriends: 0, ...overrides };
}

export function outgoingRequest(overrides: Partial<OutgoingRequest> = {}): OutgoingRequest {
  return { id: 'request-out', user: publicUser(), createdAt: 1, ...overrides };
}

export function member(overrides: Partial<MembershipMember> = {}): MembershipMember {
  return {
    userId: 'u-1',
    displayName: 'Аня',
    login: 'anya',
    avatarColorKey: 'blue',
    avatarUrl: null,
    avatarAccent: null,
    role: 'member',
    joinedAt: 1,
    inVoice: false,
    presenceStatus: 'online',
    ...overrides
  };
}

export function directMessage(overrides: Partial<DirectMessage> = {}): DirectMessage {
  return {
    id: 'm1',
    senderId: '11111111-1111-4111-8111-111111111111',
    recipientId: '22222222-2222-4222-8222-222222222222',
    body: '',
    createdAt: 1,
    editedAt: null,
    readAt: null,
    invite: null,
    ...overrides
  };
}

export function directHistoryMessage(overrides: Partial<DirectHistoryMessage> = {}): DirectHistoryMessage {
  return {
    kind: 'dm',
    id: 'm1',
    author: { userId: '11111111-1111-4111-8111-111111111111' },
    recipientId: '22222222-2222-4222-8222-222222222222',
    content: { type: 'text', text: '' },
    createdAt: 1,
    cursor: 'c1',
    readCursor: 'r1',
    ...overrides
  };
}
