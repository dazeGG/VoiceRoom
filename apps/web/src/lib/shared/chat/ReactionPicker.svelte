<script lang="ts">
  import { listReactionEmojis } from '@voice-room/shared/emoji';
  import { SmilePlus } from '@lucide/svelte';
  import { iconSm } from '$lib/shared/ui/icons';
  import { Popover } from '$lib/shared/ui';
  import { tick } from 'svelte';
  import type { ReactionStore } from './reaction-store.svelte';
  import {
    DEFAULT_FREQUENT_REACTIONS,
    loadFrequentReactions,
    recordFrequentReaction
  } from './frequent-reactions';

  const ALL_EMOJI = listReactionEmojis();
  const PERSISTENCE_NAMESPACE = 'chat';

  let {
    store,
    messageId,
    userId,
    disabled = false
  }: {
    store: ReactionStore;
    messageId: string;
    userId: string;
    disabled?: boolean;
  } = $props();

  let open = $state(false);
  let search = $state('');
  let activeIndex = $state(0);
  let frequentEmoji = $state<string[]>([...DEFAULT_FREQUENT_REACTIONS]);
  let grid: HTMLDivElement | null = $state(null);
  let searchInput: HTMLInputElement | null = $state(null);
  const options = $derived.by(() => {
    const query = search.trim();
    if (!query) return ALL_EMOJI;
    return ALL_EMOJI.filter((emoji) => emoji.includes(query)).slice(0, 120);
  });

  $effect(() => {
    const activeUserId = userId;
    let cancelled = false;
    void loadFrequentReactions(PERSISTENCE_NAMESPACE, activeUserId).then((emoji) => {
      if (!cancelled && userId === activeUserId) frequentEmoji = emoji;
    });
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    if (!open) return;
    void tick().then(() => searchInput?.focus());
  });

  async function focusOption(index: number): Promise<void> {
    activeIndex = Math.max(0, Math.min(index, options.length - 1));
    await tick();
    grid?.querySelectorAll<HTMLButtonElement>('button')[activeIndex]?.focus();
  }

  function gridKeydown(event: KeyboardEvent): void {
    const columns = 8;
    let next = activeIndex;
    if (event.key === 'ArrowRight') next += 1;
    else if (event.key === 'ArrowLeft') next -= 1;
    else if (event.key === 'ArrowDown') next += columns;
    else if (event.key === 'ArrowUp') next -= columns;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    else return;
    event.preventDefault();
    void focusOption(next);
  }

  async function react(emoji: string): Promise<void> {
    const wasReacted = store.forMessage(messageId).some((summary) => summary.emoji === emoji && summary.reactedByMe);
    if (!await store.toggle(messageId, emoji)) return;
    if (!wasReacted) {
      frequentEmoji = await recordFrequentReaction(PERSISTENCE_NAMESPACE, userId, emoji);
    }
  }

  async function choose(emoji: string, close: () => void): Promise<void> {
    await react(emoji);
    close();
  }
</script>

{#if !store.isDeleted(messageId)}
  <div class="reaction-quick-actions" role="group" aria-label="Быстрые реакции">
    {#each frequentEmoji as emoji (emoji)}
      <button
        class="reaction-quick-trigger"
        type="button"
        {disabled}
        aria-label={`Добавить быструю реакцию ${emoji}`}
        title={`Реакция ${emoji}`}
        onclick={() => void react(emoji)}
      >{emoji}</button>
    {/each}
    <Popover
      bind:open
      placement="top-start"
      flip
      role="dialog"
      ariaLabel="Выбор реакции"
      onBeforeClose={() => { search = ''; }}
    >
      {#snippet trigger({ toggle, panelId })}
        <button
          class="reaction-picker-trigger"
          type="button"
          {disabled}
          aria-label="Открыть выбор эмодзи"
          title="Добавить другую реакцию"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={panelId}
          onclick={toggle}
        ><SmilePlus {...iconSm} aria-hidden="true" /></button>
      {/snippet}
      {#snippet content({ close })}
        <div class="reaction-picker">
          <label>
            <span class="sr-only">Поиск эмодзи</span>
            <input bind:this={searchInput} bind:value={search} type="search" placeholder="Найти эмодзи" oninput={() => (activeIndex = 0)} />
          </label>
          <div class="emoji-grid" role="grid" tabindex="-1" aria-label="Доступные реакции" bind:this={grid} onkeydown={gridKeydown}>
            {#each options as emoji, index (emoji)}
              <button
                type="button"
                role="gridcell"
                tabindex={index === activeIndex ? 0 : -1}
                aria-label={`Реакция ${emoji}`}
                onclick={() => void choose(emoji, close)}
                onfocus={() => (activeIndex = index)}
              >{emoji}</button>
            {/each}
          </div>
          {#if options.length === 0}<p>Ничего не найдено</p>{/if}
        </div>
      {/snippet}
    </Popover>
  </div>
{/if}

<style>
  .reaction-quick-actions { display: flex; align-items: stretch; overflow: visible; border-radius: 6px 0 0 6px; background: var(--warm-800); }
  .reaction-quick-trigger, .reaction-picker-trigger { width: 32px; height: 32px; border: 0; border-right: 1px solid rgba(255, 255, 255, .08); border-radius: 0; padding: 0; background: var(--warm-800); color: inherit; cursor: pointer; }
  .reaction-quick-trigger { font-size: .95rem; }
  .reaction-picker-trigger { color: color-mix(in oklch, currentColor, transparent 42%); }
  .reaction-quick-trigger:hover, .reaction-quick-trigger:focus-visible,
  .reaction-picker-trigger:hover, .reaction-picker-trigger:focus-visible { background: color-mix(in oklch, var(--paper), var(--ink) 10%); color: inherit; outline: none; }
  .reaction-picker { display: grid; gap: 6px; width: min(300px, calc(100vw - 28px)); padding: 2px; }
  input { width: 100%; min-height: 40px; border: 1px solid color-mix(in oklch, currentColor, transparent 80%); border-radius: 9px; padding: 7px 10px; background: transparent; color: inherit; }
  .emoji-grid { display: grid; grid-template-columns: repeat(7, 1fr); max-height: min(132px, calc(100vh - 226px)); overflow-y: auto; }
  .emoji-grid button { display: grid; place-items: center; min-width: 40px; min-height: 40px; border: 0; border-radius: 7px; background: transparent; font-size: 1.15rem; cursor: pointer; }
  .emoji-grid button:hover, .emoji-grid button:focus-visible { background: color-mix(in oklch, var(--paper), var(--ink) 12%); }
  p { margin: 8px; text-align: center; opacity: .7; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
