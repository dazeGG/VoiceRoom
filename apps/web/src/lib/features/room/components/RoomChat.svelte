<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchRoomChat, postRoomChat, type ChatMessage } from '$lib/api/rooms';
  import { cleanDisplayName } from '$lib/shared/utils/text';
  import { getRoomIdFromPath, getStoredPeerSession } from '../client/core/session';

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
        const payload = JSON.parse((event as MessageEvent).data) as { message?: ChatMessage; type?: string };
        if (payload?.type === 'room-not-found') {
          error = 'Комната не найдена';
          return;
        }
        const message = payload?.message;
        if (!message?.id || message.roomId !== roomId) return;
        if (messages.some((item) => item.id === message.id)) return;
        error = '';
        messages = [...messages, message];
        queueMicrotask(scrollToBottom);
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
      const message = await postRoomChat(roomId, {
        name: displayName,
        peerId,
        sessionToken,
        text
      });
      draft = '';
      if (!messages.some((item) => item.id === message.id)) {
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
</script>

<aside class="room-chat" aria-label="Чат комнаты">
  <header class="room-chat-head">
    <div>
      <p class="room-chat-kicker">чат комнаты</p>
      <h2>Сообщения</h2>
    </div>
    <button class="room-chat-refresh" type="button" onclick={() => refreshMessages()}>Обновить</button>
  </header>

  <div class="room-chat-body" bind:this={chatBody}>
    {#if loading}
      <p class="room-chat-empty">Загружаем сообщения…</p>
    {:else if messages.length}
      <div class="room-chat-list">
        {#each messages as message}
          <article class="room-chat-message" data-self={message.peerId === peerId}>
            <div class="room-chat-message-head">
              <strong>{message.name || 'Гость'}</strong>
              <time datetime={new Date(message.createdAt).toISOString()}>
                {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </time>
            </div>
            <p>{message.text}</p>
          </article>
        {/each}
      </div>
    {:else}
      <p class="room-chat-empty">Пока пусто. Напишите первое сообщение.</p>
    {/if}
  </div>

  {#if error}
    <p class="room-chat-error">{error}</p>
  {/if}

  <form class="room-chat-compose" onsubmit={sendMessage}>
    <textarea
      bind:value={draft}
      maxlength="500"
      rows="2"
      placeholder="Написать сообщение…"
    ></textarea>
    <button type="submit" disabled={sending || !draft.trim()}>
      {sending ? 'Отправляем…' : 'Отправить'}
    </button>
  </form>
</aside>

<style>
  .room-chat {
    position: fixed;
    right: 16px;
    bottom: 112px;
    z-index: 32;
    display: flex;
    flex-direction: column;
    width: min(390px, calc(100vw - 32px));
    max-height: min(62dvh, 620px);
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 18px;
    background:
      linear-gradient(180deg, rgba(21, 20, 15, 0.98), rgba(14, 13, 10, 0.98)),
      #0e0d0a;
    box-shadow: 0 22px 44px rgba(0, 0, 0, 0.28);
    overflow: hidden;
    backdrop-filter: blur(10px);
  }

  .room-chat-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 15px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  }

  .room-chat-kicker {
    margin: 0 0 4px;
    color: #8e897b;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .room-chat-head h2 {
    margin: 0;
    color: #ece7d9;
    font-size: 15px;
    font-weight: 700;
  }

  .room-chat-refresh {
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 999px;
    padding: 7px 10px;
    background: rgba(255, 255, 255, 0.04);
    color: #ece7d9;
    font-size: 12px;
    cursor: pointer;
  }

  .room-chat-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 14px 15px;
  }

  .room-chat-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .room-chat-message {
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 14px;
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.03);
  }

  .room-chat-message[data-self='true'] {
    border-color: rgba(126, 201, 154, 0.18);
    background: rgba(126, 201, 154, 0.08);
  }

  .room-chat-message-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
    color: #a9a392;
    font-size: 11px;
  }

  .room-chat-message-head strong {
    color: #ece7d9;
    font-size: 12.5px;
  }

  .room-chat-message p {
    margin: 0;
    color: #ece7d9;
    font-size: 13px;
    line-height: 1.45;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .room-chat-empty,
  .room-chat-error {
    margin: 0;
    padding: 14px 15px;
    color: #8e897b;
    font-size: 12.5px;
    line-height: 1.45;
  }

  .room-chat-error {
    padding-top: 0;
    color: #d2a08c;
  }

  .room-chat-compose {
    display: grid;
    gap: 10px;
    padding: 14px 15px 15px;
    border-top: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(255, 255, 255, 0.02);
  }

  .room-chat-compose textarea {
    resize: vertical;
    min-height: 64px;
    max-height: 180px;
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 12px;
    padding: 11px 12px;
    background: #0c0b08;
    color: #ece7d9;
    font: inherit;
    outline: none;
  }

  .room-chat-compose textarea:focus {
    border-color: rgba(154, 143, 106, 0.65);
  }

  .room-chat-compose button {
    border: none;
    border-radius: 12px;
    padding: 11px 14px;
    background: #d9d3c3;
    color: #17150f;
    font-weight: 700;
    cursor: pointer;
  }

  .room-chat-compose button:disabled {
    cursor: default;
    opacity: 0.72;
  }

  @media (max-width: 900px) {
    .room-chat {
      right: 12px;
      left: 12px;
      width: auto;
      bottom: 96px;
      max-height: 38dvh;
    }
  }

  @media (max-width: 560px) {
    .room-chat {
      bottom: 86px;
      max-height: 34dvh;
    }
  }
</style>
