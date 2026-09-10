<script lang="ts">
  import { onMount } from 'svelte';
  import Emoji from './Emoji.svelte';
  import type { ReactionStore } from './reaction-store.svelte';

  let {
    store,
    messageId,
    emoji,
    onclose
  }: {
    store: ReactionStore;
    messageId: string;
    emoji: string;
    onclose?: () => void;
  } = $props();

  let heading: HTMLHeadingElement | null = $state(null);
  const listState = $derived(store.reactorState(messageId, emoji));

  onMount(() => {
    void store.loadReactors(messageId, emoji);
    queueMicrotask(() => heading?.focus());
  });

</script>

<section class="reactor-list" aria-labelledby="reactor-list-title">
  <header>
    <h3 id="reactor-list-title" tabindex="-1" bind:this={heading}>Реакция <Emoji {emoji} size={18} decorative /></h3>
    <button type="button" aria-label="Закрыть список" onclick={() => onclose?.()}>×</button>
  </header>

  {#if listState.error}
    <p role="alert">{listState.error}</p>
  {/if}

  {#if listState.reactors.length > 0}
    <ul aria-live="polite">
      {#each listState.reactors as reactor (reactor.userId)}
        <li>
          {#if reactor.avatarUrl}
            <img src={reactor.avatarUrl} alt="" width="28" height="28" />
          {:else}
            <span class="avatar" aria-hidden="true">{reactor.displayName.slice(0, 1).toUpperCase()}</span>
          {/if}
          <span>{reactor.displayName}</span>
        </li>
      {/each}
    </ul>
  {:else if !listState.loading && !listState.error}
    <p>Пока никто не отреагировал</p>
  {/if}

  {#if listState.loading}
    <p aria-live="polite">Загрузка…</p>
  {:else if listState.nextCursor}
    <button class="load-more" type="button" onclick={() => void store.loadReactors(messageId, emoji, true)}>
      Показать ещё
    </button>
  {/if}
</section>

<style>
  .reactor-list { width: min(300px, 80vw); max-height: 360px; overflow: auto; padding: 4px; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  h3 { margin: 0; font-size: .95rem; outline: none; }
  header button { min-width: 40px; min-height: 40px; border: 0; background: transparent; color: inherit; font-size: 1.4rem; }
  ul { display: grid; gap: 4px; margin: 8px 0; padding: 0; list-style: none; }
  li { display: flex; align-items: center; gap: 8px; min-height: 40px; }
  img, .avatar { width: 28px; height: 28px; border-radius: 50%; object-fit: cover; }
  .avatar { display: grid; place-items: center; background: color-mix(in oklch, var(--paper), var(--ink) 14%); }
  p { margin: 8px 2px; font-size: .85rem; opacity: .8; }
  .load-more { width: 100%; min-height: 40px; border: 0; border-radius: 9px; color: inherit; background: color-mix(in oklch, var(--paper), var(--ink) 10%); }
</style>
