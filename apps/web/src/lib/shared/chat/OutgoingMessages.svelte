<script lang="ts" generics="Payload">
  // The messages of an outbox at the foot of a chat: dimmed while on their
  // way, and with their error and a way to send again or drop when they fail.
  import type { Outgoing } from './outbox.svelte';

  let {
    items,
    textOf,
    attachmentsOf = () => 0,
    onRetry,
    onDiscard
  }: {
    items: Outgoing<Payload>[];
    textOf: (payload: Payload) => string;
    attachmentsOf?: (payload: Payload) => number;
    onRetry: (localId: string) => void;
    onDiscard: (localId: string) => void;
  } = $props();
</script>

{#if items.length}
  <ol class="outgoing-messages" aria-label="Неотправленные сообщения">
    {#each items as item (item.localId)}
      {@const attachments = attachmentsOf(item.payload)}
      <li class="outgoing-message" class:is-failed={item.state === 'failed'} data-outgoing-id={item.localId}>
        <div class="outgoing-message__bubble">
          {#if textOf(item.payload)}<p class="outgoing-message__text">{textOf(item.payload)}</p>{/if}
          {#if attachments}<p class="outgoing-message__meta">Изображений: {attachments}</p>{/if}
        </div>
        {#if item.state === 'failed'}
          <div class="outgoing-message__status" role="alert">
            <span>Не отправлено: {item.error}</span>
            <button type="button" onclick={() => onRetry(item.localId)}>Повторить</button>
            <button type="button" onclick={() => onDiscard(item.localId)}>Удалить</button>
          </div>
        {:else}
          <div class="outgoing-message__status" role="status">Отправляется…</div>
        {/if}
      </li>
    {/each}
  </ol>
{/if}

<style>
  /* Lined up with the text of the messages above: the chat's 32px avatar
     column and its 10px gap (.chat-msg in chat-rail.css). */
  .outgoing-messages {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 0 0 0 42px;
    list-style: none;
  }

  .outgoing-message {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
  }

  .outgoing-message__bubble {
    max-width: 100%;
    opacity: 0.5;
  }

  .is-failed .outgoing-message__bubble {
    opacity: 0.85;
  }

  /* Set like a sent message's text (.chat-msg-text). */
  .outgoing-message__text {
    margin: 0;
    color: var(--vr-text);
    font-size: 14px;
    line-height: 1.45;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .outgoing-message__meta {
    margin: 4px 0 0;
    color: var(--vr-text-3);
    font-size: 12.5px;
  }

  .outgoing-message__status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
    color: var(--vr-text-3);
    font-size: 12px;
  }

  .is-failed .outgoing-message__status {
    color: var(--vr-danger);
  }

  .outgoing-message__status button {
    padding: 2px 8px;
    border: 1px solid currentColor;
    border-radius: 6px;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
</style>
