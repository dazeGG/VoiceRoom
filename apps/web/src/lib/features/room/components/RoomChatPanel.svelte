<script lang="ts">
  import type { Snippet } from 'svelte';
  import { getDesktopBoundaryPolicy } from '$lib/platform/desktop-boundary';
  import { onMount, tick, untrack } from 'svelte';
  import {
    deleteRoomChatMessage,
    editRoomChatMessage,
    fetchRoomChatPage,
    markRoomChatRead,
    postRoomChat,
    chatMessageFromRoomMessage,
    type ChatMessage
  } from '$lib/api/rooms';
  import { beginRoomChatReadSession, setRoomUnreadCount } from '$lib/entities/room/room-presence.svelte';
  import { session } from '$lib/features/auth/session.svelte';
  import { subscribeRoomPreview } from '$lib/entities/room/room-realtime';
  import { copyText } from '$lib/shared/utils/clipboard';
  import { playRoomChatMessageCue } from '../client/media/cues';
  import { applyRoomDeleted, applyRoomNotFound, applyRoomUpdated } from '../client/room/lifecycle';
  import { openProfileCardFor } from '$lib/entities/profile-card/profile-card-ui.svelte';
  import { getParticipantById } from '../client/room/participants';
  import { state as roomState } from '../client/core/state.svelte';
  import { mentionProfilePerson, participantProfilePerson, roomMessageProfilePerson } from '../profile-card-adapter';
  import { useRoomSocial } from '../social';
  import { isRoomNotificationsMuted } from '$lib/shared/notifications/preferences.svelte';
  import { RoomChatTimeline } from '../room-chat-timeline.svelte';
  import { createReadReconciliation } from '$lib/shared/chat/read-reconciliation.svelte';
  import { createReactionStore } from '$lib/shared/chat/reaction-store.svelte';
  import MessageContextMenu from '$lib/shared/chat/MessageContextMenu.svelte';
  import { DEFAULT_FREQUENT_REACTIONS, loadFrequentReactions } from '$lib/shared/chat/frequent-reactions';
  import PinnedMessagesBar from './PinnedMessagesBar.svelte';
  import RoomChatComposer from './RoomChatComposer.svelte';
  import RoomPanelHeader from './RoomPanelHeader.svelte';
  import RoomChatMessageGroup from './RoomChatMessageGroup.svelte';
  import { buildChatDays, type ChatGroup } from '../room-chat-view';
  import { RoomChatDraft, type OutgoingRoomMessage } from '../room-chat-draft.svelte';
  import { applyRoomPinsEvent, isMessagePinned, loadRoomPins, resetRoomPins, togglePin } from '../pins.svelte';
  import { getAttachmentComposeStore, type AttachmentComposeStore } from '$lib/shared/chat/attachment-compose.svelte';
  import { AttachmentDrop } from '$lib/shared/chat/attachment-drop.svelte';
  import { SendAttempt } from '$lib/shared/chat/send-attempt';
  import AttachmentDropOverlay from '$lib/shared/chat/AttachmentDropOverlay.svelte';
  import { createTypingTracker, formatTypingLabel, typingActivityOf } from '$lib/shared/chat/typing.svelte';
  import { getRoomMembership } from '$lib/entities/room/room-membership.svelte';
  import { createLogger, errorContext } from '$lib/shared/log';

  const social = useRoomSocial();

  const log = createLogger('room:chat');

  // The one room chat. The in-room rail and the lobby preview differ only in how
  // the viewer is identified and in who owns the surrounding panel chrome, so
  // both render this component instead of keeping parallel implementations.
  let {
    roomId,
    peerId = '',
    sessionToken = '',
    resolveDisplayName,
    rootClass = 'room-chat-rail',
    ariaLabel = 'Панель комнаты',
    hidden = false,
    activeTab = 'chat',
    visible = true,
    unread = 0,
    chatTabId = undefined,
    participantsTabId = undefined,
    chatPanelId = undefined,
    participantsPanelId = undefined,
    onSelectChat,
    onSelectParticipants,
    onCollapse,
    onRead,
    onUnreadMessage,
    onToast,
    onAuthorContextMenu,
    canModerate = false,
    aroundMessageId = undefined,
    participants
  }: {
    roomId: string;
    peerId?: string;
    sessionToken?: string;
    resolveDisplayName: () => string;
    rootClass?: string;
    ariaLabel?: string;
    hidden?: boolean;
    activeTab?: 'chat' | 'participants';
    visible?: boolean;
    unread?: number;
    chatTabId?: string;
    participantsTabId?: string;
    chatPanelId?: string;
    participantsPanelId?: string;
    onSelectChat?: () => void;
    onSelectParticipants?: () => void;
    onCollapse?: () => void;
    onRead?: () => void;
    onUnreadMessage?: () => void;
    onToast?: (message: string, options?: { variant?: 'error' }) => void;
    onAuthorContextMenu?: (peerId: string, event: MouseEvent) => void;
    /** The room owner may delete anyone's message, not only their own. */
    canModerate?: boolean;
    /**
     * Open the history around this message and scroll to it. Passed explicitly
     * by hosts that route there themselves; the `around` query parameter is
     * still honoured for links that land on the room page directly.
     */
    aroundMessageId?: string;
    participants?: Snippet;
  } = $props();

  const timeline = new RoomChatTimeline();
  let sending = $state(false);
  let editingMessageId = $state('');
  let chatBody = $state<HTMLDivElement | null>(null);
  let composer = $state<{ focus(): void } | null>(null);
  let chatPinnedToBottom = true;
  let composerAttachmentCount = 0;
  // On a phone the panel is the whole screen rather than a rail beside the
  // stage, so it closes with a cross instead of collapsing to the right.
  let mobile = $state(false);
  let readReconciliation: ReturnType<typeof createReadReconciliation> | null = null;
  const reactions = createReactionStore();
  const media = $derived<AttachmentComposeStore | null>(roomId ? getAttachmentComposeStore('room', roomId) : null);
  let replyTarget = $state<ChatMessage | null>(null);
  let menuMessage = $state<ChatMessage | null>(null);
  let menuX = $state(0);
  let menuY = $state(0);
  let quickReactions = $state<string[]>([...DEFAULT_FREQUENT_REACTIONS]);
  const sendAttempt = new SendAttempt();
  const chatVisible = $derived(visible && activeTab === 'chat');

  function toast(message: string, options?: { variant?: 'error' }): void {
    onToast?.(message, options);
  }
  const draft = new RoomChatDraft(untrack(() => roomId));
  $effect(() => draft.restore(session.user?.id ?? ''));

  $effect(() => {
    const attachmentCount = media?.drafts.length ?? 0;
    if (attachmentCount === composerAttachmentCount) return;
    composerAttachmentCount = attachmentCount;
    if (chatPinnedToBottom) void tick().then(scrollToBottom);
  });

  const drop = new AttachmentDrop({
    media: () => media,
    busy: () => sending,
    onError: (message) => toast(message, { variant: 'error' })
  });

  // Who else is typing in this room. Notices name the person the server saw,
  // keyed like message authors (account id, or the guest's peer id) so their
  // message clears them.
  const roomTyping = createTypingTracker();
  const typingLabel = $derived(formatTypingLabel(roomTyping.people));

  function typingKey(person: { userId?: string | null; authorUserId?: string | null; peerId?: string }): string {
    return person.userId || person.authorUserId || person.peerId || '';
  }

  function editLastOwnMessage(): boolean {
    if (editingMessageId) return false;
    const lastOwn = timeline.messages.findLast(isOwnMessage);
    if (!lastOwn) return false;
    editingMessageId = lastOwn.id;
    timeline.error = '';
    return true;
  }

  function replyTo(message: ChatMessage): void {
    replyTarget = message;
    composer?.focus();
  }

  const days = $derived(buildChatDays(timeline.messages, isOwnMessage));

  $effect(() => {
    for (const message of timeline.messages) void reactions.load(message.id);
  });

  function isOwnMessage(message: ChatMessage): boolean {
    const accountUserId = session.user?.id;
    return Boolean((accountUserId && message.authorUserId === accountUserId) || (peerId && message.peerId === peerId));
  }

  // Showing the chat marks it read and parks the view on the newest message.
  $effect(() => {
    if (!chatVisible || !roomId) return;
    onRead?.();
    const endReadSession = beginRoomChatReadSession(roomId);
    void settleAtBottom().then(() => markLatestRenderedRead());
    return endReadSession;
  });

  onMount(() => {
    mobile = !getDesktopBoundaryPolicy().desktopAllowed;
    if (!roomId) {
      timeline.loading = false;
      timeline.error = 'Комната не найдена';
      return;
    }

    reactions.setConversation({ type: 'room', id: roomId });

    const controller = new AbortController();
    void initializeHistory(controller.signal);
    // Server-side preview subscription: without it the API only routes room
    // events (chat included) to active voice peers, so a user who opened the
    // room page but had not joined voice never received realtime messages.
    // It also re-subscribes after a WS reconnect and backfills missed
    // messages from the fresh room.snapshot.
    const unsubscribe = subscribeRoomPreview(roomId, (event) => {
      if (event.type === 'room.not_found') {
        applyRoomNotFound(event.payload.roomId);
        timeline.error = 'Комната не найдена';
        return;
      }
      if (event.type === 'room.updated') {
        applyRoomUpdated(event.payload.room);
        return;
      }
      if (event.type === 'room.deleted') {
        applyRoomDeleted(event.payload.roomId);
        return;
      }
      if (event.type === 'room.snapshot') {
        if (Array.isArray(event.payload.recentMessages)) {
          mergeMessages(event.payload.recentMessages.map(chatMessageFromRoomMessage));
          timeline.loading = false;
        }
        return;
      }
      if (event.type === 'room.chat.deleted') {
        const mid = event.payload?.messageId;
        if (mid) {
          timeline.remove(mid);
          reactions.markDeleted(mid);
        }
        return;
      }
      if (event.type === 'reaction.updated') {
        reactions.applyServer(event.payload.messageId, event.payload.summary);
        return;
      }
      if (event.type === 'room.pins') {
        applyRoomPinsEvent(event.payload.roomId, event.payload);
        return;
      }
      if (event.type === 'room.chat.edited') {
        const edited = chatMessageFromRoomMessage(event.payload.message);
        if (edited?.id) timeline.replace(edited);
        return;
      }
      // Account-backed messages render the current profile. Keep the open rail
      // in sync immediately when the room broadcasts a refreshed peer.
      if (event.type === 'room.peer.updated') {
        const peer = event.payload.peer;
        if (peer?.id) timeline.restamp(peer);
        return;
      }
      if (event.type === 'room.chat.typing') {
        const typist = event.payload.typist;
        if (!typist || typist.peerId === peerId || (typist.userId && typist.userId === session.user?.id)) return;
        roomTyping.note(typingKey(typist), typist.name, typingActivityOf(event.payload.activity));
        return;
      }
      if (event.type !== 'room.chat.message') return;
      const message = chatMessageFromRoomMessage(event.payload.message);
      if (message) roomTyping.clear(typingKey(message));
      if (!message || !timeline.add(message)) return;
      timeline.error = '';
      if (message.peerId !== peerId && !isRoomNotificationsMuted(roomId)) playRoomChatMessageCue(message.id);
      if (chatVisible) {
        onRead?.();
        setRoomUnreadCount(roomId, 0);
        void tick().then(() => {
          if (chatPinnedToBottom) scrollToBottom();
          void markRealtimeRenderedRead(message);
        });
      } else {
        onUnreadMessage?.();
      }
    });

    void loadRoomPins(roomId);
    if (session.user?.id) {
      void loadFrequentReactions('chat', session.user.id).then((emoji) => {
        if (emoji.length > 0) quickReactions = emoji;
      });
    }

    return () => {
      controller.abort();
      timeline.close();
      readReconciliation?.dispose();
      resetRoomPins();
      unsubscribe();
    };
  });

  // --- message context menu ---------------------------------------------

  function openMessageMenu(message: ChatMessage, event: MouseEvent): void {
    if (editingMessageId === message.id) return;
    event.preventDefault();
    menuMessage = message;
    menuX = event.clientX;
    menuY = event.clientY;
  }

  function closeMessageMenu(): void {
    menuMessage = null;
  }

  function reactFromMenu(messageId: string, emoji: string): void {
    void reactions.toggle(messageId, emoji);
  }

  // The emoji picker is owned by each message's hover toolbar, so the menu entry
  // drives that trigger rather than duplicating the popover.
  function openReactionPickerFor(messageId: string): void {
    queueMicrotask(() => {
      const row = chatBody?.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
      row?.querySelector<HTMLButtonElement>('.reaction-picker-trigger')?.click();
    });
  }

  function jumpToMessage(messageId: string): void {
    const row = chatBody?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`);
    if (!row) {
      toast('Сообщение не загружено — прокрутите историю выше');
      return;
    }
    flashMessage(row);
  }

  /** Centre a message and flash it, so the eye lands on the one that was meant. */
  function flashMessage(row: HTMLElement): void {
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.add('is-highlighted');
    setTimeout(() => row.classList.remove('is-highlighted'), 1600);
  }

  async function togglePinned(messageId: string): Promise<void> {
    try {
      await togglePin(roomId, messageId);
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : 'Не удалось закрепить сообщение', { variant: 'error' });
    }
  }

  // The server's recent messages after a (re)subscribe: edits missed while
  // disconnected appear, and the view stays on the newest message.
  function mergeMessages(recent: ChatMessage[]): void {
    timeline.reconcileLatest(recent);
    if (timeline.paged) {
      if (chatVisible) void tick().then(() => markLatestRenderedRead());
      return;
    }
    if (chatVisible) {
      onRead?.();
      void settleAtBottom();
    }
  }

  async function initializeHistory(signal: AbortSignal): Promise<void> {
    // Paged history is account-only: GET /chat/history answers a guest with 401
    // «Room is not available», which surfaced as a chat error in a room a guest
    // can otherwise read and write. Guests keep the recent-window endpoint.
    const paged = Boolean(session.user?.id);
    readReconciliation?.dispose();
    readReconciliation = session.user?.id
      ? createReadReconciliation({
          scope: `room:${roomId}`,
          commit: (cursor) => markRoomChatRead(roomId, cursor)
        })
      : null;
    const anchorMessageId = aroundMessageId || new URL(window.location.href).searchParams.get('around') || undefined;
    if (paged) await timeline.open(roomId, anchorMessageId);
    else await refreshMessages(signal);
    if (anchorMessageId && !signal.aborted) {
      await tick();
      chatPinnedToBottom = false;
      // Arriving from a notification lands the way jumping to a reply does:
      // centred and flashed. Mentions are already tinted, so with several on
      // screen the flash is what says which one this link was for.
      const target = chatBody?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(anchorMessageId)}"]`);
      if (target) flashMessage(target);
    } else if (!signal.aborted && chatVisible) {
      // The first page must land on the newest message: the body was empty when
      // the visibility effect ran, so its scroll then was a no-op.
      await settleAtBottom();
    }
    if (!signal.aborted && chatVisible) await tick().then(() => markLatestRenderedRead());
  }

  async function markLatestRenderedRead(cursor = timeline.latestReadCursor()): Promise<void> {
    if (!chatVisible || !session.user?.id || !roomId || !readReconciliation) return;
    await readReconciliation.advanceAfterRender(cursor);
  }

  async function markRealtimeRenderedRead(message: ChatMessage): Promise<void> {
    if (message.readCursor) {
      await markLatestRenderedRead(message.readCursor);
      return;
    }
    try {
      const targetRoomId = roomId;
      const page = await fetchRoomChatPage(targetRoomId, { mode: 'latest' });
      if (!timeline.paged || roomId !== targetRoomId || !page.messages.some((item) => item.id === message.id)) return;
      timeline.reconcileLatest(page.messages);
      await tick();
      await markLatestRenderedRead();
    } catch (cause) {
      log.error('failed to reconcile realtime room read cursor', errorContext(cause));
    }
  }

  function onHistoryScroll(): void {
    if (!chatBody) return;
    chatPinnedToBottom = chatBody.scrollHeight - chatBody.scrollTop - chatBody.clientHeight <= 48;
    if (!timeline.paged || chatBody.scrollTop > 32) return;
    void timeline.loadOlder(chatBody);
  }

  async function refreshMessages(signal?: AbortSignal): Promise<void> {
    if (!roomId) return;
    if ((await timeline.loadRecent(roomId, signal)) && chatVisible) {
      onRead?.();
      void settleAtBottom();
    }
  }

  async function send(outgoing: OutgoingRoomMessage): Promise<boolean> {
    timeline.error = '';
    try {
      // Resolved per send: the room rail reads a guest name that the name dialog
      // can persist after this component mounted.
      const payload = { name: resolveDisplayName(), ...peerCredentials(), ...outgoing };
      const message = await postRoomChat(roomId, { ...payload, idempotencyKey: sendAttempt.keyFor(payload) });
      if (timeline.add(message) && chatVisible) {
        onRead?.();
        void settleAtBottom();
      }
      sendAttempt.reset();
      return true;
    } catch (err) {
      timeline.error = err instanceof Error ? err.message : 'Не удалось отправить сообщение';
      return false;
    }
  }

  function scrollToBottom(): void {
    if (!chatBody) return;
    chatBody.scrollTop = chatBody.scrollHeight;
  }

  // Attachments and emoji fonts resize rows after the first paint, so a single
  // scroll lands short of the newest message. Re-pin across the next frames
  // until the height stops moving.
  async function settleAtBottom(): Promise<void> {
    await tick();
    scrollToBottom();
    chatPinnedToBottom = true;
    let lastHeight = chatBody?.scrollHeight ?? 0;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      if (!chatBody || !chatPinnedToBottom) return;
      if (chatBody.scrollHeight === lastHeight) continue;
      lastHeight = chatBody.scrollHeight;
      scrollToBottom();
    }
  }

  // Peer credentials exist only for a viewer who joined the room; the lobby
  // preview posts as the signed-in account instead.
  function peerCredentials(): { peerId?: string; sessionToken?: string } {
    return sessionToken ? { peerId, sessionToken } : {};
  }

  async function deleteMessage(messageId: string): Promise<void> {
    if (!roomId) return;
    try {
      await deleteRoomChatMessage(roomId, messageId, peerCredentials());
      timeline.remove(messageId);
    } catch {
      timeline.error = 'Не удалось удалить сообщение';
      setTimeout(() => (timeline.error = ''), 1600);
    }
  }

  async function saveEdit(messageId: string, text: string): Promise<void> {
    timeline.error = '';
    try {
      timeline.replace(await editRoomChatMessage(roomId, messageId, { ...peerCredentials(), text }));
    } catch (err) {
      timeline.error = err instanceof Error ? err.message : 'Не удалось изменить сообщение';
      throw err;
    }
  }

  // Left click on another author (avatar or name) shows their profile card.
  // Realtime participant data enriches it when available; message identity is
  // the stable fallback after that person has left the room.
  // Own rows open your own card; the host renders it in self mode, without
  // friend actions.
  const canOpenProfile = (group: ChatGroup): boolean => !group.self || Boolean(session.user?.id);

  function openUserProfile(group: ChatGroup, event: MouseEvent): void {
    if (!canOpenProfile(group)) return;
    const participant = getParticipantById(group.peerId);
    event.preventDefault();
    event.stopPropagation();
    const anchor = event.currentTarget;
    const person = participant
      ? participantProfilePerson(social, participant)
      : roomMessageProfilePerson(social, group.messages[0]);
    queueMicrotask(() => openProfileCardFor(person, anchor));
  }

  // A mention opens the same card the author's avatar opens, so "who is this"
  // has one answer everywhere in the message.
  function openMentionProfile(userId: string, label: string, event: MouseEvent): void {
    if (!userId) return;
    event.preventDefault();
    event.stopPropagation();
    const anchor = event.currentTarget;
    const person = mentionProfilePerson(social, userId, label, getRoomMembership(roomId).members, [
      ...roomState.peers.values()
    ]);
    queueMicrotask(() => openProfileCardFor(person, anchor));
  }

  function openUserMenu(group: ChatGroup, event: MouseEvent): void {
    if (group.self || !onAuthorContextMenu) return;
    event.preventDefault();
    event.stopPropagation();
    onAuthorContextMenu(group.peerId, event);
  }

  async function copyMessageText(message: ChatMessage): Promise<void> {
    try {
      await copyText(message.text);
      toast('Сообщение скопировано');
    } catch {
      toast('Не удалось скопировать', { variant: 'error' });
    }
  }
</script>

<aside
  class={rootClass}
  aria-label={ariaLabel}
  data-open={!hidden}
  {hidden}
  ondragenter={drop.enter}
  ondragover={drop.over}
  ondragleave={drop.leave}
  ondrop={drop.drop}
>
  {#if chatVisible && drop.active}<AttachmentDropOverlay />{/if}
  <RoomPanelHeader
    {activeTab}
    {unread}
    {mobile}
    {chatTabId}
    {participantsTabId}
    {chatPanelId}
    {participantsPanelId}
    {onSelectChat}
    {onSelectParticipants}
    {onCollapse}
  />

  {#if activeTab === 'chat'}
    <PinnedMessagesBar
      onJump={jumpToMessage}
      onUnpin={(messageId: string) => void togglePinned(messageId)}
      canUnpin={Boolean(session.user?.id)}
    />
    <div
      class="chat-rail-body"
      id={chatPanelId}
      role="tabpanel"
      aria-labelledby={chatTabId}
      bind:this={chatBody}
      onscroll={onHistoryScroll}
    >
      {#if timeline.loading}
        <p class="chat-rail-note">Загружаем сообщения…</p>
      {:else if days.length}
        {#if timeline.paged && (timeline.loadingOlder || timeline.hasMoreBefore)}
          <button
            class="chat-rail-note"
            type="button"
            disabled={timeline.loadingOlder}
            onclick={() => void timeline.loadOlder(chatBody)}
          >
            {timeline.loadingOlder ? 'Загружаем…' : 'Показать предыдущие'}
          </button>
        {/if}
        {#each days as day (day.key)}
          <section class="chat-day-section" aria-label={day.label}>
            <div class="chat-day-divider" role="separator" aria-label={day.label}>
              <span>{day.label}</span>
            </div>
            {#each day.groups as group (group.key)}
              <RoomChatMessageGroup
                {group}
                canOpenProfile={canOpenProfile(group)}
                {editingMessageId}
                menuMessageId={menuMessage?.id ?? ''}
                {reactions}
                onOpenProfile={(event: MouseEvent) => openUserProfile(group, event)}
                onAuthorMenu={(event: MouseEvent) => openUserMenu(group, event)}
                onMessageMenu={openMessageMenu}
                onSaveEdit={saveEdit}
                onCloseEdit={() => (editingMessageId = '')}
                onJump={jumpToMessage}
                onMention={openMentionProfile}
                onReply={replyTo}
                onCopy={(message: ChatMessage) => void copyMessageText(message)}
              />
            {/each}
          </section>
        {/each}
      {:else}
        <p class="chat-rail-note">Пока пусто. Напишите первое сообщение.</p>
      {/if}
    </div>

    {#if timeline.error}
      <p class="chat-rail-error">{timeline.error}</p>
    {/if}

    <RoomChatComposer
      bind:this={composer}
      bind:replyTarget
      bind:sending
      {roomId}
      {draft}
      {media}
      {typingLabel}
      {send}
      onEditLast={editLastOwnMessage}
      onJump={jumpToMessage}
      onToast={toast}
    />
  {:else if participants}
    <div class="room-panel-members" id={participantsPanelId} role="tabpanel" aria-labelledby={participantsTabId}>
      {@render participants()}
    </div>
  {/if}
</aside>

{#if menuMessage}
  {@const target = menuMessage}
  <MessageContextMenu
    open={Boolean(menuMessage)}
    x={menuX}
    y={menuY}
    {quickReactions}
    activeReactions={new Set(
      reactions
        .forMessage(target.id)
        .filter((summary) => summary.reactedByMe)
        .map((summary) => summary.emoji)
    )}
    canReact={Boolean(session.user?.id)}
    canPin={Boolean(session.user?.id)}
    pinned={isMessagePinned(target.id)}
    canEdit={isOwnMessage(target)}
    canDelete={isOwnMessage(target) || canModerate}
    onClose={closeMessageMenu}
    onReact={(emoji: string) => reactFromMenu(target.id, emoji)}
    onOpenReactionPicker={() => openReactionPickerFor(target.id)}
    onReply={() => replyTo(target)}
    onCopy={() => void copyMessageText(target)}
    onTogglePin={() => void togglePinned(target.id)}
    onEdit={() => {
      editingMessageId = target.id;
      timeline.error = '';
    }}
    onDelete={() => void deleteMessage(target.id)}
  />
{/if}

<style>
  :global(.chat-rail-body) {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 15px;
    padding: 18px 20px;
  }
  :global(.room-panel-members) {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 18px 16px 24px;
  }
  :where(.chat-rail-body) > :first-child {
    margin-top: auto;
  }
  :global(.chat-day-section) {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 15px;
  }
  :global(.chat-msg-body) {
    display: grid;
    min-width: 0;
    flex: 1;
    gap: 4px;
    justify-items: start;
  }
  :where(.chat-msg-body) > * {
    max-width: 100%;
  }
  :global(.chat-msg-edited) {
    margin-left: 5px;
    color: #777164;
    font-family: var(--font-mono);
    font-size: 9.5px;
    white-space: nowrap;
  }
  :global(.chat-rail-note),
  :global(.chat-rail-error) {
    margin: auto 0 0;
    color: var(--warm-550);
    font-size: 12.5px;
    line-height: 1.45;
  }
  :global(.chat-rail-error) {
    margin: 0;
    padding: 0 20px 8px;
    color: #d2a08c;
  }
</style>
