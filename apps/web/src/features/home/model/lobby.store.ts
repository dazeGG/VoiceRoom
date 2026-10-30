// The lobby's state for the friends/rooms experience: friend list, requests,
// the active main view, the open DM thread, and the realtime subscription that
// keeps them all live. The store is a Pinia singleton, so the teardown that init
// returns resets everything it holds: the next account starts empty. Components
// get it through provide/inject (provideLobby / useLobby).

import { defineStore } from 'pinia';
import { markRaw, reactive, ref } from 'vue';
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
} from '@/api/friends';
import {
  deleteDirectMessage,
  directMessageFromView,
  editDirectMessage,
  respondRoomInvite,
  sendDirectMessage,
  type DirectMessage
} from '@/api/dm';
import { getAppRealtime, type RealtimeEvent } from '@/api/realtime';
import { createTypingTracker, typingActivityOf } from '@/shared/chat/typing';
import type { PresenceStatus } from '@/shared/presence';
import { playDirectMessageCue, playFriendAcceptedCue, playFriendRequestCue, playRingCue } from '@/features/room/client';
import type { NotificationActiveTarget } from '@/shared/notifications/router';
import { useRoomNavigationStore } from './room-navigation.store';
import { useNotificationPreferencesStore } from '@/shared/notifications/preferences.store';
import { startSystemPresenceIdleTracking } from '@/shared/presence-idle';
import { useDmThread } from './use-dm-thread';
import { Outbox } from '@/shared/chat/outbox';
import { useFriendPresence } from './use-friend-presence';
import { BrowserNotificationRouting } from './browser-notification-routing';
import type { RoomSocial } from '@/features/room/social';

export type LobbyMode = 'friends' | 'rooms';
export type LobbyView = 'home' | 'dm' | 'people';

// Invitations used to be mirrored per device in localStorage; they now live in
// the DM thread itself, so stale local copies are just cleaned up.
const RESOLVED_ROOM_INVITATIONS_KEY = 'voice-room:resolved-invitations';

/** A direct message on its way, as the composer hands it over. */
export interface OutgoingDirectMessage {
  text: string;
  attachmentIds: string[];
  replyTo: { messageId: string } | undefined;
}

export const useLobbyStore = defineStore('lobby', () => {
  const automaticPresenceIdleAvailable = ref(false);
  const loaded = ref(false);
  const friends = ref<Friend[]>([]);
  const incomingRequestCount = ref(0);
  const requests = ref<{ incoming: IncomingRequest[]; outgoing: OutgoingRequest[] }>({ incoming: [], outgoing: [] });
  const mode = ref<LobbyMode>('friends');
  const view = ref<LobbyView>('home');
  const selectedFriendId = ref<string | null>(null);
  const thread = reactive(useDmThread((peerId) => view.value === 'dm' && selectedFriendId.value === peerId));
  /** Friends currently typing to this account, keyed by their user id. */
  const dmTyping = createTypingTracker();

  let stopRealtime: (() => void) | null = null;
  let selfId = '';
  // Enters voice in a room through the page's usual confirmation flow.
  let onEnterRoom: (roomId: string) => void = () => {};
  const presence = useFriendPresence();
  const browserNotifications = new BrowserNotificationRouting(() => getActiveNotificationTarget());

  /** `onEnterRoom` enters voice in a room through the page's usual confirmation flow. */
  function configure(options: { onEnterRoom?: (roomId: string) => void } = {}): void {
    onEnterRoom = options.onEnterRoom ?? (() => {});
  }

  function clearLegacyResolvedRoomInvitations(): void {
    try {
      localStorage.removeItem(`${RESOLVED_ROOM_INVITATIONS_KEY}:${selfId}`);
    } catch {
      // Storage is unavailable: there is nothing left over to clean.
    }
  }

  function findFriend(userId: string): Friend | undefined {
    return friends.value.find((entry) => entry.user.id === userId);
  }

  function applyOnlineToFriends(): void {
    if (!presence.ready.value) return;
    for (const friend of friends.value) {
      friend.online = presence.onlineOr(friend.user.id);
    }
  }

  function setFriendOnline(userId: string, online: boolean): void {
    presence.set(userId, online);
    const friend = findFriend(userId);
    if (friend) friend.online = online;
  }

  // A friend changed their public profile (avatar, name): refresh every cached
  // copy — the friend list, pending requests, and the open DM header.
  function applyFriendProfile(user: PublicUser | undefined): void {
    if (!user?.id) return;
    const friend = findFriend(user.id);
    if (friend) friend.user = { ...friend.user, ...user };
    requests.value.incoming = requests.value.incoming.map((request) =>
      request.user.id === user.id ? { ...request, user: { ...request.user, ...user } } : request
    );
    requests.value.outgoing = requests.value.outgoing.map((request) =>
      request.user.id === user.id ? { ...request, user: { ...request.user, ...user } } : request
    );
    if (thread.peer?.id === user.id) {
      thread.peer = { ...thread.peer, ...user };
    }
  }

  // --- Loading ------------------------------------------------------------

  async function refreshFriends(): Promise<void> {
    const { friends: fetched, incomingRequestCount: incomingCount } = await fetchFriends();
    // A friend created after the last `ready` snapshot is not represented in the
    // presence cache yet. Seed that one relationship from the fresh HTTP result;
    // subsequent presence events remain authoritative.
    presence.seed(fetched.map((friend) => ({ userId: friend.user.id, online: friend.online })));
    friends.value = fetched.map((friend) => ({
      ...friend,
      online: presence.onlineOr(friend.user.id, friend.online)
    }));
    incomingRequestCount.value = incomingCount;
    loaded.value = true;
  }

  async function refreshRequests(): Promise<void> {
    requests.value = await fetchRequests();
    incomingRequestCount.value = requests.value.incoming.length;
  }

  // Back to the state of a lobby nobody has opened: nothing of the last account stays.
  function reset(): void {
    loaded.value = false;
    friends.value = [];
    incomingRequestCount.value = 0;
    requests.value = { incoming: [], outgoing: [] };
    mode.value = 'friends';
    view.value = 'home';
    selectedFriendId.value = null;
    outboxes.clear();
    selfId = '';
  }

  // Start the lobby: load the friend list and subscribe to the realtime stream. Returns a
  // teardown function for onMounted cleanup.
  function init(
    currentUserId: string,
    initialDoNotDisturb = false,
    initialPresenceStatus?: PresenceStatus
  ): () => void {
    const preferences = useNotificationPreferencesStore();
    selfId = currentUserId;
    presence.reset();
    clearLegacyResolvedRoomInvitations();
    if (!preferences.areNotificationPreferencesLoadedFor(currentUserId)) {
      preferences.prepareNotificationPreferences(currentUserId, initialDoNotDisturb, initialPresenceStatus);
    }
    stopRealtime = getAppRealtime().subscribe(handleRealtimeEvent);
    void Promise.all([refreshFriends(), refreshRequests()]).catch(() => {
      loaded.value = true;
    });
    browserNotifications.start(currentUserId);
    automaticPresenceIdleAvailable.value = false;
    const stopPresenceIdleTracking = startSystemPresenceIdleTracking({
      getPresence: () => ({
        loaded: preferences.areNotificationPreferencesLoadedFor(currentUserId),
        presenceStatus: preferences.notificationPreferences.presenceStatus,
        presenceStatusAutomatic: preferences.notificationPreferences.presenceStatusAutomatic
      }),
      updatePresence: preferences.updateAutomaticPresenceStatus,
      onAvailabilityChange: (available) => {
        automaticPresenceIdleAvailable.value = available;
      }
    });
    return () => {
      stopPresenceIdleTracking();
      stopRealtime?.();
      stopRealtime = null;
      presence.reset();
      browserNotifications.stop();
      thread.close();
      reset();
      preferences.resetNotificationPreferences();
    };
  }

  // --- Navigation ---------------------------------------------------------

  function setMode(next: LobbyMode): void {
    mode.value = next;
  }

  function showHome(): void {
    view.value = 'home';
  }

  function showPeople(): void {
    view.value = 'people';
    void refreshRequests().catch(() => {});
  }

  async function openDm(userId: string): Promise<void> {
    mode.value = 'friends';
    selectedFriendId.value = userId;
    view.value = 'dm';
    // Locally clear the unread badge; the GET also marks read server-side.
    const friend = findFriend(userId);
    if (friend) friend.unreadCount = 0;
    await thread.open(userId, friend?.user ?? null);
  }

  async function resyncOpenThread(): Promise<void> {
    const peerId = selectedFriendId.value;
    if (view.value !== 'dm' || !peerId) return;
    await thread.resync(peerId);
  }

  const loadOlderThread = (scrollElement: HTMLElement | null): Promise<void> => thread.loadOlder(scrollElement);

  const toggleProfile = (): void => thread.toggleProfile();

  const closeProfile = (): void => thread.closeProfile();

  // Accept or decline a room invitation carried by a DM. The server flips the
  // invite status and fans the edited message out to both participants, so the
  // local update here is just the immediate echo.
  async function respondRoomInvitation(message: DirectMessage, action: 'accept' | 'decline'): Promise<void> {
    if (!message.invite) return;
    const peerId = message.senderId === selfId ? message.recipientId : message.senderId;
    const updated = await respondRoomInvite(peerId, message.id, action);
    applyEditedMessage(updated);
    if (action === 'accept') onEnterRoom(updated.invite?.roomId || message.invite.roomId);
  }

  // --- DM -----------------------------------------------------------------

  // Each thread's messages on their way. Kept here rather than in the thread's
  // view, so they keep going out, and a failed one waits, while another thread
  // is open. A plain Map: an Outbox is a class instance, which Vue must not proxy.
  const outboxes = new Map<string, Outbox<OutgoingDirectMessage, DirectMessage>>();

  function outboxFor(peerId: string): Outbox<OutgoingDirectMessage, DirectMessage> {
    let outbox = outboxes.get(peerId);
    if (!outbox) {
      outbox = markRaw(
        new Outbox<OutgoingDirectMessage, DirectMessage>({
          deliver: ({ text, attachmentIds, replyTo }, idempotencyKey) =>
            sendDirectMessage(peerId, text, attachmentIds, replyTo, idempotencyKey),
          onSent: (message) => {
            if (selectedFriendId.value === peerId) thread.append(message);
            bumpLastMessage(peerId, message);
          }
        })
      );
      outboxes.set(peerId, outbox);
    }
    return outbox;
  }

  async function deleteMessage(messageId: string): Promise<void> {
    const peerId = selectedFriendId.value;
    if (!peerId || !messageId) return;
    await deleteDirectMessage(peerId, messageId);
    // Remove locally; the realtime delete will also arrive for other tabs. Refresh
    // the summary so last-message ordering and unread badges reflect soft-deletes.
    thread.remove(messageId);
    await refreshFriends().catch(() => {});
  }

  async function editMessage(messageId: string, text: string): Promise<void> {
    const peerId = selectedFriendId.value;
    const body = text.trim();
    if (!peerId || !messageId || !body) return;
    const message = await editDirectMessage(peerId, messageId, body);
    applyEditedMessage(message);
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
    thread.replace(message);
    const peerId = message.senderId === selfId ? message.recipientId : message.senderId;
    const friend = findFriend(peerId);
    if (friend?.lastMessage?.id === message.id) {
      friend.lastMessage = { ...friend.lastMessage, body: message.body };
    }
  }

  // --- Friend request actions --------------------------------------------

  function getFriendRelationship(userId: string): Relationship {
    if (findFriend(userId)) return 'friend';
    if (requests.value.incoming.some((request) => request.user.id === userId)) return 'incoming';
    if (requests.value.outgoing.some((request) => request.user.id === userId)) return 'outgoing';
    return 'none';
  }

  // Resolve a user's @login when we already know them (friend or pending request).
  // Returns '' for strangers, whose login is not exposed to the client.
  function getKnownLogin(userId: string): string {
    const friend = findFriend(userId);
    if (friend) return friend.user.login;
    const incoming = requests.value.incoming.find((request) => request.user.id === userId);
    if (incoming) return incoming.user.login;
    const outgoing = requests.value.outgoing.find((request) => request.user.id === userId);
    if (outgoing) return outgoing.user.login;
    return '';
  }

  async function acceptRequestByUserId(userId: string): Promise<void> {
    const request = requests.value.incoming.find((entry) => entry.user.id === userId);
    if (!request) return;
    await acceptRequest(request.id);
  }

  async function addFriendByLogin(login: string): Promise<{ status: SendRequestStatus; user: PublicUser }> {
    const result = await sendFriendRequest(login);
    await Promise.all([refreshFriends().catch(() => {}), refreshRequests().catch(() => {})]);
    return result;
  }

  async function addFriendByUserId(userId: string): Promise<{ status: SendRequestStatus; user: PublicUser }> {
    const result = await sendFriendRequestByUserId(userId);
    await Promise.all([refreshFriends().catch(() => {}), refreshRequests().catch(() => {})]);
    return result;
  }

  async function acceptRequest(requestId: string): Promise<void> {
    await acceptFriendRequest(requestId);
    await Promise.all([refreshFriends().catch(() => {}), refreshRequests().catch(() => {})]);
  }

  async function declineRequest(requestId: string): Promise<void> {
    await declineFriendRequest(requestId);
    await refreshRequests().catch(() => {});
  }

  async function cancelRequest(requestId: string): Promise<void> {
    await cancelFriendRequest(requestId);
    await refreshRequests().catch(() => {});
  }

  async function removeFriend(userId: string): Promise<void> {
    await apiRemoveFriend(userId);
    if (selectedFriendId.value === userId) {
      view.value = 'home';
      selectedFriendId.value = null;
    }
    await refreshFriends().catch(() => {});
  }

  // Blocking is server-side a superset of unfriending, so the local cleanup is the
  // same: leave the DM view if it was open on them, then resync.
  async function blockUser(userId: string): Promise<void> {
    await apiBlockUser(userId);
    if (selectedFriendId.value === userId) {
      view.value = 'home';
      selectedFriendId.value = null;
    }
    await Promise.all([refreshFriends().catch(() => {}), refreshRequests().catch(() => {})]);
  }

  async function unblockUser(userId: string): Promise<void> {
    await apiUnblockUser(userId);
  }

  // --- Realtime -----------------------------------------------------------

  function getActiveNotificationTarget(): NotificationActiveTarget | null {
    // An open chat only counts as "being read" while the window is in front: a
    // minimized, hidden-to-tray or background window still gets the notification.
    if (typeof document !== 'undefined' && (document.visibilityState !== 'visible' || !document.hasFocus())) {
      return null;
    }
    if (view.value === 'dm' && selectedFriendId.value) {
      return { kind: 'dm', peerId: selectedFriendId.value };
    }
    const { viewedRoomId } = useRoomNavigationStore();
    if (mode.value === 'rooms' && viewedRoomId) {
      return { kind: 'room-preview', roomId: viewedRoomId };
    }
    return null;
  }

  function handleRealtimeEvent(event: RealtimeEvent): void {
    const preferences = useNotificationPreferencesStore();
    if (event.type === 'notification.settings.updated') {
      preferences.applyRealtimeNotificationPreferences(selfId, event.payload.preferences);
      browserNotifications.flush();
      return;
    }
    if (browserNotifications.handle(event)) return;
    switch (event.type) {
      case 'ready': {
        presence.snapshot(
          event.payload.onlineFriendIds ?? [],
          friends.value.map((friend) => friend.user.id)
        );
        applyOnlineToFriends();
        // A reconnect can miss messages and edits while the socket is down. The
        // friend list carries each chat's unread count and last message, and the
        // open thread is re-fetched so its bodies and editedAt markers converge.
        void refreshFriends().catch(() => {});
        void resyncOpenThread().catch(() => {});
        break;
      }
      case 'friend.presence': {
        setFriendOnline(event.payload.userId, event.payload.online);
        break;
      }
      case 'friend.request': {
        if (preferences.areNotificationPreferencesLoadedFor(selfId)) playFriendRequestCue();
        void refreshFriends().catch(() => {});
        void refreshRequests().catch(() => {});
        break;
      }
      case 'friend.accepted': {
        if (preferences.areNotificationPreferencesLoadedFor(selfId)) playFriendAcceptedCue();
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
        const message = directMessageFromView(event.payload.message);
        const peerId = message.senderId === selfId ? message.recipientId : message.senderId;
        // The message itself ends that friend's "typing" state.
        if (message.senderId !== selfId) dmTyping.clear(message.senderId);
        bumpLastMessage(peerId, message);
        const isOpenThread = view.value === 'dm' && selectedFriendId.value === peerId;
        if (isOpenThread) {
          thread.append(message);
          if (message.senderId !== selfId) {
            void thread.noteRealtimeRendered(peerId, message);
          }
        } else if (message.senderId !== selfId) {
          // Invites already announced themselves with the ring cue.
          if (
            !message.invite &&
            preferences.areNotificationPreferencesLoadedFor(selfId) &&
            !preferences.isPeerNotificationsMuted(peerId)
          )
            playDirectMessageCue();
          const friend = findFriend(peerId);
          if (friend) friend.unreadCount += 1;
        }
        break;
      }
      case 'dm.read': {
        // The peer read our messages: flip readAt on our sent bubbles.
        if (view.value === 'dm' && selectedFriendId.value === event.payload.userId) {
          const now = Date.now();
          thread.markSentRead((message) => message.senderId === selfId, now);
        }
        break;
      }
      case 'dm.message.deleted': {
        const mid = event.payload?.messageId;
        if (mid) {
          thread.remove(mid);
          void refreshFriends().catch(() => {});
        }
        break;
      }
      case 'dm.typing': {
        if (event.payload?.userId && event.payload.userId !== selfId) {
          dmTyping.note(event.payload.userId, '', typingActivityOf(event.payload.activity));
        }
        break;
      }
      case 'dm.message.edited': {
        applyEditedMessage(directMessageFromView(event.payload.message));
        break;
      }
      default:
        break;
    }
  }

  /** The social graph as a room sees it (provided to rooms by the lobby). */
  const roomSocial: RoomSocial = {
    friends: () => friends.value,
    relationship: (userId) => getFriendRelationship(userId),
    knownLogin: (userId) => getKnownLogin(userId),
    addFriend: (userId) => addFriendByUserId(userId),
    acceptRequest: (userId) => acceptRequestByUserId(userId),
    removeFriend: (userId) => removeFriend(userId),
    openDm: (userId) => openDm(userId),
    showFriends: () => setMode('friends')
  };

  return {
    automaticPresenceIdleAvailable,
    loaded,
    friends,
    incomingRequestCount,
    requests,
    mode,
    view,
    selectedFriendId,
    thread,
    dmTyping,
    roomSocial,
    configure,
    refreshFriends,
    refreshRequests,
    init,
    setMode,
    showHome,
    showPeople,
    openDm,
    loadOlderThread,
    toggleProfile,
    closeProfile,
    respondRoomInvitation,
    outboxFor,
    deleteMessage,
    editMessage,
    getFriendRelationship,
    getKnownLogin,
    acceptRequestByUserId,
    addFriendByLogin,
    addFriendByUserId,
    acceptRequest,
    declineRequest,
    cancelRequest,
    removeFriend,
    blockUser,
    unblockUser
  };
});

export type LobbyStore = ReturnType<typeof useLobbyStore>;
