// The lobby's state for the friends/rooms experience: friend list, requests,
// the active main view, the open DM thread, and the realtime subscription that
// keeps them all live. One LobbyStore per signed-in lobby, provided to its
// components through context (provideLobby / useLobby).

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
  type Relationship,
  blockUser as apiBlockUser,
  unblockUser as apiUnblockUser
} from '$lib/api/friends';
import {
  deleteDirectMessage,
  directMessageFromView,
  editDirectMessage,
  fetchThread,
  fetchThreadPage,
  markThreadRead,
  respondRoomInvite,
  sendDirectMessage,
  type DirectMessage
} from '$lib/api/dm';
import { connectRealtime, type RealtimeEvent, type RealtimeHandle } from '$lib/api/realtime';
import { createTypingTracker, typingActivityOf } from '$lib/shared/chat/typing.svelte';
import type { PresenceStatus } from '$lib/shared/presence';
import {
  playDirectMessageCue,
  playFriendAcceptedCue,
  playFriendRequestCue,
  playRingCue
} from '$lib/features/room/client/media/cues';
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
  syncNotificationPermission,
  updateAutomaticPresenceStatus
} from '$lib/shared/notifications/preferences.svelte';
import { startSystemPresenceIdleTracking } from '$lib/shared/presence-idle';
import { createDmThreadResyncCoordinator } from './dm-thread-resync';
import { getCapabilityFeature } from '$lib/platform/capability-state.svelte';
import { createAnchoredHistory } from '$lib/features/room/room-history.svelte';
import type { RoomSocial } from '$lib/features/room/social';
import { SvelteSet } from 'svelte/reactivity';

export type LobbyMode = 'friends' | 'rooms';
export type LobbyView = 'home' | 'dm' | 'people';

// The lobby enters voice for this event through its usual confirmation flow.
export const ENTER_ROOM_EVENT = 'voice-room:enter-room';

const MAX_PENDING_NOTIFICATION_EVENTS = 100;
const PENDING_NOTIFICATION_TTL_MS = 60_000;
// Invitations used to be mirrored per device in localStorage; they now live in
// the DM thread itself, so stale local copies are just cleaned up.
const RESOLVED_ROOM_INVITATIONS_KEY = 'voice-room:resolved-invitations';

/** The DM thread the lobby has open. */
export class DmThread {
  peer = $state<PublicUser | null>(null);
  messages = $state<DirectMessage[]>([]);
  loading = $state(false);
  loadingOlder = $state(false);
  hasMoreBefore = $state(false);
  historyEnabled = $state(false);
  readCursorEnabled = $state(false);
  /** The cursor to mark read once the newest message rendered ('__legacy__' without read cursors). */
  readCandidate = $state<string | null>(null);
  readRevision = $state(0);
  historyError = $state('');
  profileOpen = $state(false);
}

export class LobbyStore {
  automaticPresenceIdleAvailable = $state(false);
  loaded = $state(false);
  friends = $state<Friend[]>([]);
  incomingRequestCount = $state(0);
  requests = $state<{ incoming: IncomingRequest[]; outgoing: OutgoingRequest[] }>({ incoming: [], outgoing: [] });
  mode = $state<LobbyMode>('friends');
  view = $state<LobbyView>('home');
  selectedFriendId = $state<string | null>(null);
  readonly thread = new DmThread();
  /** Friends currently typing to this account, keyed by their user id. */
  readonly dmTyping = createTypingTracker();

  private realtime: RealtimeHandle | null = null;
  private selfId = '';
  // Realtime `ready` can arrive before the first friends fetch finishes. Keep
  // the snapshot so a later refreshFriends() still applies the online flags.
  private presenceReady = false;
  private onlineFriendIds = new SvelteSet<string>();
  private presenceKnownFriendIds = new SvelteSet<string>();
  private pendingNotificationEvents: Array<{ event: RealtimeEvent; receivedAt: number }> = [];
  private notificationPreferencesRetryTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly dmHistory = createAnchoredHistory<DirectMessage>({
    loadPage: async (peerId, request) => fetchThreadPage(peerId, request),
    compare: (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
    onChange: (state) => {
      this.thread.messages = state.messages;
      this.thread.loading = state.loading;
      this.thread.loadingOlder = state.loadingOlder;
      this.thread.hasMoreBefore = state.hasMoreBefore;
      this.thread.historyError = state.error;
    }
  });

  private readonly threadResync = createDmThreadResyncCoordinator({
    fetchSnapshot: fetchThread,
    isCurrent: (peerId) => this.view === 'dm' && this.selectedFriendId === peerId,
    applySnapshot: (peerId, { peer, messages }) => {
      this.thread.peer = peer;
      this.thread.messages = messages;
      const friend = this.findFriend(peerId);
      if (friend) {
        friend.unreadCount = 0;
        const last = messages.at(-1);
        if (last) this.bumpLastMessage(peerId, last);
      }
    },
    isOwnMessage: (message) => message.senderId === this.selfId
  });

  private clearLegacyResolvedRoomInvitations = (): void => {
    try {
      localStorage.removeItem(`${RESOLVED_ROOM_INVITATIONS_KEY}:${this.selfId}`);
    } catch {
      // Storage is unavailable: there is nothing left over to clean.
    }
  };

  private findFriend = (userId: string): Friend | undefined => {
    return this.friends.find((entry) => entry.user.id === userId);
  };

  private friendOnlineFromPresence = (userId: string, fallback = false): boolean => {
    return this.presenceReady && this.presenceKnownFriendIds.has(userId) ? this.onlineFriendIds.has(userId) : fallback;
  };

  private applyOnlineToFriends = (): void => {
    if (!this.presenceReady) return;
    for (const friend of this.friends) {
      friend.online = this.onlineFriendIds.has(friend.user.id);
    }
  };

  private setOnlineSnapshot = (ids: Iterable<string>): void => {
    this.onlineFriendIds = new SvelteSet(ids);
    this.presenceKnownFriendIds = new SvelteSet(this.friends.map((friend) => friend.user.id));
    for (const userId of this.onlineFriendIds) this.presenceKnownFriendIds.add(userId);
    this.presenceReady = true;
    this.applyOnlineToFriends();
  };

  private setFriendOnline = (userId: string, online: boolean): void => {
    this.presenceKnownFriendIds.add(userId);
    if (online) this.onlineFriendIds.add(userId);
    else this.onlineFriendIds.delete(userId);
    const friend = this.findFriend(userId);
    if (friend) friend.online = online;
  };

  // A friend changed their public profile (avatar, name): refresh every cached
  // copy — the friend list, pending requests, and the open DM header.
  private applyFriendProfile = (user: PublicUser | undefined): void => {
    if (!user?.id) return;
    const friend = this.findFriend(user.id);
    if (friend) friend.user = { ...friend.user, ...user };
    this.requests.incoming = this.requests.incoming.map((request) =>
      request.user.id === user.id ? { ...request, user: { ...request.user, ...user } } : request
    );
    this.requests.outgoing = this.requests.outgoing.map((request) =>
      request.user.id === user.id ? { ...request, user: { ...request.user, ...user } } : request
    );
    if (this.thread.peer?.id === user.id) {
      this.thread.peer = { ...this.thread.peer, ...user };
    }
  };

  // --- Loading ------------------------------------------------------------

  refreshFriends = async (): Promise<void> => {
    const { friends, incomingRequestCount } = await fetchFriends();
    // A friend created after the last `ready` snapshot is not represented in the
    // presence cache yet. Seed that one relationship from the fresh HTTP result;
    // subsequent presence events remain authoritative.
    if (this.presenceReady) {
      for (const friend of friends) {
        if (this.presenceKnownFriendIds.has(friend.user.id)) continue;
        this.presenceKnownFriendIds.add(friend.user.id);
        if (friend.online) this.onlineFriendIds.add(friend.user.id);
        else this.onlineFriendIds.delete(friend.user.id);
      }
    }
    this.friends = friends.map((friend) => ({
      ...friend,
      online: this.friendOnlineFromPresence(friend.user.id, friend.online)
    }));
    this.incomingRequestCount = incomingRequestCount;
    this.loaded = true;
  };

  refreshRequests = async (): Promise<void> => {
    this.requests = await fetchRequests();
    this.incomingRequestCount = this.requests.incoming.length;
  };

  // Start the lobby: load the friend list and open the this.realtime stream. Returns a
  // teardown function for onMount cleanup.
  init = (currentUserId: string, initialDoNotDisturb = false, initialPresenceStatus?: PresenceStatus): (() => void) => {
    this.selfId = currentUserId;
    this.presenceReady = false;
    this.onlineFriendIds = new SvelteSet();
    this.presenceKnownFriendIds = new SvelteSet();
    this.clearLegacyResolvedRoomInvitations();
    if (!areNotificationPreferencesLoadedFor(currentUserId)) {
      prepareNotificationPreferences(currentUserId, initialDoNotDisturb, initialPresenceStatus);
    }
    this.realtime = connectRealtime(this.handleRealtimeEvent);
    void Promise.all([this.refreshFriends(), this.refreshRequests()]).catch(() => {
      this.loaded = true;
    });
    this.scheduleNotificationPreferencesLoad(currentUserId);
    this.automaticPresenceIdleAvailable = false;
    const stopPresenceIdleTracking = startSystemPresenceIdleTracking({
      getPresence: () => ({
        loaded: areNotificationPreferencesLoadedFor(currentUserId),
        presenceStatus: notificationPreferences.presenceStatus,
        presenceStatusAutomatic: notificationPreferences.presenceStatusAutomatic
      }),
      updatePresence: updateAutomaticPresenceStatus,
      onAvailabilityChange: (available) => {
        this.automaticPresenceIdleAvailable = available;
      }
    });
    return () => {
      stopPresenceIdleTracking();
      this.realtime?.close();
      this.realtime = null;
      this.presenceReady = false;
      this.onlineFriendIds = new SvelteSet();
      this.presenceKnownFriendIds = new SvelteSet();
      if (this.notificationPreferencesRetryTimer) {
        clearTimeout(this.notificationPreferencesRetryTimer);
        this.notificationPreferencesRetryTimer = null;
      }
      this.pendingNotificationEvents = [];
      this.threadResync.invalidate();
      this.dmHistory.close();
      resetNotificationPreferences();
    };
  };

  // --- Navigation ---------------------------------------------------------

  setMode = (mode: LobbyMode): void => {
    this.mode = mode;
  };

  showHome = (): void => {
    this.view = 'home';
  };

  showPeople = (): void => {
    this.view = 'people';
    void this.refreshRequests().catch(() => {});
  };

  openDm = async (userId: string): Promise<void> => {
    this.dmHistory.close();
    this.threadResync.invalidate();
    this.mode = 'friends';
    this.selectedFriendId = userId;
    this.view = 'dm';
    this.thread.loading = true;
    this.thread.messages = [];
    this.thread.readCandidate = null;
    this.thread.historyError = '';
    // Locally clear the unread badge; the GET also marks read server-side.
    const friend = this.findFriend(userId);
    if (friend) {
      friend.unreadCount = 0;
      this.thread.peer = friend.user;
    }
    try {
      const [historyEnabled, readCursorEnabled] = await Promise.all([
        getCapabilityFeature('historyCursor'),
        getCapabilityFeature('readCursor')
      ]).catch(() => [false, false] as const);
      if (this.selectedFriendId !== userId) return;
      this.thread.historyEnabled = historyEnabled;
      this.thread.readCursorEnabled = readCursorEnabled;
      if (historyEnabled) {
        await this.dmHistory.open(userId);
        if (this.selectedFriendId === userId) this.noteLatestThreadRendered();
      } else {
        this.dmHistory.close();
        await this.threadResync.resync(userId);
        if (this.selectedFriendId === userId) this.noteLatestThreadRendered();
      }
    } finally {
      if (this.selectedFriendId === userId) this.thread.loading = false;
    }
  };

  private resyncOpenThread = async (options: { force?: boolean } = {}): Promise<void> => {
    const peerId = this.selectedFriendId;
    if (this.view !== 'dm' || !peerId) return;
    if (this.thread.historyEnabled) {
      const page = await fetchThreadPage(peerId, { mode: 'latest' });
      if (this.selectedFriendId !== peerId) return;
      const firstCreatedAt = page.messages[0]?.createdAt;
      this.dmHistory.reconcileLatest(
        page.messages,
        (message) => firstCreatedAt == null || message.createdAt >= firstCreatedAt
      );
      this.noteLatestThreadRendered();
      return;
    }
    await this.threadResync.resync(peerId, options);
    this.noteLatestThreadRendered();
  };

  loadOlderThread = (scrollElement: HTMLElement | null): Promise<void> => {
    if (!this.thread.historyEnabled) return Promise.resolve();
    return this.dmHistory.loadOlder(scrollElement);
  };

  private noteLatestThreadRendered = (cursor?: string): void => {
    const candidate = cursor || [...this.thread.messages].reverse().find((message) => message.readCursor)?.readCursor;
    this.thread.readCandidate = this.thread.readCursorEnabled ? (candidate ?? null) : '__legacy__';
    this.thread.readRevision += 1;
  };

  private noteRealtimeThreadRendered = async (peerId: string, message: DirectMessage): Promise<void> => {
    if (message.readCursor || !this.thread.readCursorEnabled) {
      this.noteLatestThreadRendered(message.readCursor);
      return;
    }
    if (this.selectedFriendId !== peerId) return;
    await this.resyncOpenThread({ force: true }).catch(() => {});
  };

  toggleProfile = (): void => {
    this.thread.profileOpen = !this.thread.profileOpen;
  };

  closeProfile = (): void => {
    this.thread.profileOpen = false;
  };

  // The lobby enters voice for this event through its usual confirmation flow.

  // Accept or decline a room invitation carried by a DM. The server flips the
  // invite status and fans the edited message out to both participants, so the
  // local update here is just the immediate echo.
  respondRoomInvitation = async (message: DirectMessage, action: 'accept' | 'decline'): Promise<void> => {
    if (!message.invite) return;
    const peerId = message.senderId === this.selfId ? message.recipientId : message.senderId;
    const updated = await respondRoomInvite(peerId, message.id, action);
    this.threadResync.recordUpsert(peerId, updated);
    this.applyEditedMessage(updated);
    if (action === 'accept') {
      const roomId = updated.invite?.roomId || message.invite.roomId;
      window.setTimeout(() => window.dispatchEvent(new CustomEvent(ENTER_ROOM_EVENT, { detail: { roomId } })), 120);
    }
  };

  // --- DM -----------------------------------------------------------------

  sendMessage = async (
    text: string,
    attachmentIds: string[] = [],
    replyTo?: { messageId: string },
    idempotencyKey?: string
  ): Promise<void> => {
    const peerId = this.selectedFriendId;
    const body = text.trim();
    if (!peerId || (!body && attachmentIds.length === 0)) return;
    const message = await sendDirectMessage(peerId, body, attachmentIds, replyTo, idempotencyKey);
    this.threadResync.recordUpsert(peerId, message);
    this.appendToThread(message);
    this.bumpLastMessage(peerId, message);
  };

  deleteMessage = async (messageId: string): Promise<void> => {
    const peerId = this.selectedFriendId;
    if (!peerId || !messageId) return;
    await deleteDirectMessage(peerId, messageId);
    this.threadResync.recordDelete(peerId, messageId);
    // Remove locally; this.realtime delete will also arrive for other tabs. Refresh the
    // summary so last-message ordering and unread badges reflect soft-deletes.
    if (this.thread.historyEnabled) this.dmHistory.remove(messageId);
    else this.thread.messages = this.thread.messages.filter((m) => m.id !== messageId);
    await this.refreshFriends().catch(() => {});
  };

  editMessage = async (messageId: string, text: string): Promise<void> => {
    const peerId = this.selectedFriendId;
    const body = text.trim();
    if (!peerId || !messageId || !body) return;
    const message = await editDirectMessage(peerId, messageId, body);
    this.threadResync.recordUpsert(peerId, message);
    this.applyEditedMessage(message);
  };

  private appendToThread = (incoming: DirectMessage): void => {
    // A link preview can arrive as an edit before the message itself is
    // delivered; the later, preview-less copy must not wipe it.
    const known = this.thread.messages.find((existing) => existing.id === incoming.id);
    const message =
      known?.linkPreview && !incoming.linkPreview ? { ...incoming, linkPreview: known.linkPreview } : incoming;
    if (this.thread.historyEnabled) this.dmHistory.upsert(message);
    else {
      if (this.thread.messages.some((existing) => existing.id === message.id)) return;
      this.thread.messages = [...this.thread.messages, message];
    }
  };

  private bumpLastMessage = (peerId: string, message: DirectMessage): void => {
    const friend = this.findFriend(peerId);
    if (!friend) return;
    friend.lastMessage = {
      id: message.id,
      body: message.body,
      createdAt: message.createdAt,
      fromMe: message.senderId === this.selfId
    };
  };

  private applyEditedMessage = (message: DirectMessage): void => {
    if (this.thread.historyEnabled) this.dmHistory.upsert(message);
    else {
      this.thread.messages = this.thread.messages.map((existing) => (existing.id === message.id ? message : existing));
    }
    const peerId = message.senderId === this.selfId ? message.recipientId : message.senderId;
    const friend = this.findFriend(peerId);
    if (friend?.lastMessage?.id === message.id) {
      friend.lastMessage = { ...friend.lastMessage, body: message.body };
    }
  };

  // --- Friend request actions --------------------------------------------

  getFriendRelationship = (userId: string): Relationship => {
    if (this.findFriend(userId)) return 'friend';
    if (this.requests.incoming.some((request) => request.user.id === userId)) return 'incoming';
    if (this.requests.outgoing.some((request) => request.user.id === userId)) return 'outgoing';
    return 'none';
  };

  // Resolve a user's @login when we already know them (friend or pending request).
  // Returns '' for strangers, whose login is not exposed to the client.
  getKnownLogin = (userId: string): string => {
    const friend = this.findFriend(userId);
    if (friend) return friend.user.login;
    const incoming = this.requests.incoming.find((request) => request.user.id === userId);
    if (incoming) return incoming.user.login;
    const outgoing = this.requests.outgoing.find((request) => request.user.id === userId);
    if (outgoing) return outgoing.user.login;
    return '';
  };

  acceptRequestByUserId = async (userId: string): Promise<void> => {
    const request = this.requests.incoming.find((entry) => entry.user.id === userId);
    if (!request) return;
    await this.acceptRequest(request.id);
  };

  addFriendByLogin = async (login: string): Promise<{ status: SendRequestStatus; user: PublicUser }> => {
    const result = await sendFriendRequest(login);
    await Promise.all([this.refreshFriends().catch(() => {}), this.refreshRequests().catch(() => {})]);
    return result;
  };

  addFriendByUserId = async (userId: string): Promise<{ status: SendRequestStatus; user: PublicUser }> => {
    const result = await sendFriendRequestByUserId(userId);
    await Promise.all([this.refreshFriends().catch(() => {}), this.refreshRequests().catch(() => {})]);
    return result;
  };

  acceptRequest = async (requestId: string): Promise<void> => {
    await acceptFriendRequest(requestId);
    await Promise.all([this.refreshFriends().catch(() => {}), this.refreshRequests().catch(() => {})]);
  };

  declineRequest = async (requestId: string): Promise<void> => {
    await declineFriendRequest(requestId);
    await this.refreshRequests().catch(() => {});
  };

  cancelRequest = async (requestId: string): Promise<void> => {
    await cancelFriendRequest(requestId);
    await this.refreshRequests().catch(() => {});
  };

  removeFriend = async (userId: string): Promise<void> => {
    await apiRemoveFriend(userId);
    if (this.selectedFriendId === userId) {
      this.view = 'home';
      this.selectedFriendId = null;
    }
    await this.refreshFriends().catch(() => {});
  };

  // Blocking is server-side a superset of unfriending, so the local cleanup is the
  // same: leave the DM view if it was open on them, then resync.
  blockUser = async (userId: string): Promise<void> => {
    await apiBlockUser(userId);
    if (this.selectedFriendId === userId) {
      this.view = 'home';
      this.selectedFriendId = null;
    }
    await Promise.all([this.refreshFriends().catch(() => {}), this.refreshRequests().catch(() => {})]);
  };

  unblockUser = async (userId: string): Promise<void> => {
    await apiUnblockUser(userId);
  };

  // --- Realtime -----------------------------------------------------------

  private getActiveNotificationTarget = (): NotificationActiveTarget | null => {
    // An open chat only counts as "being read" while the window is in front: a
    // minimized, hidden-to-tray or background window still gets the notification.
    if (typeof document !== 'undefined' && (document.visibilityState !== 'visible' || !document.hasFocus())) {
      return null;
    }
    if (this.view === 'dm' && this.selectedFriendId) {
      return { kind: 'dm', peerId: this.selectedFriendId };
    }
    if (this.mode === 'rooms' && roomNavigation.viewedRoomId) {
      return { kind: 'room-preview', roomId: roomNavigation.viewedRoomId };
    }
    return null;
  };

  private handleNotificationRealtimeEvent = (event: RealtimeEvent): boolean => {
    if (!event.type.startsWith('notification.')) return false;
    if (!areNotificationPreferencesLoadedFor(this.selfId)) {
      const now = Date.now();
      this.pendingNotificationEvents = this.pendingNotificationEvents
        .filter((entry) => now - entry.receivedAt <= PENDING_NOTIFICATION_TTL_MS)
        .slice(-(MAX_PENDING_NOTIFICATION_EVENTS - 1));
      this.pendingNotificationEvents.push({ event, receivedAt: now });
      return true;
    }
    syncNotificationPermission();
    const routed = routeNotificationEvent(event, {
      userId: this.selfId,
      activeTarget: this.getActiveNotificationTarget(),
      mutedPeerIds: notificationPreferences.mutedPeerIds,
      mutedRoomIds: notificationPreferences.mutedRoomIds,
      privateNotifications: notificationPreferences.privateNotifications,
      doNotDisturb: notificationPreferences.doNotDisturb,
      notificationsAvailable: canUseNotifications() && notificationPreferences.notificationsEnabled,
      permission: getNotificationDeliveryPermission()
    });
    if (routed.notify) void showBrowserNotification(routed.payload);
    return true;
  };

  private flushPendingNotificationEvents = (): void => {
    if (!areNotificationPreferencesLoadedFor(this.selfId) || this.pendingNotificationEvents.length === 0) return;
    const now = Date.now();
    const events = this.pendingNotificationEvents
      .filter((entry) => now - entry.receivedAt <= PENDING_NOTIFICATION_TTL_MS)
      .map((entry) => entry.event);
    this.pendingNotificationEvents = [];
    for (const event of events) this.handleNotificationRealtimeEvent(event);
  };

  private scheduleNotificationPreferencesLoad = (userId = this.selfId): void => {
    if (areNotificationPreferencesLoadedFor(userId) || this.notificationPreferencesRetryTimer) return;
    void loadNotificationPreferences(userId)
      .then(this.flushPendingNotificationEvents)
      .catch(() => {
        this.notificationPreferencesRetryTimer = setTimeout(() => {
          this.notificationPreferencesRetryTimer = null;
          this.scheduleNotificationPreferencesLoad(userId);
        }, 5000);
      });
  };

  private handleRealtimeEvent = (event: RealtimeEvent): void => {
    if (event.type === 'notification.settings.updated') {
      applyRealtimeNotificationPreferences(this.selfId, event.payload.preferences);
      this.flushPendingNotificationEvents();
      return;
    }
    if (this.handleNotificationRealtimeEvent(event)) return;
    switch (event.type) {
      case 'ready': {
        this.setOnlineSnapshot(event.payload.onlineFriendIds ?? []);
        // A reconnect can miss edits while the socket is down. Re-fetch only the
        // currently visible thread so its bodies and editedAt markers converge.
        void this.resyncOpenThread({ force: true }).catch(() => {});
        break;
      }
      case 'friend.presence': {
        this.setFriendOnline(event.payload.userId, event.payload.online);
        break;
      }
      case 'friend.request': {
        if (areNotificationPreferencesLoadedFor(this.selfId)) playFriendRequestCue();
        void this.refreshFriends().catch(() => {});
        void this.refreshRequests().catch(() => {});
        break;
      }
      case 'friend.accepted': {
        if (areNotificationPreferencesLoadedFor(this.selfId)) playFriendAcceptedCue();
        void this.refreshFriends().catch(() => {});
        void this.refreshRequests().catch(() => {});
        break;
      }
      case 'friend.removed': {
        void this.refreshFriends().catch(() => {});
        void this.refreshRequests().catch(() => {});
        break;
      }
      case 'friend.updated': {
        this.applyFriendProfile(event.payload.user);
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
        const message = directMessageFromView(event.payload.message);
        const peerId = message.senderId === this.selfId ? message.recipientId : message.senderId;
        // The message itself ends that friend's "typing" state.
        if (message.senderId !== this.selfId) this.dmTyping.clear(message.senderId);
        this.threadResync.recordUpsert(peerId, message);
        this.bumpLastMessage(peerId, message);
        const isOpenThread = this.view === 'dm' && this.selectedFriendId === peerId;
        if (isOpenThread) {
          this.appendToThread(message);
          if (message.senderId !== this.selfId) {
            if (this.thread.readCursorEnabled) void this.noteRealtimeThreadRendered(peerId, message);
            else void markThreadRead(peerId);
          }
        } else if (message.senderId !== this.selfId) {
          // Invites already announced themselves with the ring cue.
          if (!message.invite && areNotificationPreferencesLoadedFor(this.selfId) && !isPeerNotificationsMuted(peerId))
            playDirectMessageCue();
          const friend = this.findFriend(peerId);
          if (friend) friend.unreadCount += 1;
        }
        break;
      }
      case 'dm.read': {
        // The peer read our messages: flip readAt on our sent bubbles.
        if (this.view === 'dm' && this.selectedFriendId === event.payload.userId) {
          const now = Date.now();
          this.threadResync.recordRead(event.payload.userId, now);
          this.thread.messages = this.thread.messages.map((message) =>
            message.senderId === this.selfId && message.readAt == null ? { ...message, readAt: now } : message
          );
        }
        break;
      }
      case 'dm.message.deleted': {
        const mid = event.payload?.messageId;
        if (mid) {
          const peerId = event.payload.peerUserId ?? this.selectedFriendId;
          if (peerId) this.threadResync.recordDelete(peerId, mid);
          if (this.thread.historyEnabled) this.dmHistory.remove(mid);
          else this.thread.messages = this.thread.messages.filter((m) => m.id !== mid);
          void this.refreshFriends().catch(() => {});
        }
        break;
      }
      case 'dm.typing': {
        if (event.payload?.userId && event.payload.userId !== this.selfId) {
          this.dmTyping.note(event.payload.userId, '', typingActivityOf(event.payload.activity));
        }
        break;
      }
      case 'dm.message.edited': {
        const message = directMessageFromView(event.payload.message);
        const peerId = message.senderId === this.selfId ? message.recipientId : message.senderId;
        this.threadResync.recordUpsert(peerId, message);
        this.applyEditedMessage(message);
        break;
      }
      default:
        break;
    }
  };

  /** The social graph as a room sees it (provided to rooms by the lobby). */
  readonly roomSocial: RoomSocial = {
    friends: () => this.friends,
    relationship: (userId) => this.getFriendRelationship(userId),
    knownLogin: (userId) => this.getKnownLogin(userId),
    addFriend: (userId) => this.addFriendByUserId(userId),
    acceptRequest: (userId) => this.acceptRequestByUserId(userId),
    removeFriend: (userId) => this.removeFriend(userId),
    openDm: (userId) => this.openDm(userId),
    showFriends: () => this.setMode('friends')
  };
}
