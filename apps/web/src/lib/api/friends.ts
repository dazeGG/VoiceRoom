// Friends, friend requests, and people search. Shapes come from the shared
// social contract the API answers with.

import {
  BlockApplied,
  BlockList,
  Done,
  FriendList,
  FriendRequestAnswered,
  FriendRequests,
  FriendRequestSent,
  type IncomingRequest,
  type OutgoingRequest,
  type SendRequestStatus
} from '@voice-room/shared/contracts/social';
import type { PublicUser } from '@voice-room/shared/contracts/users';
import { api } from './client';

export type {
  Friend,
  FriendLastMessage,
  IncomingRequest,
  OutgoingRequest,
  Relationship,
  SearchResult,
  SendRequestStatus
} from '@voice-room/shared/contracts/social';
export type { PublicUser } from '@voice-room/shared/contracts/users';

export async function fetchFriends(): Promise<Pick<FriendList, 'friends' | 'incomingRequestCount'>> {
  const { friends, incomingRequestCount } = await api.get('/api/friends', FriendList);
  return { friends, incomingRequestCount };
}

export async function fetchRequests(): Promise<{ incoming: IncomingRequest[]; outgoing: OutgoingRequest[] }> {
  const { incoming, outgoing } = await api.get('/api/friends/requests', FriendRequests);
  return { incoming, outgoing };
}

async function sendRequest(body: { login: string } | { userId: string }) {
  const { status, user } = await api.post('/api/friends/requests', FriendRequestSent, body);
  return { status, user };
}

export function sendFriendRequest(login: string): Promise<{ status: SendRequestStatus; user: PublicUser }> {
  return sendRequest({ login });
}

export function sendFriendRequestByUserId(userId: string): Promise<{ status: SendRequestStatus; user: PublicUser }> {
  return sendRequest({ userId });
}

export async function acceptFriendRequest(requestId: string): Promise<PublicUser> {
  const answer = await api.post(`/api/friends/requests/${encodeURIComponent(requestId)}/accept`, FriendRequestAnswered);
  if (answer.status !== 'accepted') throw new Error('Заявка больше недоступна');
  return answer.user;
}

export async function declineFriendRequest(requestId: string): Promise<void> {
  await api.post(`/api/friends/requests/${encodeURIComponent(requestId)}/decline`, FriendRequestAnswered);
}

export async function cancelFriendRequest(requestId: string): Promise<void> {
  await api.delete(`/api/friends/requests/${encodeURIComponent(requestId)}`, Done);
}

export async function removeFriend(userId: string): Promise<void> {
  await api.delete(`/api/friends/${encodeURIComponent(userId)}`, Done);
}

// Blocking ends the friendship, cancels pending friend requests in both
// directions, and — because DM and room invites both require an active
// friendship — stops those too. It does not prevent sharing a room.

function blockUrl(userId: string): string {
  return `/api/blocks/${encodeURIComponent(userId)}`;
}

export async function fetchBlockedUsers(): Promise<PublicUser[]> {
  return (await api.get('/api/blocks', BlockList)).users;
}

export async function blockUser(userId: string): Promise<BlockApplied['status']> {
  return (await api.put(blockUrl(userId), BlockApplied)).status;
}

export async function unblockUser(userId: string): Promise<void> {
  await api.delete(blockUrl(userId), Done);
}
