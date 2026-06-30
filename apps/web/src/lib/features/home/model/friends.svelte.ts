// Lobby state for the friends/rooms experience: friend list, requests, the
// active main view, the open DM thread, and the realtime subscription that keeps
// them all live. Mirrors the session store's runes pattern.

import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  fetchFriends,
  fetchRequests,
  removeFriend as apiRemoveFriend,
  sendFriendRequest,
  sendFriendRequestByUserId,
  type Friend,
  type IncomingRequest,
  type OutgoingRequest,
  type PublicUser,
  type SendRequestStatus,
  type Relationship
} from '$lib/api/friends';
import { fetchThread, markThreadRead, sendDirectMessage, type DirectMessage } from '$lib/api/dm';
import { connectRealtime, type RealtimeEvent, type RealtimeHandle } from '$lib/api/realtime';

export type LobbyMode = 'friends' | 'rooms';
export type LobbyView = 'home' | 'dm' | 'requests' | 'add';

interface FriendsState {
  loaded: boolean;
  friends: Friend[];
  incomingRequestCount: number;
  requests: { incoming: IncomingRequest[]; outgoing: OutgoingRequest[] };
  mode: LobbyMode;
  view: LobbyView;
  selectedFriendId: string | null;
  threadPeer: PublicUser | null;
  thread: DirectMessage[];
  threadLoading: boolean;
  profileOpen: boolean;
}

export const friendsState = $state<FriendsState>({
  loaded: false,
  friends: [],
  incomingRequestCount: 0,
  requests: { incoming: [], outgoing: [] },
  mode: 'friends',
  view: 'home',
  selectedFriendId: null,
  threadPeer: null,
  thread: [],
  threadLoading: false,
  profileOpen: false
});

let realtime: RealtimeHandle | null = null;
let selfId = '';

function findFriend(userId: string): Friend | undefined {
  return friendsState.friends.find((entry) => entry.user.id === userId);
}

// --- Loading ------------------------------------------------------------

export async function refreshFriends(): Promise<void> {
  const { friends, incomingRequestCount } = await fetchFriends();
  friendsState.friends = friends;
  friendsState.incomingRequestCount = incomingRequestCount;
  friendsState.loaded = true;
}

export async function refreshRequests(): Promise<void> {
  friendsState.requests = await fetchRequests();
  friendsState.incomingRequestCount = friendsState.requests.incoming.length;
}

// Start the lobby: load the friend list and open the realtime stream. Returns a
// teardown function for onMount cleanup.
export function initLobby(currentUserId: string): () => void {
  selfId = currentUserId;
  void Promise.all([refreshFriends(), refreshRequests()]).catch(() => {
    friendsState.loaded = true;
  });
  realtime = connectRealtime(handleRealtimeEvent);
  return () => {
    realtime?.close();
    realtime = null;
  };
}

// --- Navigation ---------------------------------------------------------

export function setMode(mode: LobbyMode): void {
  friendsState.mode = mode;
}

export function showHome(): void {
  friendsState.view = 'home';
}

export function showRequests(): void {
  friendsState.view = 'requests';
  void refreshRequests().catch(() => {});
}

export function showAdd(): void {
  friendsState.view = 'add';
}

export async function openDm(userId: string): Promise<void> {
  friendsState.selectedFriendId = userId;
  friendsState.view = 'dm';
  friendsState.threadLoading = true;
  friendsState.thread = [];
  // Locally clear the unread badge; the GET also marks read server-side.
  const friend = findFriend(userId);
  if (friend) friend.unreadCount = 0;
  try {
    const { peer, messages } = await fetchThread(userId);
    if (friendsState.selectedFriendId !== userId) return;
    friendsState.threadPeer = peer;
    friendsState.thread = messages;
  } finally {
    if (friendsState.selectedFriendId === userId) friendsState.threadLoading = false;
  }
}

export function toggleProfile(): void {
  friendsState.profileOpen = !friendsState.profileOpen;
}

export function closeProfile(): void {
  friendsState.profileOpen = false;
}

// --- DM -----------------------------------------------------------------

export async function sendMessage(text: string): Promise<void> {
  const peerId = friendsState.selectedFriendId;
  const body = text.trim();
  if (!peerId || !body) return;
  const message = await sendDirectMessage(peerId, body);
  appendToThread(message);
  bumpLastMessage(peerId, message);
}

function appendToThread(message: DirectMessage): void {
  if (friendsState.thread.some((existing) => existing.id === message.id)) return;
  friendsState.thread = [...friendsState.thread, message];
}

function bumpLastMessage(peerId: string, message: DirectMessage): void {
  const friend = findFriend(peerId);
  if (!friend) return;
  friend.lastMessage = {
    id: message.id,
    body: message.body,
    createdAt: message.createdAt,
    fromMe: message.senderId === selfId
  };
}

// --- Friend request actions --------------------------------------------

export function getFriendRelationship(userId: string): Relationship {
  if (findFriend(userId)) return 'friend';
  if (friendsState.requests.incoming.some((request) => request.user.id === userId)) return 'incoming';
  if (friendsState.requests.outgoing.some((request) => request.user.id === userId)) return 'outgoing';
  return 'none';
}

// Resolve a user's @login when we already know them (friend or pending request).
// Returns '' for strangers, whose login is not exposed to the client.
export function getKnownLogin(userId: string): string {
  const friend = findFriend(userId);
  if (friend) return friend.user.login;
  const incoming = friendsState.requests.incoming.find((request) => request.user.id === userId);
  if (incoming) return incoming.user.login;
  const outgoing = friendsState.requests.outgoing.find((request) => request.user.id === userId);
  if (outgoing) return outgoing.user.login;
  return '';
}

export async function acceptRequestByUserId(userId: string): Promise<void> {
  const request = friendsState.requests.incoming.find((entry) => entry.user.id === userId);
  if (!request) return;
  await acceptRequest(request.id);
}

export async function addFriendByLogin(login: string): Promise<{ status: SendRequestStatus; user: PublicUser }> {
  const result = await sendFriendRequest(login);
  await Promise.all([refreshFriends().catch(() => {}), refreshRequests().catch(() => {})]);
  return result;
}

export async function addFriendByUserId(userId: string): Promise<{ status: SendRequestStatus; user: PublicUser }> {
  const result = await sendFriendRequestByUserId(userId);
  await Promise.all([refreshFriends().catch(() => {}), refreshRequests().catch(() => {})]);
  return result;
}

export async function acceptRequest(requestId: string): Promise<void> {
  await acceptFriendRequest(requestId);
  await Promise.all([refreshFriends().catch(() => {}), refreshRequests().catch(() => {})]);
}

export async function declineRequest(requestId: string): Promise<void> {
  await declineFriendRequest(requestId);
  await refreshRequests().catch(() => {});
}

export async function cancelRequest(requestId: string): Promise<void> {
  await cancelFriendRequest(requestId);
  await refreshRequests().catch(() => {});
}

export async function removeFriend(userId: string): Promise<void> {
  await apiRemoveFriend(userId);
  if (friendsState.selectedFriendId === userId) {
    friendsState.view = 'home';
    friendsState.selectedFriendId = null;
  }
  await refreshFriends().catch(() => {});
}

// --- Realtime -----------------------------------------------------------

function handleRealtimeEvent(event: RealtimeEvent): void {
  switch (event.type) {
    case 'ready': {
      const online = new Set(event.onlineFriendIds);
      for (const friend of friendsState.friends) {
        friend.online = online.has(friend.user.id);
      }
      break;
    }
    case 'presence': {
      const friend = findFriend(event.userId);
      if (friend) friend.online = event.online;
      break;
    }
    case 'friend-request':
    case 'friend-accepted':
    case 'friend-removed': {
      void refreshFriends().catch(() => {});
      void refreshRequests().catch(() => {});
      break;
    }
    case 'dm-message': {
      const { message } = event;
      const peerId = message.senderId === selfId ? message.recipientId : message.senderId;
      bumpLastMessage(peerId, message);
      const isOpenThread = friendsState.view === 'dm' && friendsState.selectedFriendId === peerId;
      if (isOpenThread) {
        appendToThread(message);
        // We're looking at it: keep it read.
        if (message.senderId !== selfId) void markThreadRead(peerId).catch(() => {});
      } else if (message.senderId !== selfId) {
        const friend = findFriend(peerId);
        if (friend) friend.unreadCount += 1;
      }
      break;
    }
    case 'dm-read': {
      // The peer read our messages: flip readAt on our sent bubbles.
      if (friendsState.view === 'dm' && friendsState.selectedFriendId === event.userId) {
        const now = Date.now();
        friendsState.thread = friendsState.thread.map((message) =>
          message.senderId === selfId && message.readAt == null ? { ...message, readAt: now } : message
        );
      }
      break;
    }
    default:
      break;
  }
}
