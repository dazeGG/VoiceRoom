<script lang="ts">
  import { listReactionEmojis } from '@voice-room/shared/emoji';
  import { Popover } from '$lib/shared/ui';
  import { tick } from 'svelte';
  import type { ReactionStore } from './reaction-store.svelte';

  const ALL_EMOJI = listReactionEmojis();
  const COMMON = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🎉', '🔥'];

  let {
    store,
    messageId,
    disabled = false
  }: {
    store: ReactionStore;
    messageId: string;
    disabled?: boolean;
  } = $props();

  let open = $state(false);
  let search = $state('');
  let activeIndex = $state(0);
  let grid: HTMLDivElement | null = $state(null);
  const options = $derived.by(() => {
    const query = search.trim();
    if (!query) return COMMON;
    return ALL_EMOJI.filter((emoji) => emoji.includes(query)).slice(0, 120);
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

  async function choose(emoji: string, close: () => void): Promise<void> {
    await store.toggle(messageId, emoji);
    close();
  }
</script>

{#if !store.isDeleted(messageId)}
  <Popover
    bind:open
    placement="top-start"
    role="dialog"
    ariaLabel="Выбор реакции"
    onBeforeClose={() => { search = ''; }}
  >
    {#snippet trigger({ toggle, panelId })}
      <button
        class="reaction-picker-trigger"
        type="button"
        {disabled}
        aria-label="Добавить реакцию"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onclick={toggle}
      >☺</button>
    {/snippet}
    {#snippet content({ close })}
      <div class="reaction-picker">
        <label>
          <span class="sr-only">Поиск эмодзи</span>
          <input bind:value={search} type="search" placeholder="Найти эмодзи" oninput={() => (activeIndex = 0)} />
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
{/if}

<style>
  .reaction-picker-trigger { min-width: 40px; min-height: 40px; border: 0; border-radius: 10px; background: transparent; color: inherit; font-size: 1.2rem; cursor: pointer; }
  .reaction-picker-trigger:hover, .reaction-picker-trigger:focus-visible { background: color-mix(in oklch, var(--paper), var(--ink) 10%); }
  .reaction-picker { display: grid; gap: 7px; width: min(330px, 82vw); padding: 3px; }
  input { width: 100%; min-height: 40px; border: 1px solid color-mix(in oklch, currentColor, transparent 80%); border-radius: 9px; padding: 7px 10px; background: transparent; color: inherit; }
  .emoji-grid { display: grid; grid-template-columns: repeat(8, 1fr); max-height: 240px; overflow-y: auto; }
  .emoji-grid button { display: grid; place-items: center; min-width: 36px; min-height: 36px; border: 0; border-radius: 7px; background: transparent; font-size: 1.15rem; cursor: pointer; }
  .emoji-grid button:hover, .emoji-grid button:focus-visible { background: color-mix(in oklch, var(--paper), var(--ink) 12%); }
  p { margin: 8px; text-align: center; opacity: .7; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
