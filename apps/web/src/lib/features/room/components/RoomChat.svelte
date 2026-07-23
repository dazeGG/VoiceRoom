<script lang="ts">
  import { ChevronRight, Copy, MessageSquare, Pencil, Trash2 } from '@lucide/svelte';
  import { iconSm } from '$lib/shared/ui/icons';
  import { onMount, tick } from 'svelte';
  import { deleteRoomChatMessage, editRoomChatMessage, fetchRoomChat, fetchRoomChatPage, markRoomChatRead, postRoomChat, type ChatMessage } from '$lib/api/rooms';
  import { beginRoomChatReadSession, setRoomUnreadCount } from '$lib/features/home/model/room-presence.svelte';
  import { session } from '$lib/features/auth/session.svelte';
  import { subscribeRoomPreview } from '$lib/features/home/model/room-realtime';
  import { formatChatDayLabel, isSameDay } from '$lib/shared/utils/chat-date';
  import { cleanDisplayName } from '$lib/shared/utils/text';
  import ChatText from '$lib/shared/components/ChatText.svelte';
  import { Avatar } from '$lib/shared/ui';
  import { copyText } from '$lib/shared/utils/clipboard';
  import { showToast } from '../client/ui/toast';
  import { getAvatarPresentation } from '../client/ui/avatar-presentation';
  import { getRoomIdFromPath, getStoredPeerSession } from '../client/core/session';
  import { playRoomChatMessageCue } from '../client/media/cues';
  import { applyRoomDeleted, applyRoomNotFound, applyRoomUpdated } from '../client/room/lifecycle';
  import { openParticipantContextMenu } from '../participant-context-ui.svelte';
  import { roomUi, closeChat, incrementUnreadChat, markChatRead } from '../room-ui.svelte';
  import { isRoomNotificationsMuted } from '$lib/shared/notifications/preferences.svelte';
  import { getCapabilityFeature } from '$lib/platform/capability-state.svelte';
  import { createAnchoredHistory } from '../room-history.svelte';
  import { createReadReconciliation } from '$lib/shared/chat/read-reconciliation.svelte';
  import { createReactionStore } from '$lib/shared/chat/reaction-store.svelte';
  import ReactionPicker from '$lib/shared/chat/ReactionPicker.svelte';
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
  import StructuredMessageContent from '$lib/shared/chat/StructuredMessageContent.svelte';
  import { contentFromLegacyText } from '@voice-room/shared/room-message-content';
  import { createMentionComposer } from '$lib/shared/chat/mention-composer.svelte';
  import MentionAutocomplete from '$lib/shared/chat/MentionAutocomplete.svelte';
  import { getRoomMembership, loadRoomMembership } from '$lib/features/home/model/room-membership.svelte';
  import type { MembershipMember } from '@voice-room/shared/membership';

  let roomId = $state('');
  let peerId = $state('');
  let sessionToken = $state('');
  let displayName = $state('Гость');
  let draft = $state('');
  let messages = $state<ChatMessage[]>([]);
  let loading = $state(true);
  let sending = $state(false);
  let editingMessageId = $state('');
  let editDraft = $state('');
  let editSaving = $state(false);
  let error = $state('');
  let chatBody: HTMLDivElement | null = null;
  let composeEl: HTMLTextAreaElement | null = null;
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
  let sendAttemptKey = '';
  let sendAttemptFingerprint = '';
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
      showToast(cause instanceof Error ? cause.message : 'Не удалось вставить изображение', { variant: 'error' });
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
      showToast(cause instanceof Error ? cause.message : 'Не удалось загрузить изображение', { variant: 'error' });
    }
  }

  function showAttachmentError(message: string): void {
    showToast(message, { variant: 'error' });
  }

  async function updateMentionCandidates(): Promise<void> {
    if (!engagementEnabled || !session.user?.id || !composeEl) {
      mentionComposer.close();
      return;
    }
    const query = mentionComposer.update(draft, composeEl.selectionStart ?? draft.length);
    if (!query && !draft.slice(0, composeEl.selectionStart ?? draft.length).endsWith('@')) return;
    await loadRoomMembership(roomId, { query });
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

  // Reflect chat state onto <body> so the room layout + dock can react in CSS.
  $effect(() => {
    document.body.dataset.chatOpen = roomUi.chatOpen ? 'true' : 'false';
    let endReadSession = () => {};
    if (roomUi.chatOpen) {
      markChatRead();
      endReadSession = beginRoomChatReadSession(roomId);
      void tick().then(() => {
        scrollToBottom();
        void markLatestRenderedRead();
      });
    }
    return () => {
      endReadSession();
      delete document.body.dataset.chatOpen;
    };
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
    roomId = getRoomIdFromPath();
    if (!roomId) {
      loading = false;
      error = 'Комната не найдена';
      return;
    }

    const peerSession = getStoredPeerSession(roomId);
    peerId = peerSession.peerId;
    sessionToken = peerSession.sessionToken;
    displayName = cleanDisplayName(localStorage.getItem('voice-room:name')) || 'Гость';
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
      if (message.peerId !== peerId && !isRoomNotificationsMuted(roomId)) playRoomChatMessageCue();
      if (roomUi.chatOpen) {
        markChatRead();
        setRoomUnreadCount(roomId, 0);
        void tick().then(() => {
          scrollToBottom();
          void markRealtimeRenderedRead(message);
        });
      } else {
        incrementUnreadChat();
      }
    });

    return () => {
      controller.abort();
      history.close();
      readReconciliation?.dispose();
      unsubscribe();
    };
  });

  // Reconcile the server's recent-message window with what's already rendered:
  // known ids are replaced so edits missed while disconnected still appear,
  // while locally-appended messages outside the window remain intact.
  function mergeMessages(recent: ChatMessage[]): void {
    if (historyEnabled) {
      const firstCreatedAt = recent[0]?.createdAt;
      history.reconcileLatest(recent, (message) => firstCreatedAt == null || message.createdAt >= firstCreatedAt);
      if (roomUi.chatOpen) void tick().then(() => markLatestRenderedRead());
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
    if (roomUi.chatOpen) {
      markChatRead();
      queueMicrotask(scrollToBottom);
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
    const aroundMessageId = new URL(window.location.href).searchParams.get('around') || undefined;
    if (historyEnabled) await history.open(roomId, aroundMessageId);
    else await refreshMessages(signal);
    if (aroundMessageId && !signal.aborted) {
      await tick();
      document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(aroundMessageId)}"]`)?.scrollIntoView({ block: 'center' });
    }
    if (!signal.aborted && roomUi.chatOpen) {
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
    if (!roomUi.chatOpen || !session.user?.id || !roomId || !readReconciliation) return;
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
    } catch {}
  }

  function onHistoryScroll(): void {
    if (!historyEnabled || !chatBody || chatBody.scrollTop > 32) return;
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
      if (roomUi.chatOpen) {
        markChatRead();
        queueMicrotask(scrollToBottom);
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
      // Re-read the saved name at send time: the guest name dialog can persist a
      // name after this component mounted, so the value captured in onMount may be
      // stale (showing "Гость" even though the user entered a name).
      displayName = cleanDisplayName(localStorage.getItem('voice-room:name')) || 'Гость';
      const sendPayload = {
        name: displayName,
        peerId,
        sessionToken,
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
        if (roomUi.chatOpen) {
          markChatRead();
          queueMicrotask(scrollToBottom);
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

  async function deleteMessage(messageId: string): Promise<void> {
    if (!roomId) return;
    try {
      await deleteRoomChatMessage(roomId, messageId, { peerId, sessionToken });
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
      const edited = await editRoomChatMessage(roomId, messageId, { peerId, sessionToken, text });
      if (historyEnabled) history.upsert(edited);
      else messages = messages.map((message) => message.id === edited.id ? edited : message);
      cancelEditing();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Не удалось изменить сообщение';
      editSaving = false;
    }
  }

  // Open the participant context menu from a chat author (avatar or name). Only
  // works for others who are still in the room; self and absent peers are inert.
  function openUserMenu(group: ChatGroup, event: MouseEvent): void {
    if (group.self) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    queueMicrotask(() => openParticipantContextMenu(group.peerId, rect.left + rect.width / 2, rect.bottom + 6));
  }

  async function copyMessageText(message: ChatMessage): Promise<void> {
    try {
      await copyText(message.text);
      showToast('Сообщение скопировано');
    } catch {
      showToast('Не удалось скопировать', { variant: 'error' });
    }
  }
</script>

<aside
  class="room-chat-rail"
  aria-label="Чат комнаты"
  data-open={roomUi.chatOpen}
  hidden={!roomUi.chatOpen}
  ondragenter={onAttachmentDragEnter}
  ondragover={onAttachmentDragOver}
  ondragleave={onAttachmentDragLeave}
  ondrop={onAttachmentDrop}
>
  {#if attachmentDragDepth > 0}<AttachmentDropOverlay />{/if}
  <header class="chat-rail-head">
    <div class="chat-rail-title">
      <MessageSquare {...iconSm} aria-hidden="true" />
      <span>Чат комнаты</span>
    </div>
    <button class="chat-rail-collapse" type="button" aria-label="Свернуть чат" onclick={closeChat}>
      <ChevronRight {...iconSm} aria-hidden="true" />
    </button>
  </header>

  <div class="chat-rail-body" bind:this={chatBody} onscroll={onHistoryScroll}>
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
          {#if group.self}
            <Avatar class="chat-msg-avatar" name={group.name} src={group.avatarUrl} background={group.avatarBackground} size={34} />
          {:else}
            <button
              class="chat-avatar-button chat-msg-trigger"
              type="button"
              aria-haspopup="dialog"
              aria-label={`Действия для ${group.name}`}
              title={`Действия для ${group.name}`}
              onclick={(event) => openUserMenu(group, event)}
            >
              <Avatar class="chat-msg-avatar" name={group.name} src={group.avatarUrl} background={group.avatarBackground} size={34} />
            </button>
          {/if}
          <div class="chat-msg-main">
            <div class="chat-msg-meta">
              {#if group.self}
                <span class="chat-msg-author" style={`color:${group.avatarBackground}`}>{group.name}</span>
              {:else}
                <button
                  class="chat-msg-author chat-msg-trigger"
                  type="button"
                  style={`color:${group.avatarBackground}`}
                  aria-haspopup="dialog"
                  aria-label={`Действия для ${group.name}`}
                  onclick={(event) => openUserMenu(group, event)}
                >{group.name}</button>
              {/if}
              <time class="chat-msg-time" datetime={new Date(group.messages[0].createdAt).toISOString()}>{group.time}</time>
            </div>
            {#each group.messages as message (message.id)}
              <div class="chat-msg-text" data-message-id={message.id}>
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
                  {#if message.replyPreview}<ReplyPreview preview={message.replyPreview} />{/if}
                  <span class="chat-msg-content">{#if message.content}<StructuredMessageContent content={message.content} fallback={message.text} />{:else}<ChatText text={message.text} />{/if}{#if message.editedAt}<span class="chat-msg-edited">(изменено)</span>{/if}</span>
                  {#if message.attachments?.length}<AttachmentMosaic attachments={message.attachments} />{/if}
                  <div class="chat-msg-actions" role="toolbar" aria-label="Действия с сообщением">
                    {#if repliesEnabled}<button type="button" aria-label="Ответить" title="Ответить" onclick={() => { replyTarget = message; composeEl?.focus(); }}><MessageSquare {...iconSm} /></button>{/if}
                    {#if reactionsEnabled}<ReactionPicker store={reactions} messageId={message.id} disabled={!session.user?.id} />{/if}
                    <button type="button" aria-label="Копировать текст" title="Копировать текст" onclick={() => void copyMessageText(message)}><Copy {...iconSm} /></button>
                    {#if group.self}
                      <button type="button" aria-label="Редактировать" title="Редактировать" onclick={() => startEditing(message)}><Pencil {...iconSm} /></button>
                      <button class="chat-msg-action-danger" type="button" aria-label="Удалить" title="Удалить" onclick={() => void deleteMessage(message.id)}><Trash2 {...iconSm} /></button>
                    {/if}
                  </div>
                  {#if reactionsEnabled}<ReactionSummary store={reactions} messageId={message.id} canMutate={Boolean(session.user?.id)} />{/if}
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
    {#if replyTarget}
      <div class="chat-reply-target"><ReplyPreview preview={{ messageId: replyTarget.id, deleted: false, author: { id: replyTarget.authorUserId || replyTarget.peerId, name: replyTarget.name }, text: replyTarget.text }} /><button type="button" onclick={() => (replyTarget = null)}>Отмена</button></div>
    {/if}
    {#if media}<AttachmentComposer store={media} disabled={sending} />{/if}
    <div class="chat-compose-row attachment-compose-field">
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
    {#if mentionComposer.isOpen}
      <MentionAutocomplete candidates={mentionComposer.candidates} activeIndex={mentionComposer.activeIndex} onselect={chooseMention} />
    {/if}
  </form>
</aside>
