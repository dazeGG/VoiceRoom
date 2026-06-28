// Friends, friend requests, and people search. All requests are same-origin and
// carry the HttpOnly session cookie (see http.ts credentialed helpers).

import { del, getJsonAuth, postJsonAuth } from './http';

// Mirrors the server's publicUser() shape (user-store.js).
export interface PublicUser {
  avatarColorKey: string;
  createdAt: number;
  displayName: string;
  id: string;
  login: string;
}

export interface FriendLastMessage {
  id: string;
  body: string;
  createdAt: number;
  fromMe: boolean;
}

export interface Friend {
  user: PublicUser;
  online: boolean;
  unreadCount: number;
  lastMessage: FriendLastMessage | null;
}

export type Relationship = 'friend' | 'outgoing' | 'incoming' | 'none';

export interface SearchResult {
  user: PublicUser;
  online: boolean;
  relationship: Relationship;
}

export interface IncomingRequest {
  id: string;
  createdAt: number;
  mutualFriends: number;
  user: PublicUser;
}

export interface OutgoingRequest {
  id: string;
  createdAt: number;
  user: PublicUser;
}

export type SendRequestStatus = 'sent' | 'accepted' | 'already_sent' | 'already_friends';

export async function fetchFriends(): Promise<{ friends: Friend[]; incomingRequestCount: number }> {
  const payload = await getJsonAuth<{ friends?: Friend[]; incomingRequestCount?: number }>('/api/friends');
  return {
    friends: Array.isArray(payload.friends) ? payload.friends : [],
    incomingRequestCount: payload.incomingRequestCount ?? 0
  };
}

export async function searchUsers(query: string): Promise<SearchResult[]> {
  const payload = await getJsonAuth<{ results?: SearchResult[] }>(
    `/api/friends/search?q=${encodeURIComponent(query)}`
  );
  return Array.isArray(payload.results) ? payload.results : [];
}

export async function fetchRequests(): Promise<{ incoming: IncomingRequest[]; outgoing: OutgoingRequest[] }> {
  const payload = await getJsonAuth<{ incoming?: IncomingRequest[]; outgoing?: OutgoingRequest[] }>(
    '/api/friends/requests'
  );
  return {
    incoming: Array.isArray(payload.incoming) ? payload.incoming : [],
    outgoing: Array.isArray(payload.outgoing) ? payload.outgoing : []
  };
}

export async function sendFriendRequest(login: string): Promise<{ status: SendRequestStatus; user: PublicUser }> {
  const payload = await postJsonAuth<{ status: SendRequestStatus; user: PublicUser }>('/api/friends/requests', {
    login
  });
  return payload;
}

export async function acceptFriendRequest(requestId: string): Promise<PublicUser> {
  const payload = await postJsonAuth<{ user: PublicUser }>(
    `/api/friends/requests/${encodeURIComponent(requestId)}/accept`,
    {}
  );
  return payload.user;
}

export async function declineFriendRequest(requestId: string): Promise<void> {
  await postJsonAuth(`/api/friends/requests/${encodeURIComponent(requestId)}/decline`, {});
}

export async function cancelFriendRequest(requestId: string): Promise<void> {
  await del(`/api/friends/requests/${encodeURIComponent(requestId)}`);
}

export async function removeFriend(userId: string): Promise<void> {
  await del(`/api/friends/${encodeURIComponent(userId)}`);
}
