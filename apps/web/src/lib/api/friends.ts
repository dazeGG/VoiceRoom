// Friends, friend requests, and people search. Shapes come from the shared
// social contract the API answers with.

import type {
  BlockApplied,
  BlockList,
  Done,
  FriendList,
  FriendRequestAnswered,
  FriendRequests,
  FriendRequestSent,
  FriendSearch,
  IncomingRequest,
  OutgoingRequest,
  SearchResult,
  SendRequestStatus
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
  const { friends, incomingRequestCount } = await api.get<FriendList>('/api/friends');
  return { friends, incomingRequestCount };
}

export async function searchUsers(query: string): Promise<SearchResult[]> {
  return (await api.get<FriendSearch>(`/api/friends/search?q=${encodeURIComponent(query)}`)).results;
}

export async function fetchRequests(): Promise<{ incoming: IncomingRequest[]; outgoing: OutgoingRequest[] }> {
  const { incoming, outgoing } = await api.get<FriendRequests>('/api/friends/requests');
  return { incoming, outgoing };
}

async function sendRequest(body: { login: string } | { userId: string }) {
  const { status, user } = await api.post<FriendRequestSent>('/api/friends/requests', body);
  return { status, user };
}

export function sendFriendRequest(login: string): Promise<{ status: SendRequestStatus; user: PublicUser }> {
  return sendRequest({ login });
}

export function sendFriendRequestByUserId(userId: string): Promise<{ status: SendRequestStatus; user: PublicUser }> {
  return sendRequest({ userId });
}

export async function acceptFriendRequest(requestId: string): Promise<PublicUser> {
  const answer = await api.post<FriendRequestAnswered>(`/api/friends/requests/${encodeURIComponent(requestId)}/accept`);
  if (answer.status !== 'accepted') throw new Error('Заявка больше недоступна');
  return answer.user;
}

export async function declineFriendRequest(requestId: string): Promise<void> {
  await api.post<FriendRequestAnswered>(`/api/friends/requests/${encodeURIComponent(requestId)}/decline`);
}

export async function cancelFriendRequest(requestId: string): Promise<void> {
  await api.delete<Done>(`/api/friends/requests/${encodeURIComponent(requestId)}`);
}

export async function removeFriend(userId: string): Promise<void> {
  await api.delete<Done>(`/api/friends/${encodeURIComponent(userId)}`);
}

// Blocking ends the friendship, cancels pending friend requests in both
// directions, and — because DM and room invites both require an active
// friendship — stops those too. It does not prevent sharing a room.

function blockUrl(userId: string): string {
  return `/api/blocks/${encodeURIComponent(userId)}`;
}

export async function fetchBlockedUserIds(): Promise<string[]> {
  return (await api.get<BlockList>('/api/blocks')).blocked;
}

export async function fetchBlockedUsers(): Promise<PublicUser[]> {
  return (await api.get<BlockList>('/api/blocks')).users;
}

export async function blockUser(userId: string): Promise<BlockApplied['status']> {
  return (await api.put<BlockApplied>(blockUrl(userId))).status;
}

export async function unblockUser(userId: string): Promise<void> {
  await api.delete<Done>(blockUrl(userId));
}
