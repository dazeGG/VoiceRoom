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
import { deleteDirectMessage, editDirectMessage, fetchThread, markThreadRead, respondRoomInvite, sendDirectMessage, type DirectMessage } from '$lib/api/dm';
import { connectRealtime, type RealtimeEvent, type RealtimeHandle } from '$lib/api/realtime';
import type { PresenceStatus } from '$lib/shared/presence';
import { playDirectMessageCue, playFriendAcceptedCue, playFriendRequestCue, playRingCue } from '$lib/features/room/client/media/cues';
import {
  canUseNotifications,
  getNotificationDeliveryPermission,
  routeNotificationEvent,
  showBrowserNotification,
  type NotificationActiveTarget
} from '$lib/shared/notifications/router';
import { roomNavigation } from './room-navigation.svelte';
import {
  areNotificationPreferencesLoadedFor,
  applyRealtimeNotificationPreferences,
  isPeerNotificationsMuted,
  loadNotificationPreferences,
  notificationPreferences,
  prepareNotificationPreferences,
  resetNotificationPreferences,
  syncNotificationPermission
} from '$lib/shared/notifications/preferences.svelte';
import { createDmThreadResyncCoordinator } from './dm-thread-resync';

export type LobbyMode = 'friends' | 'rooms';
export type LobbyView = 'home' | 'dm' | 'people';

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
// Realtime `ready` can arrive before the first friends fetch finishes. Keep the
// snapshot so a later refreshFriends() still applies the correct online flags.
let presenceReady = false;
let onlineFriendIds = new Set<string>();
const threadResync = createDmThreadResyncCoordinator({
  fetchSnapshot: fetchThread,
  isCurrent: (peerId) => friendsState.view === 'dm' && friendsState.selectedFriendId === peerId,
  applySnapshot: (peerId, { peer, messages }) => {
    friendsState.threadPeer = peer;
    friendsState.thread = messages;
    const friend = findFriend(peerId);
    if (friend) {
      friend.unreadCount = 0;
      const last = messages.at(-1);
      if (last) bumpLastMessage(peerId, last);
    }
  },
  isOwnMessage: (message) => message.senderId === selfId
});
const MAX_PENDING_NOTIFICATION_EVENTS = 100;
const PENDING_NOTIFICATION_TTL_MS = 60_000;
let pendingNotificationEvents: Array<{ event: RealtimeEvent; receivedAt: number }> = [];
let notificationPreferencesRetryTimer: ReturnType<typeof setTimeout> | null = null;
// Invitations used to be mirrored per device in localStorage; they now live in
// the DM thread itself, so stale local copies are just cleaned up.
const RESOLVED_ROOM_INVITATIONS_KEY = 'voice-room:resolved-invitations';

function clearLegacyResolvedRoomInvitations(): void {
  try {
    localStorage.removeItem(`${RESOLVED_ROOM_INVITATIONS_KEY}:${selfId}`);
  } catch {}
}

function findFriend(userId: string): Friend | undefined {
  return friendsState.friends.find((entry) => entry.user.id === userId);
}

function friendOnlineFromPresence(userId: string, fallback = false): boolean {
  return presenceReady ? onlineFriendIds.has(userId) : fallback;
}

function applyOnlineToFriends(): void {
  if (!presenceReady) return;
  for (const friend of friendsState.friends) {
    friend.online = onlineFriendIds.has(friend.user.id);
  }
}

function setOnlineSnapshot(ids: Iterable<string>): void {
  onlineFriendIds = new Set(ids);
  presenceReady = true;
  applyOnlineToFriends();
}

function setFriendOnline(userId: string, online: boolean): void {
  if (online) onlineFriendIds.add(userId);
  else onlineFriendIds.delete(userId);
  const friend = findFriend(userId);
  if (friend) friend.online = online;
}

// A friend changed their public profile (avatar, name): refresh every cached
// copy — the friend list, pending requests, and the open DM header.
function applyFriendProfile(user: PublicUser | undefined): void {
  if (!user?.id) return;
  const friend = findFriend(user.id);
  if (friend) friend.user = { ...friend.user, ...user };
  friendsState.requests.incoming = friendsState.requests.incoming.map((request) =>
    request.user.id === user.id ? { ...request, user: { ...request.user, ...user } } : request
  );
  friendsState.requests.outgoing = friendsState.requests.outgoing.map((request) =>
    request.user.id === user.id ? { ...request, user: { ...request.user, ...user } } : request
  );
  if (friendsState.threadPeer?.id === user.id) {
    friendsState.threadPeer = { ...friendsState.threadPeer, ...user };
  }
}

// --- Loading ------------------------------------------------------------

export async function refreshFriends(): Promise<void> {
  const { friends, incomingRequestCount } = await fetchFriends();
  friendsState.friends = friends.map((friend) => ({
    ...friend,
    online: friendOnlineFromPresence(friend.user.id, friend.online)
  }));
  friendsState.incomingRequestCount = incomingRequestCount;
  friendsState.loaded = true;
}

export async function refreshRequests(): Promise<void> {
  friendsState.requests = await fetchRequests();
  friendsState.incomingRequestCount = friendsState.requests.incoming.length;
}

// Start the lobby: load the friend list and open the realtime stream. Returns a
// teardown function for onMount cleanup.
export function initLobby(
  currentUserId: string,
  initialDoNotDisturb = false,
  initialPresenceStatus?: PresenceStatus
): () => void {
  selfId = currentUserId;
  presenceReady = false;
  onlineFriendIds = new Set();
  clearLegacyResolvedRoomInvitations();
  if (!areNotificationPreferencesLoadedFor(currentUserId)) {
    prepareNotificationPreferences(currentUserId, initialDoNotDisturb, initialPresenceStatus);
  }
  realtime = connectRealtime(handleRealtimeEvent);
  void Promise.all([refreshFriends(), refreshRequests()]).catch(() => {
    friendsState.loaded = true;
  });
  scheduleNotificationPreferencesLoad(currentUserId);
  return () => {
    realtime?.close();
    realtime = null;
    presenceReady = false;
    onlineFriendIds = new Set();
    if (notificationPreferencesRetryTimer) {
      clearTimeout(notificationPreferencesRetryTimer);
      notificationPreferencesRetryTimer = null;
    }
    pendingNotificationEvents = [];
    threadResync.invalidate();
    resetNotificationPreferences();
  };
}

// --- Navigation ---------------------------------------------------------

export function setMode(mode: LobbyMode): void {
  friendsState.mode = mode;
}

export function showHome(): void {
  friendsState.view = 'home';
}

export function showPeople(): void {
  friendsState.view = 'people';
  void refreshRequests().catch(() => {});
}

export async function openDm(userId: string): Promise<void> {
  friendsState.mode = 'friends';
  friendsState.selectedFriendId = userId;
  friendsState.view = 'dm';
  friendsState.threadLoading = true;
  friendsState.thread = [];
  // Locally clear the unread badge; the GET also marks read server-side.
  const friend = findFriend(userId);
  if (friend) friend.unreadCount = 0;
  try {
    await threadResync.resync(userId);
  } finally {
    if (friendsState.selectedFriendId === userId) friendsState.threadLoading = false;
  }
}

async function resyncOpenThread(options: { force?: boolean } = {}): Promise<void> {
  const peerId = friendsState.selectedFriendId;
  if (friendsState.view !== 'dm' || !peerId) return;
  await threadResync.resync(peerId, options);
}

export function toggleProfile(): void {
  friendsState.profileOpen = !friendsState.profileOpen;
}

export function closeProfile(): void {
  friendsState.profileOpen = false;
}

// Accept or decline a room invitation carried by a DM. The server flips the
// invite status and fans the edited message out to both participants, so the
// local update here is just the immediate echo.
export async function respondRoomInvitation(message: DirectMessage, action: 'accept' | 'decline'): Promise<void> {
  if (!message.invite) return;
  const peerId = message.senderId === selfId ? message.recipientId : message.senderId;
  const updated = await respondRoomInvite(peerId, message.id, action);
  threadResync.recordUpsert(peerId, updated);
  applyEditedMessage(updated);
  if (action === 'accept') {
    const roomId = updated.invite?.roomId || message.invite.roomId;
    window.setTimeout(() => window.location.assign(`/r/${encodeURIComponent(roomId)}`), 120);
  }
}

// --- DM -----------------------------------------------------------------

export async function sendMessage(text: string): Promise<void> {
  const peerId = friendsState.selectedFriendId;
  const body = text.trim();
  if (!peerId || !body) return;
  const message = await sendDirectMessage(peerId, body);
  threadResync.recordUpsert(peerId, message);
  appendToThread(message);
  bumpLastMessage(peerId, message);
}

export async function deleteMessage(messageId: string): Promise<void> {
  const peerId = friendsState.selectedFriendId;
  if (!peerId || !messageId) return;
  await deleteDirectMessage(peerId, messageId);
  threadResync.recordDelete(peerId, messageId);
  // Remove locally; realtime delete will also arrive for other tabs. Refresh the
  // summary so last-message ordering and unread badges reflect soft-deletes.
  friendsState.thread = friendsState.thread.filter((m) => m.id !== messageId);
  await refreshFriends().catch(() => {});
}

export async function editMessage(messageId: string, text: string): Promise<void> {
  const peerId = friendsState.selectedFriendId;
  const body = text.trim();
  if (!peerId || !messageId || !body) return;
  const message = await editDirectMessage(peerId, messageId, body);
  threadResync.recordUpsert(peerId, message);
  applyEditedMessage(message);
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

function applyEditedMessage(message: DirectMessage): void {
  friendsState.thread = friendsState.thread.map((existing) =>
    existing.id === message.id ? message : existing
  );
  const peerId = message.senderId === selfId ? message.recipientId : message.senderId;
  const friend = findFriend(peerId);
  if (friend?.lastMessage?.id === message.id) {
    friend.lastMessage = { ...friend.lastMessage, body: message.body };
  }
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

function getActiveNotificationTarget(): NotificationActiveTarget | null {
  if (friendsState.view === 'dm' && friendsState.selectedFriendId) {
    return { kind: 'dm', peerId: friendsState.selectedFriendId };
  }
  if (friendsState.mode === 'rooms' && roomNavigation.viewedRoomId) {
    return { kind: 'room-preview', roomId: roomNavigation.viewedRoomId };
  }
  return null;
}

function handleNotificationRealtimeEvent(event: RealtimeEvent): boolean {
  if (!event.type.startsWith('notification.')) return false;
  if (!areNotificationPreferencesLoadedFor(selfId)) {
    const now = Date.now();
    pendingNotificationEvents = pendingNotificationEvents
      .filter((entry) => now - entry.receivedAt <= PENDING_NOTIFICATION_TTL_MS)
      .slice(-(MAX_PENDING_NOTIFICATION_EVENTS - 1));
    pendingNotificationEvents.push({ event, receivedAt: now });
    return true;
  }
  syncNotificationPermission();
  const routed = routeNotificationEvent(event, {
    userId: selfId,
    activeTarget: getActiveNotificationTarget(),
    mutedPeerIds: notificationPreferences.mutedPeerIds,
    mutedRoomIds: notificationPreferences.mutedRoomIds,
    privateNotifications: notificationPreferences.privateNotifications,
    doNotDisturb: notificationPreferences.doNotDisturb,
    notificationsAvailable: canUseNotifications(),
    permission: getNotificationDeliveryPermission()
  });
  if (routed.notify) showBrowserNotification(routed.payload);
  return true;
}

function flushPendingNotificationEvents(): void {
  if (!areNotificationPreferencesLoadedFor(selfId) || pendingNotificationEvents.length === 0) return;
  const now = Date.now();
  const events = pendingNotificationEvents
    .filter((entry) => now - entry.receivedAt <= PENDING_NOTIFICATION_TTL_MS)
    .map((entry) => entry.event);
  pendingNotificationEvents = [];
  for (const event of events) handleNotificationRealtimeEvent(event);
}

function scheduleNotificationPreferencesLoad(userId = selfId): void {
  if (areNotificationPreferencesLoadedFor(userId) || notificationPreferencesRetryTimer) return;
  void loadNotificationPreferences(userId)
    .then(flushPendingNotificationEvents)
    .catch(() => {
      notificationPreferencesRetryTimer = setTimeout(() => {
        notificationPreferencesRetryTimer = null;
        scheduleNotificationPreferencesLoad(userId);
      }, 5000);
    });
}

function handleRealtimeEvent(event: RealtimeEvent): void {
  if (event.type === 'notification.settings.updated') {
    applyRealtimeNotificationPreferences(selfId, event.payload.preferences);
    flushPendingNotificationEvents();
    return;
  }
  if (handleNotificationRealtimeEvent(event)) return;
  switch (event.type) {
    case 'ready': {
      setOnlineSnapshot(event.payload.onlineFriendIds ?? []);
      // A reconnect can miss edits while the socket is down. Re-fetch only the
      // currently visible thread so its bodies and editedAt markers converge.
      void resyncOpenThread({ force: true }).catch(() => {});
      break;
    }
    case 'friend.presence': {
      setFriendOnline(event.payload.userId, event.payload.online);
      break;
    }
    case 'friend.request': {
      if (areNotificationPreferencesLoadedFor(selfId)) playFriendRequestCue();
      void refreshFriends().catch(() => {});
      void refreshRequests().catch(() => {});
      break;
    }
    case 'friend.accepted': {
      if (areNotificationPreferencesLoadedFor(selfId)) playFriendAcceptedCue();
      void refreshFriends().catch(() => {});
      void refreshRequests().catch(() => {});
      break;
    }
    case 'friend.removed': {
      void refreshFriends().catch(() => {});
      void refreshRequests().catch(() => {});
      break;
    }
    case 'friend.updated': {
      applyFriendProfile(event.payload.user);
      break;
    }
    case 'ring.incoming': {
      // The invitation itself arrives as a DM (with an invite payload); the
      // ring event only drives the call cue so it still feels like a ring.
      if (event.payload.expiresAt - Date.now() <= 0) break;
      playRingCue();
      break;
    }
    case 'dm.message': {
      const { message } = event.payload;
      const peerId = message.senderId === selfId ? message.recipientId : message.senderId;
      threadResync.recordUpsert(peerId, message);
      bumpLastMessage(peerId, message);
      const isOpenThread = friendsState.view === 'dm' && friendsState.selectedFriendId === peerId;
      if (isOpenThread) {
        appendToThread(message);
        // We're looking at it: keep it read.
        if (message.senderId !== selfId) void markThreadRead(peerId).catch(() => {});
      } else if (message.senderId !== selfId) {
        // Invites already announced themselves with the ring cue.
        if (!message.invite && areNotificationPreferencesLoadedFor(selfId) && !isPeerNotificationsMuted(peerId)) playDirectMessageCue();
        const friend = findFriend(peerId);
        if (friend) friend.unreadCount += 1;
      }
      break;
    }
    case 'dm.read': {
      // The peer read our messages: flip readAt on our sent bubbles.
      if (friendsState.view === 'dm' && friendsState.selectedFriendId === event.payload.userId) {
        const now = Date.now();
        threadResync.recordRead(event.payload.userId, now);
        friendsState.thread = friendsState.thread.map((message) =>
          message.senderId === selfId && message.readAt == null ? { ...message, readAt: now } : message
        );
      }
      break;
    }
    case 'dm.message.deleted': {
      const mid = event.payload?.messageId;
      if (mid) {
        const peerId = event.payload.peerUserId ?? friendsState.selectedFriendId;
        if (peerId) threadResync.recordDelete(peerId, mid);
        friendsState.thread = friendsState.thread.filter((m) => m.id !== mid);
        void refreshFriends().catch(() => {});
      }
      break;
    }
    case 'dm.message.edited': {
      const { message } = event.payload;
      const peerId = message.senderId === selfId ? message.recipientId : message.senderId;
      threadResync.recordUpsert(peerId, message);
      applyEditedMessage(message);
      break;
    }
    default:
      break;
  }
}
