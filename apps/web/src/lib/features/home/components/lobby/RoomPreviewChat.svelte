<script lang="ts">
  import { ChevronRight, MessageSquare } from '@lucide/svelte';
  import type { AuthUser } from '$lib/api/auth';
  import { iconSm } from '$lib/shared/ui/icons';
  import { getAppRealtime } from '$lib/api/realtime';
  import { fetchRoomChat, postRoomChat, type ChatMessage } from '$lib/api/rooms';
  import { playRoomChatMessageCue } from '$lib/features/room/client/media/cues';
  import { Avatar } from '$lib/shared/ui';
  import { getAvatarPresentation } from '$lib/features/room/client/ui/avatar-presentation';
  import { friendName } from '../../model/lobby-format';
  import ChatText from '$lib/shared/components/ChatText.svelte';
  import { tick } from 'svelte';

  let { roomId, user, onClose } = $props<{ roomId: string; user: AuthUser; onClose?: () => void }>();

  let draft = $state('');
  let messages = $state<ChatMessage[]>([]);
  let loading = $state(true);
  let sending = $state(false);
  let error = $state('');
  let chatBody: HTMLDivElement | null = null;
  let composeEl: HTMLTextAreaElement | null = null;

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
        isLocal: message.peerId === accountPeerId,
        name: author
      });
      result.push({
        key: message.id,
        name: author,
        peerId: message.peerId,
        self: message.peerId === accountPeerId,
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
      if (event.type === 'room.chat.deleted' && event.payload.roomId === activeRoomId) {
        const messageId = event.payload.messageId;
        if (messageId) {
          messages = messages.filter((message) => message.id !== messageId);
          messageIds.delete(messageId);
        }
        return;
      }
      if (event.type !== 'room.chat.message' || event.payload.roomId !== activeRoomId) return;
      const message = event.payload.message;
      if (!message?.id || messageIds.has(message.id) || messages.some((item) => item.id === message.id)) return;
      messageIds.add(message.id);
      error = '';
      messages = [...messages, message];
      if (message.peerId !== accountPeerId) playRoomChatMessageCue();
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
              <p class="chat-msg-text"><ChatText text={message.text} /></p>
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
