<script lang="ts">

  import type { AuthUser } from '$lib/api/auth';
  import { fetchRoomChat, postRoomChat, type ChatMessage } from '$lib/api/rooms';
  import { getAvatarColor } from '$lib/visual/tokens';
  import { friendName, initial } from '../../model/lobby-format';

  let { roomId, user, onClose } = $props<{ roomId: string; user: AuthUser; onClose?: () => void }>();

  let draft = $state('');
  let messages = $state<ChatMessage[]>([]);
  let loading = $state(true);
  let sending = $state(false);
  let error = $state('');
  let chatBody: HTMLDivElement | null = null;

  interface ChatGroup {
    key: string;
    name: string;
    peerId: string;
    self: boolean;
    avatarBackground: string;
    avatarForeground: string;
    avatarShadow: string;
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
      const avatar = getAvatarColor(message.avatarColorKey);
      result.push({
        key: message.id,
        name: author,
        peerId: message.peerId,
        self: message.peerId === accountPeerId,
        avatarBackground: avatar.background,
        avatarForeground: avatar.foreground,
        avatarShadow: avatar.shadow,
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

    const text = draft.replace(/\s+/g, ' ').trim();
    if (!text) return;

    sending = true;
    error = '';
    try {
      const message = await postRoomChat(roomId, { name: displayName, text });
      draft = '';
      if (!messageIds.has(message.id) && !messages.some((item) => item.id === message.id)) {
        messageIds.add(message.id);
        messages = [...messages, message];
        queueMicrotask(scrollToBottom);
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Не удалось отправить сообщение';
    } finally {
      sending = false;
    }
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
    const stream = new EventSource(`/api/rooms/${encodeURIComponent(activeRoomId)}/chat/stream`);

    stream.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as { message?: ChatMessage };
        const message = payload?.message;
        if (!message?.id || message.roomId !== activeRoomId) return;
        if (messageIds.has(message.id) || messages.some((item) => item.id === message.id)) return;
        messageIds.add(message.id);
        error = '';
        messages = [...messages, message];
        queueMicrotask(scrollToBottom);
      } catch {
        // Ignore malformed chat frames.
      }
    });

    stream.addEventListener('error', () => {
      if (!error) error = 'Чат временно недоступен';
    });

    return () => {
      controller.abort();
      stream.close();
    };
  });
</script>

<aside class="lobby-preview-chat" aria-label="Чат комнаты">
  <header class="chat-rail-head">
    <div class="chat-rail-title">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
      <span>Чат комнаты</span>
    </div>
    <button class="chat-rail-collapse" type="button" aria-label="Свернуть чат" onclick={onClose}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
    </button>
  </header>

  <div class="chat-rail-body" bind:this={chatBody}>
    {#if loading}
      <p class="chat-rail-note">Загружаем сообщения…</p>
    {:else if groups.length}
      {#each groups as group (group.key)}
        <div class="chat-msg" data-self={group.self}>
          <span class="chat-msg-avatar" style={`background:${group.avatarBackground};color:${group.avatarForeground};box-shadow:${group.avatarShadow}`} aria-hidden="true">
            {initial(group.name)}
          </span>
          <div class="chat-msg-main">
            <div class="chat-msg-meta">
              <span class="chat-msg-author" style={`color:${group.avatarBackground}`}>{group.name}</span>
              <time class="chat-msg-time" datetime={new Date(group.messages[0].createdAt).toISOString()}>{group.time}</time>
            </div>
            {#each group.messages as message (message.id)}
              <p class="chat-msg-text">{message.text}</p>
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
    <input
      class="chat-rail-input"
      bind:value={draft}
      maxlength="500"
      placeholder="Написать в комнату…"
      autocomplete="off"
    />
    <button class="chat-rail-send" type="submit" aria-label="Отправить" disabled={sending || !draft.trim()}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
    </button>
  </form>
</aside>