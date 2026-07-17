<script lang="ts">
  import { ChevronRight, Copy, MessageSquare, Pencil, Trash2 } from '@lucide/svelte';
  import type { AuthUser } from '$lib/api/auth';
  import { iconSm } from '$lib/shared/ui/icons';
  import { getAppRealtime } from '$lib/api/realtime';
  import { deleteRoomChatMessage, editRoomChatMessage, fetchRoomChat, markRoomChatRead, postRoomChat, type ChatMessage } from '$lib/api/rooms';
  import { beginRoomChatReadSession, setRoomUnreadCount } from '../../model/room-presence.svelte';
  import { playRoomChatMessageCue } from '$lib/features/room/client/media/cues';
  import { Avatar } from '$lib/shared/ui';
  import { getAvatarPresentation } from '$lib/features/room/client/ui/avatar-presentation';
  import { friendName } from '../../model/lobby-format';
  import ChatText from '$lib/shared/components/ChatText.svelte';
  import { copyText } from '$lib/shared/utils/clipboard';
  import { isRoomNotificationsMuted } from '$lib/shared/notifications/preferences.svelte';
  import { tick } from 'svelte';

  let { roomId, user, onClose, onToast } = $props<{
    roomId: string;
    user: AuthUser;
    onClose?: () => void;
    onToast?: (message: string) => void;
  }>();

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

  $effect(() => {
    const activeRoomId = roomId;
    const endReadSession = beginRoomChatReadSession(activeRoomId);
    void markRoomChatRead(activeRoomId).catch(() => {});
    return endReadSession;
  });

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
    } else {
      queueMicrotask(autoResize);
    }
  }

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

  const displayName = $derived(friendName(user));
  const accountPeerId = $derived(`auth-${user.id}`);
  const groups = $derived(buildGroups(messages));
  const messageIds = new Set<string>();

  function isOwnMessage(message: ChatMessage): boolean {
    return message.authorUserId === user.id || message.peerId === accountPeerId;
  }

  function buildGroups(items: ChatMessage[]): ChatGroup[] {
    const result: ChatGroup[] = [];
    for (const message of items) {
      const author = message.name || 'Гость';
      const last = result.at(-1);
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
      result.push({
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

  async function refreshMessages(signal?: AbortSignal): Promise<void> {
    if (!roomId) return;
    try {
      const nextMessages = await fetchRoomChat(roomId);
      if (signal?.aborted) return;
      error = '';
      messageIds.clear();
      for (const message of nextMessages) messageIds.add(message.id);
      messages = nextMessages;
      queueMicrotask(scrollToBottom);
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
      const message = await postRoomChat(roomId, { name: displayName, text });
      if (!messageIds.has(message.id) && !messages.some((item) => item.id === message.id)) {
        messageIds.add(message.id);
        messages = [...messages, message];
        queueMicrotask(scrollToBottom);
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
      await deleteRoomChatMessage(roomId, messageId);
      messages = messages.filter((message) => message.id !== messageId);
      messageIds.delete(messageId);
    } catch {
      error = 'Не удалось удалить сообщение';
      setTimeout(() => (error = ''), 1600);
    }
  }

  async function copyMessageText(message: ChatMessage): Promise<void> {
    try {
      await copyText(message.text);
      onToast?.('Сообщение скопировано');
    } catch {
      onToast?.('Не удалось скопировать');
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
      const edited = await editRoomChatMessage(roomId, messageId, { text });
      messages = messages.map((message) => message.id === edited.id ? edited : message);
      cancelEditing();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Не удалось изменить сообщение';
      editSaving = false;
    }
  }

  $effect(() => {
    const activeRoomId = roomId;
    if (!activeRoomId) return;

    loading = true;
    messages = [];
    error = '';
    messageIds.clear();

    const controller = new AbortController();
    void refreshMessages(controller.signal);
    const unsubscribe = getAppRealtime().subscribe((event) => {
      if (event.type === 'room.snapshot' && event.payload.roomId === activeRoomId) {
        const recent = event.payload.recentMessages;
        if (Array.isArray(recent)) {
          messages = recent;
          messageIds.clear();
          for (const message of recent) messageIds.add(message.id);
          loading = false;
          queueMicrotask(scrollToBottom);
        }
        return;
      }
      if (event.type === 'room.chat.deleted' && event.payload.roomId === activeRoomId) {
        const messageId = event.payload.messageId;
        if (messageId) {
          messages = messages.filter((message) => message.id !== messageId);
          messageIds.delete(messageId);
        }
        return;
      }
      if (event.type === 'room.chat.edited' && event.payload.roomId === activeRoomId) {
        const edited = event.payload.message;
        if (edited?.id) {
          messages = messages.map((message) => message.id === edited.id ? edited : message);
        }
        return;
      }
      if (event.type === 'room.peer.updated' && event.payload.roomId === activeRoomId) {
        const peer = event.payload.peer;
        const authored = (message: ChatMessage) =>
          message.peerId === peer.id
          || Boolean(peer.accountUserId && message.authorUserId === peer.accountUserId);
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
      if (event.type !== 'room.chat.message' || event.payload.roomId !== activeRoomId) return;
      const message = event.payload.message;
      if (!message?.id || messageIds.has(message.id) || messages.some((item) => item.id === message.id)) return;
      messageIds.add(message.id);
      error = '';
      messages = [...messages, message];
      if (message.peerId !== accountPeerId && !isRoomNotificationsMuted(activeRoomId)) playRoomChatMessageCue();
      setRoomUnreadCount(activeRoomId, 0);
      void markRoomChatRead(activeRoomId).catch(() => {});
      queueMicrotask(scrollToBottom);
    });

    return () => {
      controller.abort();
      unsubscribe();
    };
  });
</script>

<aside class="lobby-preview-chat" aria-label="Чат комнаты">
  <header class="chat-rail-head">
    <div class="chat-rail-title">
      <MessageSquare {...iconSm} aria-hidden="true" />
      <span>Чат комнаты</span>
    </div>
    <button class="chat-rail-collapse" type="button" aria-label="Свернуть чат" onclick={onClose}>
      <ChevronRight {...iconSm} aria-hidden="true" />
    </button>
  </header>

  <div class="chat-rail-body" bind:this={chatBody}>
    {#if loading}
      <p class="chat-rail-note">Загружаем сообщения…</p>
    {:else if groups.length}
      {#each groups as group (group.key)}
        <div class="chat-msg" data-self={group.self}>
          <Avatar class="chat-msg-avatar" name={group.name} src={group.avatarUrl} background={group.avatarBackground} size={34} />
          <div class="chat-msg-main">
            <div class="chat-msg-meta">
              <span class="chat-msg-author" style={`color:${group.avatarBackground}`}>{group.name}</span>
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
