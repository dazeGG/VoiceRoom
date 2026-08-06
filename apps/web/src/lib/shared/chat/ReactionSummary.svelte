<script lang="ts">
  import { Popover } from '$lib/shared/ui';
  import ReactorList from './ReactorList.svelte';
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

  let openEmoji = $state('');
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
          >{summary.emoji}</button>
        {:else}
          <span class="reaction-toggle" aria-hidden="true">{summary.emoji}</span>
        {/if}
        <Popover
          open={openEmoji === summary.emoji}
          onBeforeClose={() => { openEmoji = ''; }}
          placement="top-start"
          role="dialog"
          ariaLabel={`Пользователи с реакцией ${summary.emoji}`}
        >
          {#snippet trigger({ toggle, panelId })}
            <button
              class="reaction-count"
              type="button"
              aria-label={`Показать пользователей: ${summary.count}`}
              aria-haspopup="dialog"
              aria-expanded={openEmoji === summary.emoji}
              aria-controls={panelId}
              onclick={() => {
                openEmoji = openEmoji === summary.emoji ? '' : summary.emoji;
                toggle();
              }}
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
  .reaction-summary { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 5px; }
  .reaction-chip { display: inline-flex; align-items: stretch; min-height: 34px; overflow: visible; border: 1px solid color-mix(in oklch, currentColor, transparent 82%); border-radius: 999px; background: color-mix(in oklch, currentColor, transparent 94%); }
  .reaction-chip.reacted { border-color: var(--green); background: color-mix(in oklch, var(--green), transparent 88%); }
  .reaction-chip.pending { opacity: .65; }
  button { min-width: 34px; border: 0; background: transparent; color: inherit; cursor: pointer; }
  button:disabled { cursor: default; }
  .reaction-toggle { display: grid; place-items: center; padding: 4px 5px 4px 9px; font-size: 1rem; }
  .reaction-count { padding: 4px 9px 4px 4px; font-variant-numeric: tabular-nums; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
