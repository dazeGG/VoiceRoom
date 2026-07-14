<script lang="ts">
  import { ChevronRight, Copy, MessageSquare, Pencil, Trash2 } from '@lucide/svelte';
  import { iconSm } from '$lib/shared/ui/icons';
  import { onMount, tick } from 'svelte';
  import { deleteRoomChatMessage, editRoomChatMessage, fetchRoomChat, markRoomChatRead, postRoomChat, type ChatMessage } from '$lib/api/rooms';
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

  function autoResize() {
    if (!composeEl) return;
    composeEl.style.height = 'auto';
    const next = Math.min(composeEl.scrollHeight, 140);
    composeEl.style.height = `${next}px`;
  }

  function onComposeKeydown(e: KeyboardEvent) {
    if (e.isComposing) return;
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
      if (session.user?.id && roomId) void markRoomChatRead(roomId).catch(() => {});
      queueMicrotask(scrollToBottom);
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

    const controller = new AbortController();
    void refreshMessages(controller.signal);
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
          messages = messages.filter((m) => m.id !== mid);
          messageIds.delete(mid);
        }
        return;
      }
      if (event.type === 'room.chat.edited') {
        const edited = event.payload.message;
        if (edited?.id) {
          messages = messages.map((message) => message.id === edited.id ? edited : message);
        }
        return;
      }
      // Messages carry an avatar snapshot taken at send time, so a profile
      // change would leave stale avatars in the rail. Re-stamp the author's
      // messages when the room broadcasts the refreshed peer.
      if (event.type === 'room.peer.updated') {
        const peer = event.payload.peer;
        if (!peer?.id) return;
        const authored = (message: ChatMessage) =>
          message.peerId === peer.id
          || Boolean(peer.accountUserId && message.authorUserId === peer.accountUserId);
        const stale = (message: ChatMessage) =>
          message.avatarUrl !== peer.avatarUrl
          || message.avatarAccent !== peer.avatarAccent
          || (Boolean(peer.avatarColorKey) && message.avatarColorKey !== peer.avatarColorKey);
        if (!messages.some((message) => authored(message) && stale(message))) return;
        messages = messages.map((message) => authored(message)
          ? {
              ...message,
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
      messages = [...messages, message];
      if (message.peerId !== peerId) playRoomChatMessageCue();
      if (roomUi.chatOpen) {
        markChatRead();
        setRoomUnreadCount(roomId, 0);
        if (session.user?.id) void markRoomChatRead(roomId).catch(() => {});
        queueMicrotask(scrollToBottom);
      } else {
        incrementUnreadChat();
      }
    });

    return () => {
      controller.abort();
      unsubscribe();
    };
  });

  // Reconcile the server's recent-message window with what's already rendered:
  // known ids are replaced so edits missed while disconnected still appear,
  // while locally-appended messages outside the window remain intact.
  function mergeMessages(recent: ChatMessage[]): void {
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
    if (!text) return;

    sending = true;
    error = '';
    let sent = false;
    try {
      // Re-read the saved name at send time: the guest name dialog can persist a
      // name after this component mounted, so the value captured in onMount may be
      // stale (showing "Гость" even though the user entered a name).
      displayName = cleanDisplayName(localStorage.getItem('voice-room:name')) || 'Гость';
      const message = await postRoomChat(roomId, {
        name: displayName,
        peerId,
        sessionToken,
        text
      });
      if (!messageIds.has(message.id) && !messages.some((item) => item.id === message.id)) {
        messageIds.add(message.id);
        messages = [...messages, message];
        if (roomUi.chatOpen) {
          markChatRead();
          queueMicrotask(scrollToBottom);
        }
      }
      draft = '';
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
      messages = messages.filter((m) => m.id !== messageId);
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
      messages = messages.map((message) => message.id === edited.id ? edited : message);
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

<aside class="room-chat-rail" aria-label="Чат комнаты" data-open={roomUi.chatOpen} hidden={!roomUi.chatOpen}>
  <header class="chat-rail-head">
    <div class="chat-rail-title">
      <MessageSquare {...iconSm} aria-hidden="true" />
      <span>Чат комнаты</span>
    </div>
    <button class="chat-rail-collapse" type="button" aria-label="Свернуть чат" onclick={closeChat}>
      <ChevronRight {...iconSm} aria-hidden="true" />
    </button>
  </header>

  <div class="chat-rail-body" bind:this={chatBody}>
    {#if loading}
      <p class="chat-rail-note">Загружаем сообщения…</p>
    {:else if days.length}
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
              <div class="chat-msg-text">
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
                  <span class="chat-msg-content"><ChatText text={message.text} />{#if message.editedAt}<span class="chat-msg-edited">(изменено)</span>{/if}</span>
                  <div class="chat-msg-actions" role="toolbar" aria-label="Действия с сообщением">
                    <button type="button" aria-label="Копировать текст" title="Копировать текст" onclick={() => void copyMessageText(message)}><Copy {...iconSm} /></button>
                    {#if group.self}
                      <button type="button" aria-label="Редактировать" title="Редактировать" onclick={() => startEditing(message)}><Pencil {...iconSm} /></button>
                      <button class="chat-msg-action-danger" type="button" aria-label="Удалить" title="Удалить" onclick={() => void deleteMessage(message.id)}><Trash2 {...iconSm} /></button>
                    {/if}
                  </div>
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

  <form class="chat-rail-compose" onsubmit={sendMessage}>
    <textarea
      class="chat-rail-input chat-rail-textarea"
      bind:this={composeEl}
      bind:value={draft}
      rows="1"
      maxlength="500"
      placeholder="Написать в комнату…"
      onkeydown={onComposeKeydown}
      oninput={autoResize}
      disabled={sending}
    ></textarea>
  </form>
</aside>
