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
  .outgoing-messages {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .outgoing-message {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }

  .outgoing-message__bubble {
    max-width: min(100%, 520px);
    padding: 8px 12px;
    border-radius: 12px;
    background: var(--vr-surface-2);
    opacity: 0.55;
  }

  .is-failed .outgoing-message__bubble {
    opacity: 0.8;
    outline: 1px solid color-mix(in oklch, var(--vr-danger), transparent 40%);
  }

  .outgoing-message__text {
    margin: 0;
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
