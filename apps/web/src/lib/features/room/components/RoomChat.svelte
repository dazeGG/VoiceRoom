<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchRoomChat, postRoomChat, type ChatMessage } from '$lib/api/rooms';
  import { cleanDisplayName } from '$lib/shared/utils/text';
  import { getAvatarColor } from '$lib/visual/tokens';
  import { getRoomIdFromPath, getStoredPeerSession } from '../client/core/session';
  import { getInitials } from '../client/core/utils';
  import type { RoomLifecycleSummary } from '../client/core/types';
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
  let error = $state('');
  let chatBody: HTMLDivElement | null = null;

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
    time: string;
    messages: ChatMessage[];
  }

  const groups = $derived(buildGroups(messages));
  const messageIds = new Set<string>();

  // Reflect chat state onto <body> so the room layout + dock can react in CSS.
  $effect(() => {
    document.body.dataset.chatOpen = roomUi.chatOpen ? 'true' : 'false';
    if (roomUi.chatOpen) {
      markChatRead();
      queueMicrotask(scrollToBottom);
    }
    return () => {
      delete document.body.dataset.chatOpen;
    };
  });

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
        self: message.peerId === peerId,
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

  onMount(() => {
    roomId = getRoomIdFromPath();
    if (!roomId) {
      loading = false;
      error = 'Комната не найдена';
      return;
    }

    const session = getStoredPeerSession(roomId);
    peerId = session.peerId;
    sessionToken = session.sessionToken;
    displayName = cleanDisplayName(localStorage.getItem('voice-room:name')) || 'Гость';

    const controller = new AbortController();
    void refreshMessages(controller.signal);
    const stream = new EventSource(`/api/rooms/${encodeURIComponent(roomId)}/chat/stream`);

    stream.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as {
          message?: ChatMessage;
          room?: RoomLifecycleSummary;
          roomId?: string;
          type?: string;
        };
        if (payload?.type === 'room-not-found') {
          if (payload.roomId) applyRoomNotFound(payload.roomId);
          error = 'Комната не найдена';
          stream.close();
          return;
        }
        if (payload?.type === 'room-updated' && payload.room) {
          applyRoomUpdated(payload.room);
          return;
        }
        if (payload?.type === 'room-deleted' && payload.roomId) {
          applyRoomDeleted(payload.roomId);
          stream.close();
          return;
        }
        const message = payload?.message;
        if (!message?.id || message.roomId !== roomId) return;
        if (messageIds.has(message.id) || messages.some((item) => item.id === message.id)) return;
        messageIds.add(message.id);
        error = '';
        messages = [...messages, message];
        if (roomUi.chatOpen) {
          markChatRead();
          queueMicrotask(scrollToBottom);
        } else {
          incrementUnreadChat();
        }
      } catch {
        // Ignore malformed chat frames.
      }
    });

    stream.addEventListener('error', () => {
      if (!error) {
        error = 'Чат временно недоступен';
      }
    });

    return () => {
      controller.abort();
      stream.close();
    };
  });

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

    const text = draft.replace(/\s+/g, ' ').trim();
    if (!text) return;

    sending = true;
    error = '';
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
      draft = '';
      if (!messageIds.has(message.id) && !messages.some((item) => item.id === message.id)) {
        messageIds.add(message.id);
        messages = [...messages, message];
        if (roomUi.chatOpen) {
          markChatRead();
          queueMicrotask(scrollToBottom);
        }
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

  // Open the participant context menu from a chat author (avatar or name). Only
  // works for others who are still in the room; self and absent peers are inert.
  function openUserMenu(group: ChatGroup, event: MouseEvent): void {
    if (group.self) return;
    event.stopPropagation();
    openParticipantContextMenu(group.peerId, event.clientX, event.clientY);
  }
</script>

<aside class="room-chat-rail" aria-label="Чат комнаты" data-open={roomUi.chatOpen} hidden={!roomUi.chatOpen}>
  <header class="chat-rail-head">
    <div class="chat-rail-title">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
      <span>Чат комнаты</span>
    </div>
    <button class="chat-rail-collapse" type="button" aria-label="Свернуть чат" onclick={closeChat}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>
    </button>
  </header>

  <div class="chat-rail-body" bind:this={chatBody}>
    {#if loading}
      <p class="chat-rail-note">Загружаем сообщения…</p>
    {:else if groups.length}
      {#each groups as group (group.key)}
        <div class="chat-msg" data-self={group.self}>
          {#if group.self}
            <span class="chat-msg-avatar" style={`background:${group.avatarBackground};color:${group.avatarForeground};box-shadow:${group.avatarShadow}`} aria-hidden="true">
              {getInitials(group.name)}
            </span>
          {:else}
            <button
              class="chat-msg-avatar chat-msg-trigger"
              type="button"
              style={`background:${group.avatarBackground};color:${group.avatarForeground};box-shadow:${group.avatarShadow}`}
              aria-haspopup="dialog"
              aria-label={`Действия для ${group.name}`}
              title={`Действия для ${group.name}`}
              onclick={(event) => openUserMenu(group, event)}
            >
              {getInitials(group.name)}
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
