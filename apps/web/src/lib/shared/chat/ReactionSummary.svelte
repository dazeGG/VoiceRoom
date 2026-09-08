<script lang="ts">
  import { Popover } from '$lib/shared/ui';
  import ReactorList from './ReactorList.svelte';
  import Emoji from './Emoji.svelte';
  import type { ReactionStore } from './reaction-store.svelte';

  let {
    store,
    messageId,
    canMutate = true
  }: {
    store: ReactionStore;
    messageId: string;
    canMutate?: boolean;
  } = $props();

  const summaries = $derived(store.forMessage(messageId));
</script>

{#if summaries.length > 0 && !store.isDeleted(messageId)}
  <div class="reaction-summary" aria-label="Реакции на сообщение">
    {#each summaries as summary (summary.emoji)}
      <div class="reaction-chip" class:reacted={summary.reactedByMe} class:pending={summary.pending}>
        {#if canMutate}
          <button
            class="reaction-toggle"
            type="button"
            disabled={summary.pending}
            aria-pressed={summary.reactedByMe}
            aria-label={`${summary.reactedByMe ? 'Убрать' : 'Добавить'} реакцию ${summary.emoji}`}
            onclick={() => void store.toggle(messageId, summary.emoji)}
          ><Emoji emoji={summary.emoji} size={18} decorative /></button>
        {:else}
          <span class="reaction-toggle" aria-hidden="true"><Emoji emoji={summary.emoji} size={18} decorative /></span>
        {/if}
        <Popover
          placement="top-start"
          flip
          role="dialog"
          ariaLabel={`Пользователи с реакцией ${summary.emoji}`}
        >
          {#snippet trigger({ open, toggle, panelId })}
            <button
              class="reaction-count"
              type="button"
              aria-label={`Показать пользователей: ${summary.count}`}
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-controls={panelId}
              onclick={toggle}
            >{summary.count}</button>
          {/snippet}
          {#snippet content({ close })}
            <ReactorList {store} {messageId} emoji={summary.emoji} onclose={() => close()} />
          {/snippet}
        </Popover>
        {#if summary.error}<span class="sr-only" role="alert">{summary.error}</span>{/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .reaction-summary { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 3px; }
  .reaction-chip { display: inline-flex; align-items: center; height: 26px; overflow: visible; border: 1px solid color-mix(in oklch, currentColor, transparent 82%); border-radius: 8px; background: color-mix(in oklch, currentColor, transparent 94%); }
  .reaction-chip.reacted { border-color: var(--green); background: color-mix(in oklch, var(--green), transparent 88%); }
  .reaction-chip.pending { opacity: .65; }
  button { min-width: 0; height: 24px; border: 0; background: transparent; color: inherit; line-height: 1; cursor: pointer; }
  button:disabled { cursor: default; }
  .reaction-toggle { display: grid; place-items: center; padding: 1px 3px 1px 7px; font-size: .9rem; }
  .reaction-count { min-width: 20px; padding: 1px 7px 1px 2px; font-family: var(--font-mono); font-size: 11px; font-variant-numeric: tabular-nums; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
