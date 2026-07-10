<script lang="ts">
  import { ChevronRight, MessageSquare, Send } from '@lucide/svelte';
  import { iconSm } from '$lib/shared/ui/icons';
  import { onMount } from 'svelte';
  import { fetchRoomChat, postRoomChat, type ChatMessage } from '$lib/api/rooms';
  import { subscribeRoomPreview } from '$lib/features/home/model/room-realtime';
  import { formatChatDayLabel, isSameDay } from '$lib/shared/utils/chat-date';
  import { cleanDisplayName } from '$lib/shared/utils/text';
  import { getAvatarColor } from '$lib/visual/tokens';
  import { getRoomIdFromPath, getStoredPeerSession } from '../client/core/session';
  import { getInitials } from '../client/core/utils';
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

  // Messages grouped by calendar day so each day renders under its own divider.
  interface ChatDay {
    key: string;
    label: string;
    groups: ChatGroup[];
  }

  const days = $derived(buildDays(messages));
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
      const avatar = getAvatarColor(message.avatarColorKey);
      day.groups.push({
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
      if (event.type !== 'room.chat.message') return;
      const message = event.payload.message;
      if (!message?.id || messageIds.has(message.id) || messages.some((item) => item.id === message.id)) return;
      messageIds.add(message.id);
      error = '';
      messages = [...messages, message];
      if (message.peerId !== peerId) playRoomChatMessageCue();
      if (roomUi.chatOpen) {
        markChatRead();
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

  // Union the server's recent-message window with what's already rendered:
  // keeps locally-appended messages the window may race past and stays
  // idempotent for the duplicate snapshots a resubscribe can produce.
  function mergeMessages(recent: ChatMessage[]): void {
    const known = new Set(messages.map((item) => item.id));
    const incoming = recent.filter((item) => item?.id && !known.has(item.id));
    if (incoming.length === 0) return;
    error = '';
    for (const item of incoming) messageIds.add(item.id);
    messages = [...messages, ...incoming].sort((a, b) => a.createdAt - b.createdAt);
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
        <div class="chat-day-divider" role="separator" aria-label={day.label}>
          <span>{day.label}</span>
        </div>
        {#each day.groups as group (group.key)}
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
      <Send {...iconSm} aria-hidden="true" />
    </button>
  </form>
</aside>
