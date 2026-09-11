<script lang="ts">
  import type { Snippet } from 'svelte';
  import { ChevronRight, MessageSquare, Users } from '@lucide/svelte';
  import { iconSm } from '$lib/shared/ui/icons';
  import { onMount, tick } from 'svelte';
  import { deleteRoomChatMessage, editRoomChatMessage, fetchRoomChat, fetchRoomChatPage, markRoomChatRead, postRoomChat, type ChatMessage } from '$lib/api/rooms';
  import { beginRoomChatReadSession, setRoomUnreadCount } from '$lib/features/home/model/room-presence.svelte';
  import { session } from '$lib/features/auth/session.svelte';
  import { subscribeRoomPreview } from '$lib/features/home/model/room-realtime';
  import { formatChatDayLabel, isSameDay } from '$lib/shared/utils/chat-date';
  import ChatText from '$lib/shared/components/ChatText.svelte';
  import { Avatar } from '$lib/shared/ui';
  import { copyText } from '$lib/shared/utils/clipboard';
  import { getAvatarPresentation } from '../client/ui/avatar-presentation';
  import { playRoomChatMessageCue } from '../client/media/cues';
  import { applyRoomDeleted, applyRoomNotFound, applyRoomUpdated } from '../client/room/lifecycle';
  import { openProfileCardFor } from '$lib/features/home/profile-card-ui.svelte';
  import { getParticipantById } from '../client/room/participants';
  import { state as roomState } from '../client/core/state.svelte';
  import { mentionProfilePerson, participantProfilePerson, roomMessageProfilePerson } from '../profile-card-adapter';
  import { isRoomNotificationsMuted } from '$lib/shared/notifications/preferences.svelte';
  import { getCapabilityFeature } from '$lib/platform/capability-state.svelte';
  import { createAnchoredHistory } from '../room-history.svelte';
  import { createReadReconciliation } from '$lib/shared/chat/read-reconciliation.svelte';
  import { createReactionStore } from '$lib/shared/chat/reaction-store.svelte';
  import MessageContextMenu from '$lib/shared/chat/MessageContextMenu.svelte';
  import MessageHoverActions from '$lib/shared/chat/MessageHoverActions.svelte';
  import { DEFAULT_FREQUENT_REACTIONS, loadFrequentReactions } from '$lib/shared/chat/frequent-reactions';
  import PinnedMessagesBar from './PinnedMessagesBar.svelte';
  import {
    applyRoomPinsEvent,
    isMessagePinned,
    loadRoomPins,
    resetRoomPins,
    togglePin
  } from '../pins.svelte';
  import ReactionSummary from '$lib/shared/chat/ReactionSummary.svelte';
  import {
    dataTransferHasImages,
    getAttachmentComposeStore,
    imageFilesFromClipboard,
    imageFilesFromDataTransfer,
    type AttachmentComposeStore
  } from '$lib/shared/chat/attachment-compose.svelte';
  import AttachmentComposer from '$lib/shared/chat/AttachmentComposer.svelte';
  import AttachmentDropOverlay from '$lib/shared/chat/AttachmentDropOverlay.svelte';
  import AttachmentMosaic from '$lib/shared/chat/AttachmentMosaic.svelte';
  import AttachmentUploadControl from '$lib/shared/chat/AttachmentUploadControl.svelte';
  import ReplyPreview from '$lib/shared/chat/ReplyPreview.svelte';
  import ReplyTargetBar from '$lib/shared/chat/ReplyTargetBar.svelte';
  import StructuredMessageContent from '$lib/shared/chat/StructuredMessageContent.svelte';
  import { contentFromLegacyText } from '@voice-room/shared/room-message-content';
  import { createMentionComposer } from '$lib/shared/chat/mention-composer.svelte';
  import MentionAutocomplete from '$lib/shared/chat/MentionAutocomplete.svelte';
  import { getRoomMembership, loadRoomMembership } from '$lib/features/home/model/room-membership.svelte';
  import type { MembershipMember } from '@voice-room/shared/membership';

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

  let draft = $state('');
  let messages = $state<ChatMessage[]>([]);
  let loading = $state(true);
  let sending = $state(false);
  let editingMessageId = $state('');
  let editDraft = $state('');
  let editSaving = $state(false);
  let error = $state('');
  let chatBody = $state<HTMLDivElement | null>(null);
  let composeEl = $state<HTMLTextAreaElement | null>(null);
  let chatPinnedToBottom = true;
  let composerAttachmentCount = 0;
  let editEl = $state<HTMLTextAreaElement | null>(null);
  let historyEnabled = $state(false);
  let hasMoreBefore = $state(false);
  let loadingOlder = $state(false);
  let readCursorEnabled = $state(false);
  let readReconciliation: ReturnType<typeof createReadReconciliation> | null = null;
  let reactionsEnabled = $state(false);
  const reactions = createReactionStore();
  let media = $state<AttachmentComposeStore | null>(null);
  let attachmentDragDepth = $state(0);
  let repliesEnabled = $state(false);
  let engagementEnabled = $state(false);
  let replyTarget = $state<ChatMessage | null>(null);
  let menuMessage = $state<ChatMessage | null>(null);
  let menuX = $state(0);
  let menuY = $state(0);
  let quickReactions = $state<string[]>([...DEFAULT_FREQUENT_REACTIONS]);
  let sendAttemptKey = '';
  let sendAttemptFingerprint = '';
  const chatVisible = $derived(visible && activeTab === 'chat');

  function toast(message: string, options?: { variant?: 'error' }): void {
    onToast?.(message, options);
  }
  const mentionComposer = createMentionComposer();
  const history = createAnchoredHistory<ChatMessage>({
    loadPage: fetchRoomChatPage,
    compare: (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
    onChange: (state) => {
      messages = state.messages;
      loading = state.loading;
      loadingOlder = state.loadingOlder;
      hasMoreBefore = state.hasMoreBefore;
      error = state.error;
      messageIds.clear();
      for (const message of state.messages) messageIds.add(message.id);
    }
  });

  $effect(() => {
    const attachmentCount = media?.drafts.length ?? 0;
    if (attachmentCount === composerAttachmentCount) return;
    composerAttachmentCount = attachmentCount;
    if (chatPinnedToBottom) void tick().then(scrollToBottom);
  });

  function autoResize() {
    if (!composeEl) return;
    composeEl.style.height = 'auto';
    const next = Math.min(composeEl.scrollHeight, 140);
    composeEl.style.height = `${next}px`;
  }

  function idempotencyKeyFor(value: unknown): string {
    const fingerprint = JSON.stringify(value);
    if (!sendAttemptKey || sendAttemptFingerprint !== fingerprint) {
      sendAttemptKey = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sendAttemptFingerprint = fingerprint;
    }
    return sendAttemptKey;
  }

  function onComposeKeydown(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (mentionComposer.isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        mentionComposer.move(e.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        chooseMention(mentionComposer.candidates[mentionComposer.activeIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        mentionComposer.close();
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
      return;
    }
    // ArrowUp in an empty composer edits the last own message, like Discord.
    if (e.key === 'ArrowUp' && !draft.trim() && !editingMessageId) {
      const lastOwn = findLastOwnMessage();
      if (lastOwn) {
        e.preventDefault();
        startEditing(lastOwn);
      }
      return;
    }
    queueMicrotask(autoResize);
  }

  async function onComposePaste(event: ClipboardEvent): Promise<void> {
    if (!media) return;
    const files = imageFilesFromClipboard(event);
    if (!files.length) return;
    event.preventDefault();
    try {
      await media.addFiles(files);
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Не удалось вставить изображение', { variant: 'error' });
    }
  }

  function onAttachmentDragEnter(event: DragEvent): void {
    if (!media || sending || !dataTransferHasImages(event.dataTransfer)) return;
    event.preventDefault();
    attachmentDragDepth += 1;
  }

  function onAttachmentDragOver(event: DragEvent): void {
    if (!media || sending || !dataTransferHasImages(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  function onAttachmentDragLeave(event: DragEvent): void {
    if (!attachmentDragDepth) return;
    event.preventDefault();
    attachmentDragDepth = Math.max(0, attachmentDragDepth - 1);
  }

  async function onAttachmentDrop(event: DragEvent): Promise<void> {
    if (!media) return;
    const files = imageFilesFromDataTransfer(event.dataTransfer);
    if (!files.length) return;
    event.preventDefault();
    attachmentDragDepth = 0;
    try {
      await media.addFiles(files);
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Не удалось загрузить изображение', { variant: 'error' });
    }
  }

  function showAttachmentError(message: string): void {
    toast(message, { variant: 'error' });
  }

  async function updateMentionCandidates(): Promise<void> {
    if (!engagementEnabled || !session.user?.id || !composeEl) {
      mentionComposer.close();
      return;
    }
    const query = mentionComposer.update(draft, composeEl.selectionStart ?? draft.length);
    if (!query && !draft.slice(0, composeEl.selectionStart ?? draft.length).endsWith('@')) return;
    await loadRoomMembership(roomId, { query });
    if (mentionComposer.query !== query) return;
    mentionComposer.setCandidates(getRoomMembership(roomId).members.filter((member) => member.userId !== session.user?.id));
  }

  function chooseMention(member: MembershipMember): void {
    if (!composeEl) return;
    const selected = mentionComposer.choose(draft, composeEl.selectionStart ?? draft.length, member);
    if (!selected) return;
    draft = selected.text;
    void tick().then(() => {
      composeEl?.focus();
      composeEl?.setSelectionRange(selected.caret, selected.caret);
      autoResize();
    });
  }

  function findLastOwnMessage(): ChatMessage | null {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (isOwnMessage(messages[index])) return messages[index];
    }
    return null;
  }

  // Group consecutive messages from the same author (within 5 minutes) so the
  // avatar + name + time render once per burst, like the design's chat rail.
  interface ChatGroup {
    key: string;
    name: string;
    peerId: string;
    self: boolean;
    avatarBackground: string;
    avatarForeground: string;
    avatarShadow: string;
    avatarUrl: string | null;
    time: string;
    messages: ChatMessage[];
  }

  // Messages grouped by calendar day so each day renders under its own divider.
  interface ChatDay {
    key: string;
    label: string;
    groups: ChatGroup[];
  }

  const days = $derived(buildDays(messages));
  const messageIds = new Set<string>();

  $effect(() => {
    if (!reactionsEnabled) return;
    for (const message of messages) void reactions.load(message.id);
  });

  function isOwnMessage(message: ChatMessage): boolean {
    const accountUserId = session.user?.id;
    return Boolean(
      (accountUserId && message.authorUserId === accountUserId)
      || (peerId && message.peerId === peerId)
    );
  }

  // Showing the chat marks it read and parks the view on the newest message.
  $effect(() => {
    if (!chatVisible || !roomId) return;
    onRead?.();
    const endReadSession = beginRoomChatReadSession(roomId);
    void settleAtBottom().then(() => markLatestRenderedRead());
    return endReadSession;
  });

  function buildDays(items: ChatMessage[]): ChatDay[] {
    const result: ChatDay[] = [];
    for (const message of items) {
      let day = result.at(-1);
      if (!day || !isSameDay(Number(day.key), message.createdAt)) {
        day = { key: String(message.createdAt), label: formatChatDayLabel(message.createdAt), groups: [] };
        result.push(day);
      }

      const author = message.name || 'Гость';
      const last = day.groups.at(-1);
      const sameAuthor = last && last.peerId === message.peerId && last.name === author;
      const close = last && message.createdAt - (last.messages.at(-1)?.createdAt ?? 0) < 5 * 60 * 1000;
      if (sameAuthor && close) {
        last!.messages.push(message);
        continue;
      }
      const avatar = getAvatarPresentation({
        avatarAccent: message.avatarAccent || undefined,
        avatarColorKey: message.avatarColorKey,
        avatarUrl: message.avatarUrl || undefined,
        isLocal: isOwnMessage(message),
        name: author
      });
      day.groups.push({
        key: message.id,
        name: author,
        peerId: message.peerId,
        self: isOwnMessage(message),
        avatarBackground: avatar.background,
        avatarForeground: avatar.foreground,
        avatarShadow: avatar.shadow,
        avatarUrl: avatar.src,
        time: formatTime(message.createdAt),
        messages: [message]
      });
    }
    return result;
  }

  function formatTime(createdAt: number): string {
    return new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  onMount(() => {
    if (!roomId) {
      loading = false;
      error = 'Комната не найдена';
      return;
    }

    reactions.setConversation({ type: 'room', id: roomId });
    void getCapabilityFeature('mediaUploads').then((enabled) => {
      media = enabled ? getAttachmentComposeStore('room', roomId) : null;
    });
    void getCapabilityFeature('reactions').then((enabled) => { reactionsEnabled = enabled; });
    void getCapabilityFeature('replies').then((enabled) => { repliesEnabled = enabled; });
    void getCapabilityFeature('engagement').then((enabled) => { engagementEnabled = enabled; });

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
        error = 'Комната не найдена';
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
          mergeMessages(event.payload.recentMessages);
          loading = false;
        }
        return;
      }
      if (event.type === 'room.chat.deleted') {
        const mid = event.payload?.messageId;
        if (mid) {
          if (historyEnabled) history.remove(mid);
          else messages = messages.filter((m) => m.id !== mid);
          messageIds.delete(mid);
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
        const edited = event.payload.message;
        if (edited?.id) {
          if (historyEnabled) history.upsert(edited);
          else messages = messages.map((message) => message.id === edited.id ? edited : message);
        }
        return;
      }
      // Account-backed messages render the current profile. Keep the open rail
      // in sync immediately when the room broadcasts a refreshed peer.
      if (event.type === 'room.peer.updated') {
        const peer = event.payload.peer;
        if (!peer?.id) return;
        const authored = (message: ChatMessage) =>
          message.peerId === peer.id
          || Boolean(peer.accountUserId && message.authorUserId === peer.accountUserId);
        const stale = (message: ChatMessage) =>
          message.name !== peer.name
          || message.avatarUrl !== peer.avatarUrl
          || message.avatarAccent !== peer.avatarAccent
          || (Boolean(peer.avatarColorKey) && message.avatarColorKey !== peer.avatarColorKey);
        if (!messages.some((message) => authored(message) && stale(message))) return;
        messages = messages.map((message) => authored(message)
          ? {
              ...message,
              name: peer.name || message.name,
              avatarAccent: peer.avatarAccent,
              avatarColorKey: peer.avatarColorKey || message.avatarColorKey,
              avatarUrl: peer.avatarUrl
            }
          : message);
        return;
      }
      if (event.type !== 'room.chat.message') return;
      const message = event.payload.message;
      if (!message?.id || messageIds.has(message.id) || messages.some((item) => item.id === message.id)) return;
      messageIds.add(message.id);
      error = '';
      if (historyEnabled) history.upsert(message);
      else messages = [...messages, message];
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
      history.close();
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
      toast(
        err instanceof Error && err.message ? err.message : 'Не удалось закрепить сообщение',
        { variant: 'error' }
      );
    }
  }

  // Reconcile the server's recent-message window with what's already rendered:
  // known ids are replaced so edits missed while disconnected still appear,
  // while locally-appended messages outside the window remain intact.
  function mergeMessages(recent: ChatMessage[]): void {
    if (historyEnabled) {
      const firstCreatedAt = recent[0]?.createdAt;
      history.reconcileLatest(recent, (message) => firstCreatedAt == null || message.createdAt >= firstCreatedAt);
      if (chatVisible) void tick().then(() => markLatestRenderedRead());
      return;
    }
    const known = new Set(messages.map((item) => item.id));
    const recentById = new Map(recent.map((item) => [item.id, item]));
    const incoming = recent.filter((item) => item?.id && !known.has(item.id));
    error = '';
    for (const item of incoming) messageIds.add(item.id);
    messages = [
      ...messages.map((item) => recentById.get(item.id) ?? item),
      ...incoming
    ].sort((a, b) => a.createdAt - b.createdAt);
    if (chatVisible) {
      onRead?.();
      void settleAtBottom();
    }
  }

  async function initializeHistory(signal: AbortSignal): Promise<void> {
    const [canPage, canRead] = await Promise.all([
      getCapabilityFeature('historyCursor'),
      getCapabilityFeature('readCursor')
    ]).catch(() => [false, false] as const);
    if (signal.aborted) return;
    historyEnabled = canPage;
    readCursorEnabled = canRead;
    readReconciliation?.dispose();
    readReconciliation = session.user?.id
      ? createReadReconciliation({
          scope: `room:${roomId}`,
          legacy: !canRead,
          commit: (cursor) => markRoomChatRead(roomId, cursor)
        })
      : null;
    const anchorMessageId = aroundMessageId || new URL(window.location.href).searchParams.get('around') || undefined;
    if (historyEnabled) await history.open(roomId, anchorMessageId);
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
    if (!signal.aborted && chatVisible) {
      if (canRead) await tick().then(() => markLatestRenderedRead());
      else await markRoomChatRead(roomId);
    }
  }

  function latestReadCursor(): string | undefined {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].readCursor) return messages[index].readCursor;
    }
    return undefined;
  }

  async function markLatestRenderedRead(cursor = latestReadCursor()): Promise<void> {
    if (!chatVisible || !session.user?.id || !roomId || !readReconciliation) return;
    await readReconciliation.advanceAfterRender(cursor);
  }

  async function markRealtimeRenderedRead(message: ChatMessage): Promise<void> {
    if (message.readCursor || !readCursorEnabled) {
      await markLatestRenderedRead(message.readCursor);
      return;
    }
    try {
      const targetRoomId = roomId;
      const page = await fetchRoomChatPage(targetRoomId, { mode: 'latest' });
      if (!historyEnabled || roomId !== targetRoomId || !page.messages.some((item) => item.id === message.id)) return;
      const firstCreatedAt = page.messages[0]?.createdAt;
      history.reconcileLatest(page.messages, (item) => firstCreatedAt == null || item.createdAt >= firstCreatedAt);
      await tick();
      await markLatestRenderedRead();
    } catch (cause) {
      console.error('Failed to reconcile realtime room read cursor', cause);
    }
  }

  function onHistoryScroll(): void {
    if (!chatBody) return;
    chatPinnedToBottom = chatBody.scrollHeight - chatBody.scrollTop - chatBody.clientHeight <= 48;
    if (!historyEnabled || chatBody.scrollTop > 32) return;
    void history.loadOlder(chatBody);
  }

  async function refreshMessages(signal?: AbortSignal): Promise<void> {
    if (!roomId) return;
    try {
      const nextMessages = await fetchRoomChat(roomId);
      if (signal?.aborted) return;
      error = '';
      messageIds.clear();
      for (const message of nextMessages) messageIds.add(message.id);
      messages = nextMessages;
      if (chatVisible) {
        onRead?.();
        void settleAtBottom();
      }
    } catch (err) {
      if (signal?.aborted) return;
      error = err instanceof Error ? err.message : 'Не удалось загрузить чат';
    } finally {
      if (!signal?.aborted) loading = false;
    }
  }

  async function sendMessage(event?: SubmitEvent): Promise<void> {
    event?.preventDefault();
    if (!roomId || sending) return;

    // Do not collapse whitespace; newlines are intentional (2.4.0).
    const text = draft.trim();
    if (!text && !media?.canSend) return;
    if (media?.drafts.length && !media.canSend) return;

    sending = true;
    error = '';
    let sent = false;
    try {
      // Resolved per send: the room rail reads a guest name that the name dialog
      // can persist after this component mounted.
      const sendPayload = {
        name: resolveDisplayName(),
        ...peerCredentials(),
        text,
        content: engagementEnabled
          ? (mentionComposer.selected.length ? mentionComposer.toContent(text) : contentFromLegacyText(text) ?? undefined)
          : undefined,
        attachmentIds: media?.readyIds ?? [],
        replyTo: replyTarget ? { messageId: replyTarget.id } : undefined
      };
      const message = await postRoomChat(roomId, {
        ...sendPayload,
        idempotencyKey: idempotencyKeyFor(sendPayload)
      });
      if (!messageIds.has(message.id) && !messages.some((item) => item.id === message.id)) {
        messageIds.add(message.id);
        if (historyEnabled) history.upsert(message);
        else messages = [...messages, message];
        if (chatVisible) {
          onRead?.();
          void settleAtBottom();
        }
      }
      draft = '';
      media?.clearBound();
      replyTarget = null;
      sendAttemptKey = '';
      sendAttemptFingerprint = '';
      mentionComposer.reset();
      sent = true;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Не удалось отправить сообщение';
    } finally {
      sending = false;
    }
    if (!sent) return;
    await tick();
    if (composeEl) composeEl.style.height = '';
    composeEl?.focus();
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
      if (historyEnabled) history.remove(messageId);
      else messages = messages.filter((m) => m.id !== messageId);
      messageIds.delete(messageId);
    } catch {
      error = 'Не удалось удалить сообщение';
      setTimeout(() => (error = ''), 1600);
    }
  }

  function startEditing(message: ChatMessage): void {
    editingMessageId = message.id;
    editDraft = message.text;
    error = '';
    void tick().then(() => {
      editEl?.focus();
      editEl?.setSelectionRange(editEl.value.length, editEl.value.length);
    });
  }

  function cancelEditing(): void {
    editingMessageId = '';
    editDraft = '';
    editSaving = false;
  }

  function onEditKeydown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelEditing();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void saveEdit();
    }
  }

  async function saveEdit(): Promise<void> {
    const messageId = editingMessageId;
    const text = editDraft.trim();
    if (!roomId || !messageId || !text || editSaving) return;
    editSaving = true;
    error = '';
    try {
      const edited = await editRoomChatMessage(roomId, messageId, { ...peerCredentials(), text });
      if (historyEnabled) history.upsert(edited);
      else messages = messages.map((message) => message.id === edited.id ? edited : message);
      cancelEditing();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Не удалось изменить сообщение';
      editSaving = false;
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
      ? participantProfilePerson(participant)
      : roomMessageProfilePerson(group.messages[0]);
    queueMicrotask(() => openProfileCardFor(person, anchor));
  }

  // A mention opens the same card the author's avatar opens, so "who is this"
  // has one answer everywhere in the message.
  function openMentionProfile(userId: string, label: string, event: MouseEvent): void {
    if (!userId) return;
    event.preventDefault();
    event.stopPropagation();
    const anchor = event.currentTarget;
    const person = mentionProfilePerson(
      userId,
      label,
      getRoomMembership(roomId).members,
      [...roomState.peers.values()]
    );
    queueMicrotask(() => openProfileCardFor(person, anchor));
  }

  /** Whether this message points at the reader, so their own row stands out. */
  function mentionsMe(message: ChatMessage): boolean {
    const selfUserId = session.user?.id;
    if (!selfUserId || message.content?.version !== 1) return false;
    return message.content.segments.some(
      (segment) => segment.type === 'mention' && segment.userId === selfUserId
    );
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
  ondragenter={onAttachmentDragEnter}
  ondragover={onAttachmentDragOver}
  ondragleave={onAttachmentDragLeave}
  ondrop={onAttachmentDrop}
>
  {#if chatVisible && attachmentDragDepth > 0}<AttachmentDropOverlay />{/if}
  <header class="chat-rail-head">
    <div class="room-panel-tabs" role="tablist" aria-label="Раздел панели комнаты">
      <button
        id={chatTabId}
        type="button"
        role="tab"
        aria-controls={chatPanelId}
        aria-label="Чат"
        aria-selected={activeTab === 'chat'}
        data-active={activeTab === 'chat'}
        title="Чат"
        onclick={() => onSelectChat?.()}
      >
        <MessageSquare {...iconSm} aria-hidden="true" />
        {#if unread > 0}<span class="room-panel-tab-unread" aria-hidden="true"></span>{/if}
      </button>
      <button
        id={participantsTabId}
        type="button"
        role="tab"
        aria-controls={participantsPanelId}
        aria-label="Участники"
        aria-selected={activeTab === 'participants'}
        data-active={activeTab === 'participants'}
        title="Участники"
        onclick={() => onSelectParticipants?.()}
      >
        <Users {...iconSm} aria-hidden="true" />
      </button>
    </div>
    <button class="chat-rail-collapse" type="button" aria-label="Свернуть панель" onclick={() => onCollapse?.()}>
      <ChevronRight {...iconSm} aria-hidden="true" />
    </button>
  </header>

  {#if activeTab === 'chat'}
  <PinnedMessagesBar
    onJump={jumpToMessage}
    onUnpin={(messageId) => void togglePinned(messageId)}
    canUnpin={Boolean(session.user?.id)}
  />
  <div class="chat-rail-body" id={chatPanelId} role="tabpanel" aria-labelledby={chatTabId} bind:this={chatBody} onscroll={onHistoryScroll}>
    {#if loading}
      <p class="chat-rail-note">Загружаем сообщения…</p>
    {:else if days.length}
      {#if historyEnabled && (loadingOlder || hasMoreBefore)}
        <button class="chat-rail-note" type="button" disabled={loadingOlder} onclick={() => void history.loadOlder(chatBody)}>
          {loadingOlder ? 'Загружаем…' : 'Показать предыдущие'}
        </button>
      {/if}
      {#each days as day (day.key)}
        <section class="chat-day-section" aria-label={day.label}>
          <div class="chat-day-divider" role="separator" aria-label={day.label}>
            <span>{day.label}</span>
          </div>
          {#each day.groups as group (group.key)}
          <div class="chat-msg" data-self={group.self}>
          {#if canOpenProfile(group)}
            {@const label = group.self ? 'Ваш профиль' : `Профиль ${group.name}`}
            <button
              class="chat-avatar-button chat-msg-trigger"
              type="button"
              aria-haspopup="dialog"
              aria-label={label}
              title={label}
              onclick={(event) => openUserProfile(group, event)}
              oncontextmenu={(event) => openUserMenu(group, event)}
            >
              <Avatar class="chat-msg-avatar" name={group.name} src={group.avatarUrl} background={group.avatarBackground} size={34} />
            </button>
          {:else}
            <Avatar class="chat-msg-avatar" name={group.name} src={group.avatarUrl} background={group.avatarBackground} size={34} />
          {/if}
          <div class="chat-msg-main">
            <div class="chat-msg-meta">
              {#if canOpenProfile(group)}
                <button
                  class="chat-msg-author chat-msg-trigger"
                  type="button"
                  style={`color:${group.avatarBackground}`}
                  aria-haspopup="dialog"
                  aria-label={group.self ? 'Ваш профиль' : `Профиль ${group.name}`}
                  onclick={(event) => openUserProfile(group, event)}
                  oncontextmenu={(event) => openUserMenu(group, event)}
                >{group.name}</button>
              {:else}
                <span class="chat-msg-author" style={`color:${group.avatarBackground}`}>{group.name}</span>
              {/if}
              <time class="chat-msg-time" datetime={new Date(group.messages[0].createdAt).toISOString()}>{group.time}</time>
            </div>
            {#each group.messages as message (message.id)}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="chat-msg-text"
                class:is-context={menuMessage?.id === message.id}
                class:mentions-me={mentionsMe(message)}
                data-message-id={message.id}
                data-group-first={message.id === group.messages[0].id}
                oncontextmenu={(event) => openMessageMenu(message, event)}
              >
                {#if editingMessageId === message.id}
                  <div class="chat-msg-edit">
                    <textarea
                      class="chat-msg-edit-input"
                      bind:this={editEl}
                      bind:value={editDraft}
                      rows="2"
                      maxlength="500"
                      aria-label="Текст сообщения"
                      onkeydown={onEditKeydown}
                      disabled={editSaving}
                    ></textarea>
                    <div class="chat-msg-edit-actions">
                      <button type="button" onclick={cancelEditing} disabled={editSaving}>Отмена</button>
                      <button type="button" onclick={saveEdit} disabled={editSaving || !editDraft.trim()}>Сохранить</button>
                    </div>
                  </div>
                {:else}
                  <div class="chat-msg-body">
                    {#if message.replyPreview}<ReplyPreview preview={message.replyPreview} interactive onjump={jumpToMessage} />{/if}
                    <span class="chat-msg-content">{#if message.content}<StructuredMessageContent content={message.content} fallback={message.text} onmention={openMentionProfile} />{:else}<ChatText text={message.text} />{/if}{#if message.editedAt}<span class="chat-msg-edited">(изменено)</span>{/if}</span>
                    {#if message.attachments?.length}<AttachmentMosaic attachments={message.attachments} />{/if}
                    {#if reactionsEnabled}<ReactionSummary store={reactions} messageId={message.id} canMutate={Boolean(session.user?.id)} />{/if}
                  </div>
                  <MessageHoverActions
                    reactionStore={reactionsEnabled && session.user?.id ? reactions : undefined}
                    messageId={message.id}
                    userId={session.user?.id}
                    canReply={repliesEnabled}
                    onReply={() => { replyTarget = message; composeEl?.focus(); }}
                    onCopy={() => void copyMessageText(message)}
                    onMore={(event) => openMessageMenu(message, event)}
                  />
                {/if}
              </div>
            {/each}
          </div>
          </div>
          {/each}
        </section>
      {/each}
    {:else}
      <p class="chat-rail-note">Пока пусто. Напишите первое сообщение.</p>
    {/if}
  </div>

  {#if error}
    <p class="chat-rail-error">{error}</p>
  {/if}

  <form class="chat-rail-compose" onsubmit={sendMessage} onpaste={onComposePaste}>
    <div class="chat-compose-row attachment-compose-field">
      {#if replyTarget}
        {@const target = replyTarget}
        <ReplyTargetBar
          target={{ messageId: target.id, deleted: false, author: { id: target.authorUserId || target.peerId, name: target.name }, text: target.text }}
          onjump={jumpToMessage}
          oncancel={() => (replyTarget = null)}
        />
      {/if}
      {#if media}<AttachmentComposer store={media} disabled={sending} />{/if}
      <div class="attachment-compose-controls">
        {#if media}<AttachmentUploadControl store={media} disabled={sending} onerror={showAttachmentError} />{/if}
        <textarea
          class="chat-rail-input chat-rail-textarea"
          bind:this={composeEl}
          bind:value={draft}
          rows="1"
          maxlength="500"
          placeholder="Написать в комнату…"
          onkeydown={onComposeKeydown}
          oninput={() => { autoResize(); void updateMentionCandidates(); }}
          oncompositionstart={() => mentionComposer.setComposing(true)}
          oncompositionend={() => { mentionComposer.setComposing(false); void updateMentionCandidates(); }}
          disabled={sending}
        ></textarea>
      </div>
    </div>
    {#if mentionComposer.isOpen}
      <MentionAutocomplete candidates={mentionComposer.candidates} activeIndex={mentionComposer.activeIndex} onselect={chooseMention} />
    {/if}
  </form>
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
    quickReactions={quickReactions}
    activeReactions={new Set(
      reactions.forMessage(target.id).filter((summary) => summary.reactedByMe).map((summary) => summary.emoji)
    )}
    canReact={reactionsEnabled && Boolean(session.user?.id)}
    canReply={repliesEnabled}
    canPin={Boolean(session.user?.id)}
    pinned={isMessagePinned(target.id)}
    canEdit={isOwnMessage(target)}
    canDelete={isOwnMessage(target) || canModerate}
    onClose={closeMessageMenu}
    onReact={(emoji) => reactFromMenu(target.id, emoji)}
    onOpenReactionPicker={() => openReactionPickerFor(target.id)}
    onReply={() => { replyTarget = target; composeEl?.focus(); }}
    onCopy={() => void copyMessageText(target)}
    onTogglePin={() => void togglePinned(target.id)}
    onEdit={() => startEditing(target)}
    onDelete={() => void deleteMessage(target.id)}
  />
{/if}
