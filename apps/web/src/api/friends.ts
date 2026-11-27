// Friends, friend requests, and people search. Shapes come from the shared
// social contract the API answers with.

import { t } from '@/shared/i18n';
import {
  BlockApplied,
  BlockBody,
  BlockList,
  Done,
  FriendList,
  FriendRequestAnswered,
  FriendRequests,
  FriendSearch,
  FriendRequestSent,
  SendFriendRequestBody,
  type IncomingRequest,
  type OutgoingRequest,
  type SendRequestStatus
} from '@voiceroom/shared/contracts/social';
import type { PublicUser } from '@voiceroom/shared/contracts/users';
import { api } from './client';

export type {
  Friend,
  FriendLastMessage,
  IncomingRequest,
  OutgoingRequest,
  Relationship,
  SearchResult,
  SendRequestStatus
} from '@voiceroom/shared/contracts/social';
export type { PublicUser } from '@voiceroom/shared/contracts/users';

export async function fetchFriends(): Promise<Pick<FriendList, 'friends' | 'incomingRequestCount'>> {
  const { friends, incomingRequestCount } = await api.get('/api/friends', FriendList);
  return { friends, incomingRequestCount };
}

export async function searchPeople(query: string, signal: AbortSignal): Promise<FriendSearch['results']> {
  const params = new URLSearchParams({ q: query });
  const { results } = await api.get(`/api/friends/search?${params}`, FriendSearch, {
    signal,
    fallback: t('Не удалось найти людей')
  });
  return results;
}

export async function fetchRequests(): Promise<{ incoming: IncomingRequest[]; outgoing: OutgoingRequest[] }> {
  const { incoming, outgoing } = await api.get('/api/friends/requests', FriendRequests);
  return { incoming, outgoing };
}

async function sendRequest(body: { login: string } | { userId: string }) {
  const { status, user } = await api.post('/api/friends/requests', FriendRequestSent, body, {
    bodySchema: SendFriendRequestBody
  });
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
  if (answer.status !== 'accepted') throw new Error(t('Заявка больше недоступна'));
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

// Blocking ends the friendship, cancels pending requests and stops direct contact.

function blockUrl(userId: string): string {
  return `/api/blocks/${encodeURIComponent(userId)}`;
}

export async function fetchBlockedUsers(): Promise<PublicUser[]> {
  return (await api.get('/api/blocks', BlockList)).users;
}

export async function blockUser(userId: string, deleteConversation = false): Promise<BlockApplied['status']> {
  return (await api.put(blockUrl(userId), BlockApplied, { deleteConversation }, { bodySchema: BlockBody })).status;
}

export async function unblockUser(userId: string): Promise<void> {
  await api.delete(blockUrl(userId), Done);
}
