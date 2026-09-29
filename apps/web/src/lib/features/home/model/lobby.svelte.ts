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
import type { NotificationActiveTarget } from '$lib/shared/notifications/router';
import { roomNavigation } from './room-navigation.svelte';
import {
  areNotificationPreferencesLoadedFor,
  applyRealtimeNotificationPreferences,
  isPeerNotificationsMuted,
  notificationPreferences,
  prepareNotificationPreferences,
  resetNotificationPreferences,
  updateAutomaticPresenceStatus
} from '$lib/shared/notifications/preferences.svelte';
import { startSystemPresenceIdleTracking } from '$lib/shared/presence-idle';
import { DmThread } from './dm-thread.svelte';
import { FriendPresence } from './friend-presence.svelte';
import { BrowserNotificationRouting } from './browser-notification-routing';
import type { RoomSocial } from '$lib/features/room/social';

export type LobbyMode = 'friends' | 'rooms';
export type LobbyView = 'home' | 'dm' | 'people';

// The lobby enters voice for this event through its usual confirmation flow.
export const ENTER_ROOM_EVENT = 'voice-room:enter-room';

// Invitations used to be mirrored per device in localStorage; they now live in
// the DM thread itself, so stale local copies are just cleaned up.
const RESOLVED_ROOM_INVITATIONS_KEY = 'voice-room:resolved-invitations';

export class LobbyStore {
  automaticPresenceIdleAvailable = $state(false);
  loaded = $state(false);
  friends = $state<Friend[]>([]);
  incomingRequestCount = $state(0);
  requests = $state<{ incoming: IncomingRequest[]; outgoing: OutgoingRequest[] }>({ incoming: [], outgoing: [] });
  mode = $state<LobbyMode>('friends');
  view = $state<LobbyView>('home');
  selectedFriendId = $state<string | null>(null);
  readonly thread = new DmThread({
    isOpen: (peerId) => this.view === 'dm' && this.selectedFriendId === peerId,
    onSnapshot: (peerId, messages) => {
      const friend = this.findFriend(peerId);
      if (!friend) return;
      friend.unreadCount = 0;
      const last = messages.at(-1);
      if (last) this.bumpLastMessage(peerId, last);
    },
    isOwnMessage: (message) => message.senderId === this.selfId
  });
  /** Friends currently typing to this account, keyed by their user id. */
  readonly dmTyping = createTypingTracker();

  private realtime: RealtimeHandle | null = null;
  private selfId = '';
  private readonly presence = new FriendPresence();
  private readonly browserNotifications = new BrowserNotificationRouting(() => this.getActiveNotificationTarget());

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

  private applyOnlineToFriends = (): void => {
    if (!this.presence.ready) return;
    for (const friend of this.friends) {
      friend.online = this.presence.onlineOr(friend.user.id);
    }
  };

  private setFriendOnline = (userId: string, online: boolean): void => {
    this.presence.set(userId, online);
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
    this.presence.seed(friends.map((friend) => ({ userId: friend.user.id, online: friend.online })));
    this.friends = friends.map((friend) => ({
      ...friend,
      online: this.presence.onlineOr(friend.user.id, friend.online)
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
    this.presence.reset();
    this.clearLegacyResolvedRoomInvitations();
    if (!areNotificationPreferencesLoadedFor(currentUserId)) {
      prepareNotificationPreferences(currentUserId, initialDoNotDisturb, initialPresenceStatus);
    }
    this.realtime = connectRealtime(this.handleRealtimeEvent);
    void Promise.all([this.refreshFriends(), this.refreshRequests()]).catch(() => {
      this.loaded = true;
    });
    this.browserNotifications.start(currentUserId);
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
      this.presence.reset();
      this.browserNotifications.stop();
      this.thread.close();
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
    this.mode = 'friends';
    this.selectedFriendId = userId;
    this.view = 'dm';
    // Locally clear the unread badge; the GET also marks read server-side.
    const friend = this.findFriend(userId);
    if (friend) friend.unreadCount = 0;
    await this.thread.open(userId, friend?.user ?? null);
  };

  private resyncOpenThread = async (options: { force?: boolean } = {}): Promise<void> => {
    const peerId = this.selectedFriendId;
    if (this.view !== 'dm' || !peerId) return;
    await this.thread.resync(peerId, options);
  };

  loadOlderThread = (scrollElement: HTMLElement | null): Promise<void> => this.thread.loadOlder(scrollElement);

  toggleProfile = (): void => this.thread.toggleProfile();

  closeProfile = (): void => this.thread.closeProfile();

  // The lobby enters voice for this event through its usual confirmation flow.

  // Accept or decline a room invitation carried by a DM. The server flips the
  // invite status and fans the edited message out to both participants, so the
  // local update here is just the immediate echo.
  respondRoomInvitation = async (message: DirectMessage, action: 'accept' | 'decline'): Promise<void> => {
    if (!message.invite) return;
    const peerId = message.senderId === this.selfId ? message.recipientId : message.senderId;
    const updated = await respondRoomInvite(peerId, message.id, action);
    this.thread.recordUpsert(peerId, updated);
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
    this.thread.recordUpsert(peerId, message);
    this.thread.append(message);
    this.bumpLastMessage(peerId, message);
  };

  deleteMessage = async (messageId: string): Promise<void> => {
    const peerId = this.selectedFriendId;
    if (!peerId || !messageId) return;
    await deleteDirectMessage(peerId, messageId);
    this.thread.recordDelete(peerId, messageId);
    // Remove locally; the realtime delete will also arrive for other tabs. Refresh
    // the summary so last-message ordering and unread badges reflect soft-deletes.
    this.thread.remove(messageId);
    await this.refreshFriends().catch(() => {});
  };

  editMessage = async (messageId: string, text: string): Promise<void> => {
    const peerId = this.selectedFriendId;
    const body = text.trim();
    if (!peerId || !messageId || !body) return;
    const message = await editDirectMessage(peerId, messageId, body);
    this.thread.recordUpsert(peerId, message);
    this.applyEditedMessage(message);
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
    this.thread.replace(message);
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

  private handleRealtimeEvent = (event: RealtimeEvent): void => {
    if (event.type === 'notification.settings.updated') {
      applyRealtimeNotificationPreferences(this.selfId, event.payload.preferences);
      this.browserNotifications.flush();
      return;
    }
    if (this.browserNotifications.handle(event)) return;
    switch (event.type) {
      case 'ready': {
        this.presence.snapshot(
          event.payload.onlineFriendIds ?? [],
          this.friends.map((friend) => friend.user.id)
        );
        this.applyOnlineToFriends();
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
        this.thread.recordUpsert(peerId, message);
        this.bumpLastMessage(peerId, message);
        const isOpenThread = this.view === 'dm' && this.selectedFriendId === peerId;
        if (isOpenThread) {
          this.thread.append(message);
          if (message.senderId !== this.selfId) {
            if (this.thread.readCursorEnabled) void this.thread.noteRealtimeRendered(peerId, message);
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
          this.thread.recordRead(event.payload.userId, now);
          this.thread.markSentRead((message) => message.senderId === this.selfId, now);
        }
        break;
      }
      case 'dm.message.deleted': {
        const mid = event.payload?.messageId;
        if (mid) {
          const peerId = event.payload.peerUserId ?? this.selectedFriendId;
          if (peerId) this.thread.recordDelete(peerId, mid);
          this.thread.remove(mid);
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
        this.thread.recordUpsert(peerId, message);
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
