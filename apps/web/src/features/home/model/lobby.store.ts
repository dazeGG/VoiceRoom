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
  deleteDirectConversation,
  deleteDirectMessage,
  directMessageFromView,
  editDirectMessage,
  markThreadRead,
  respondRoomInvite,
  sendDirectMessage,
  type DirectMessage
} from '@/api/dm';
import { getAppRealtime, type RealtimeEvent } from '@/api/realtime';
import { createTypingTracker, typingActivityOf } from '@/shared/chat/typing';
import type { PresenceStatus } from '@/shared/presence';
import { playDirectMessageCue, playFriendAcceptedCue, playFriendRequestCue, playRingCue } from '@voiceroom/call/engine';
import type { NotificationActiveTarget } from '@/shared/notifications/router';
import { useRoomNavigationStore } from './room-navigation.store';
import { useNotificationPreferencesStore } from '@/shared/notifications/preferences.store';
import { startSystemPresenceIdleTracking } from '@/shared/presence-idle';
import { useDmThread } from './use-dm-thread';
import { Outbox } from '@/shared/chat/outbox';
import { useFriendPresence } from './use-friend-presence';
import { useConversations } from './use-conversations';
import { BrowserNotificationRouting } from './browser-notification-routing';
import type { RoomSocial } from '@/features/room/social';
import { useFriendCallStore } from '@/features/friend-call/friend-call.store';

export type LobbyMode = 'friends' | 'rooms';
export type LobbyView = 'home' | 'dm' | 'people';
export type PeopleTab = 'online' | 'all' | 'requests';

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
  const peopleTab = ref<PeopleTab>('all');
  const selectedFriendId = ref<string | null>(null);
  const conversations = useConversations();
  const thread = reactive(
    useDmThread(
      (peerId) => view.value === 'dm' && selectedFriendId.value === peerId,
      () => void conversations.refresh()
    )
  );
  /** Friends currently typing to this account, keyed by their user id. */
  const dmTyping = createTypingTracker();

  let stopRealtime: (() => void) | null = null;
  let selfId = '';
  const manualUnread = ref<string[]>([]);
  function setManualUnread(userId: string, unread: boolean): void {
    manualUnread.value = unread
      ? [...new Set([...manualUnread.value, userId])]
      : manualUnread.value.filter((id) => id !== userId);
    try {
      localStorage.setItem(`voice-room:manual-unread:${selfId}`, JSON.stringify(manualUnread.value));
    } catch {
      /* Keep the marker for this session. */
    }
  }
  function isConversationUnread(userId: string): boolean {
    return (
      manualUnread.value.includes(userId) ||
      (conversations.entries.value.find((entry) => entry.peer.id === userId)?.unreadCount ?? 0) > 0
    );
  }
  // Enters voice in a room through the page's usual confirmation flow.
  let onEnterRoom: (roomId: string) => void = () => {};
  let onBrowse: (peerId?: string) => void = () => {};
  const presence = useFriendPresence();
  const browserNotifications = new BrowserNotificationRouting(() => getActiveNotificationTarget());

  /** `onEnterRoom` enters voice in a room through the page's usual confirmation flow. */
  function configure(
    options: { onEnterRoom?: (roomId: string) => void; onBrowse?: (peerId?: string) => void } = {}
  ): void {
    onEnterRoom = options.onEnterRoom ?? (() => {});
    onBrowse = options.onBrowse ?? (() => {});
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

  // Every applied conversation deletion takes the next epoch. A friends
  // snapshot requested before it must not bring back the deleted chat's
  // unread count and last message, and a cleanup that the realtime event
  // already did must not run again over a conversation reopened meanwhile.
  let deletionEpoch = 0;
  const conversationDeletedAt = new Map<string, number>();

  function deletedSince(userId: string, epoch: number): boolean {
    return (conversationDeletedAt.get(userId) ?? 0) > epoch;
  }

  function isFriendOnline(userId: string): boolean {
    return presence.onlineOr(userId, findFriend(userId)?.online);
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
    const conversation = conversations.entries.value.find(({ peer }) => peer.id === user.id);
    if (conversation) conversation.peer = { ...conversation.peer, ...user };
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
    const epoch = deletionEpoch;
    const { friends: fetched, incomingRequestCount: incomingCount } = await fetchFriends();
    // A friend created after the last `ready` snapshot is not represented in the
    // presence cache yet. Seed that one relationship from the fresh HTTP result;
    // subsequent presence events remain authoritative.
    presence.seed(fetched.map((friend) => ({ userId: friend.user.id, online: friend.online })));
    friends.value = fetched.map((friend) => {
      const merged = { ...friend, online: presence.onlineOr(friend.user.id, friend.online) };
      if (!deletedSince(friend.user.id, epoch)) return merged;
      // The server built this snapshot before a deletion applied here; what the
      // deletion and the live events since left locally is newer.
      const current = findFriend(friend.user.id);
      return { ...merged, unreadCount: current?.unreadCount ?? 0, lastMessage: current?.lastMessage ?? null };
    });
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
    peopleTab.value = 'all';
    selectedFriendId.value = null;
    outboxes.clear();
    conversationDeletedAt.clear();
    selfId = '';
    manualUnread.value = [];
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
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(`voice-room:manual-unread:${selfId}`) || '[]');
      const entries: unknown[] = Array.isArray(stored) ? stored : [];
      manualUnread.value = entries.filter((id): id is string => typeof id === 'string');
    } catch {
      manualUnread.value = [];
    }
    presence.reset();
    clearLegacyResolvedRoomInvitations();
    if (!preferences.areNotificationPreferencesLoadedFor(currentUserId)) {
      preferences.prepareNotificationPreferences(currentUserId, initialDoNotDisturb, initialPresenceStatus);
    }
    stopRealtime = getAppRealtime().subscribe(handleRealtimeEvent);
    conversations.start();
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
      conversations.stop();
      reset();
      preferences.resetNotificationPreferences();
    };
  }

  // --- Navigation ---------------------------------------------------------

  function setMode(next: LobbyMode): void {
    onBrowse();
    mode.value = next;
  }

  function showHome(): void {
    onBrowse();
    view.value = 'home';
  }

  function showPeople(tab: PeopleTab = 'all'): void {
    onBrowse();
    mode.value = 'friends';
    peopleTab.value = tab;
    view.value = 'people';
    void refreshRequests().catch(() => {});
  }

  async function openDm(userId: string): Promise<void> {
    setManualUnread(userId, false);
    onBrowse(userId);
    mode.value = 'friends';
    selectedFriendId.value = userId;
    view.value = 'dm';
    // Locally clear the unread badge; the GET also marks read server-side.
    const friend = findFriend(userId);
    if (friend) friend.unreadCount = 0;
    const peer = conversations.entries.value.find((entry) => entry.peer.id === userId)?.peer;
    await thread.open(userId, friend?.user ?? peer ?? null);
  }

  async function markConversationRead(userId: string): Promise<void> {
    await markThreadRead(userId);
    setManualUnread(userId, false);
    void conversations.refresh();
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
      const created = markRaw(
        new Outbox<OutgoingDirectMessage, DirectMessage>({
          deliver: async ({ text, attachmentIds, replyTo }, idempotencyKey) => {
            try {
              return await sendDirectMessage(peerId, text, attachmentIds, replyTo, idempotencyKey);
            } catch (error) {
              if (selectedFriendId.value === peerId) void thread.resync(peerId).catch(() => {});
              throw error;
            }
          },
          onSent: (message) => {
            if (outboxes.get(peerId) !== created) return;
            if (selectedFriendId.value === peerId) {
              thread.append(message);
              void thread.noteRealtimeRendered(peerId, message);
            }
            bumpLastMessage(peerId, message);
            void conversations.refresh();
          }
        })
      );
      outbox = created;
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
    void conversations.refresh();
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
      fromMe: message.senderId === selfId,
      ...(message.invite ? { invite: message.invite } : {})
    };
  }

  function applyEditedMessage(message: DirectMessage): void {
    if (!message.call) void conversations.refresh();
    const peerId = message.senderId === selfId ? message.recipientId : message.senderId;
    const isOpenThread = view.value === 'dm' && selectedFriendId.value === peerId;
    if (isOpenThread) thread.replace(message);
    // A re-ring edits the existing card, whose sender is still the original caller.
    if (isOpenThread && message.call?.outcome === 'live' && thread.contact?.messageReason === 'unanswered_cap') {
      void thread.resync(peerId).catch(() => {});
    }
    if (message.call) return;
    const friend = findFriend(peerId);
    if (friend?.lastMessage?.id === message.id) {
      const invite = message.invite === undefined ? friend.lastMessage.invite : message.invite;
      const latest = { ...friend.lastMessage, body: message.body };
      if (invite) latest.invite = invite;
      else delete latest.invite;
      friend.lastMessage = latest;
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
    if (result.status === 'accepted') void conversations.refresh();
    await Promise.all([refreshFriends().catch(() => {}), refreshRequests().catch(() => {})]);
    return result;
  }

  async function addFriendByUserId(userId: string): Promise<{ status: SendRequestStatus; user: PublicUser }> {
    const result = await sendFriendRequestByUserId(userId);
    if (result.status === 'accepted') void conversations.refresh();
    await Promise.all([refreshFriends().catch(() => {}), refreshRequests().catch(() => {})]);
    return result;
  }

  async function acceptRequest(requestId: string): Promise<void> {
    await acceptFriendRequest(requestId);
    void conversations.refresh();
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
    void conversations.refresh();
    if (selectedFriendId.value === userId) void thread.resync(userId).catch(() => {});
    await refreshFriends().catch(() => {});
  }

  // Blocking is server-side a superset of unfriending, so the local cleanup is the
  // same: leave the DM view if it was open on them, then resync.
  async function blockUser(userId: string, deleteConversation = false): Promise<void> {
    const epoch = deletionEpoch;
    await apiBlockUser(userId, deleteConversation);
    if (!deleteConversation) dropConversation(userId);
    else if (!deletedSince(userId, epoch)) applyConversationDeleted(userId);
    await Promise.all([refreshFriends().catch(() => {}), refreshRequests().catch(() => {})]);
  }

  function applyConversationDeleted(userId: string): void {
    conversationDeletedAt.set(userId, ++deletionEpoch);
    browserNotifications.forgetPeer(userId);
    const friend = findFriend(userId);
    if (friend) {
      friend.unreadCount = 0;
      friend.lastMessage = null;
    }
    const outbox = outboxes.get(userId);
    if (outbox) outbox.items = [];
    outboxes.delete(userId);
    dmTyping.clear(userId);
    useFriendCallStore().clearPeerMisses(userId);
    dropConversation(userId);
    thread.forget(userId);
  }

  async function deleteConversation(userId: string): Promise<void> {
    const epoch = deletionEpoch;
    await deleteDirectConversation(userId);
    if (!deletedSince(userId, epoch)) applyConversationDeleted(userId);
  }

  function dropConversation(userId: string): void {
    setManualUnread(userId, false);
    conversations.remove(userId);
    if (selectedFriendId.value === userId) {
      if (view.value === 'dm') view.value = 'home';
      selectedFriendId.value = null;
      thread.close();
    }
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
        void conversations.refresh();
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
        void conversations.refresh();
        if (selectedFriendId.value === event.payload.userId) void thread.resync(event.payload.userId).catch(() => {});
        break;
      }
      case 'friend.removed': {
        void conversations.refresh();
        if (selectedFriendId.value === event.payload.userId) void thread.resync(event.payload.userId).catch(() => {});
        void refreshFriends().catch(() => {});
        void refreshRequests().catch(() => {});
        break;
      }
      case 'friend.updated': {
        applyFriendProfile(event.payload.user);
        void conversations.refresh();
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
        void conversations.refresh();
        if (message.call) {
          if (view.value === 'dm' && selectedFriendId.value === peerId) {
            thread.append(message);
            if (message.senderId !== selfId && message.readAt == null)
              void thread.noteRealtimeRendered(peerId, message);
          }
          break;
        }
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
          void conversations.refresh();
          void refreshFriends().catch(() => {});
        }
        break;
      }
      case 'dm.conversation.deleted':
        applyConversationDeleted(event.payload.peerId);
        break;
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
    peopleTab,
    selectedFriendId,
    thread,
    conversations: conversations.entries,
    manualUnread,
    isConversationUnread,
    setManualUnread,
    conversationsLoaded: conversations.loaded,
    conversationsFailed: conversations.failed,
    markConversationRead,
    isFriendOnline,
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
    deleteConversation,
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
