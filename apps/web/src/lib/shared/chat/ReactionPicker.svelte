<script lang="ts">
  import { listReactionEmojiGroups } from '@voice-room/shared/emoji-groups';
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

  const GROUPS = listReactionEmojiGroups();
  const COLUMNS = 7;
  const PERSISTENCE_NAMESPACE = 'chat';
  // The corpus is ~3900 entries. Rendering all of them at once stalls the
  // popover, so search is capped and the browse view shows one category.
  const SEARCH_LIMIT = 120;

  let {
    store,
    messageId,
    userId,
    disabled = false,
    showQuickReactions = true,
    open = $bindable(false)
  }: {
    store: ReactionStore;
    messageId: string;
    userId: string;
    disabled?: boolean;
    /** Off inside the hover toolbar, which has no room for three more buttons. */
    showQuickReactions?: boolean;
    /** Bindable so a host toolbar can stay visible while the panel is open. */
    open?: boolean;
  } = $props();

  let search = $state('');
  let activeGroupKey = $state('frequent');
  let activeIndex = $state(0);
  let previewEmoji = $state('');
  let frequentEmoji = $state<string[]>([...DEFAULT_FREQUENT_REACTIONS]);
  let grid: HTMLDivElement | null = $state(null);
  let searchInput: HTMLInputElement | null = $state(null);

  const searching = $derived(search.trim().length > 0);

  const sections = $derived.by(() => {
    const query = search.trim();
    if (query) {
      const matches: string[] = [];
      for (const group of GROUPS) {
        for (const emoji of group.emojis) {
          if (!emoji.includes(query)) continue;
          matches.push(emoji);
          if (matches.length >= SEARCH_LIMIT) break;
        }
        if (matches.length >= SEARCH_LIMIT) break;
      }
      return [{ key: 'search', label: 'Результаты', emojis: matches }];
    }

    // The default view pairs your own history with the first category, so the
    // popover is useful before you have picked a category.
    if (activeGroupKey === 'frequent') {
      const group = GROUPS[0];
      return [
        { key: 'frequent', label: 'Часто используемые', emojis: frequentEmoji },
        { key: group.key, label: group.label, emojis: [...group.emojis] }
      ];
    }

    const group = GROUPS.find((entry) => entry.key === activeGroupKey) ?? GROUPS[0];
    return [{ key: group.key, label: group.label, emojis: [...group.emojis] }];
  });

  const flatOptions = $derived(
    sections.flatMap((section) =>
      section.emojis.map((emoji, index) => ({ emoji, key: `${section.key}:${index}:${emoji}` }))
    )
  );
  const activeTabId = $derived(`reaction-category-${activeGroupKey}`);

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
    activeIndex = Math.max(0, Math.min(index, flatOptions.length - 1));
    previewEmoji = flatOptions[activeIndex]?.emoji || '';
    await tick();
    grid?.querySelectorAll<HTMLButtonElement>('[role="gridcell"]')[activeIndex]?.focus();
  }

  function gridKeydown(event: KeyboardEvent): void {
    let next = activeIndex;
    if (event.key === 'ArrowRight') next += 1;
    else if (event.key === 'ArrowLeft') next -= 1;
    else if (event.key === 'ArrowDown') next += COLUMNS;
    else if (event.key === 'ArrowUp') next -= COLUMNS;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = flatOptions.length - 1;
    else return;
    event.preventDefault();
    // A context menu may be hosting this picker; it must not also move its own
    // selection on the same key.
    event.stopPropagation();
    void focusOption(next);
  }

  function selectGroup(key: string): void {
    activeGroupKey = key;
    search = '';
    activeIndex = 0;
  }

  function categoryKeydown(event: KeyboardEvent): void {
    const tabs = Array.from(
      (event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="tab"]')
    );
    const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    let next = current;
    if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    event.stopPropagation();
    tabs[next]?.focus();
    tabs[next]?.click();
  }

  async function react(emoji: string): Promise<void> {
    const wasReacted = store
      .forMessage(messageId)
      .some((summary) => summary.emoji === emoji && summary.reactedByMe);
    if (!(await store.toggle(messageId, emoji))) return;
    if (!wasReacted) {
      frequentEmoji = await recordFrequentReaction(PERSISTENCE_NAMESPACE, userId, emoji);
    }
  }

  async function choose(emoji: string, close: () => void): Promise<void> {
    await react(emoji);
    close();
  }

  function resetOnClose(): void {
    search = '';
    activeGroupKey = 'frequent';
    activeIndex = 0;
    previewEmoji = '';
  }
</script>

{#if !store.isDeleted(messageId)}
  <div class="reaction-quick-actions" role="group" aria-label="Быстрые реакции">
    {#if showQuickReactions}{#each frequentEmoji as emoji (emoji)}
      <button
        class="reaction-quick-trigger"
        type="button"
        {disabled}
        aria-label={`Добавить быструю реакцию ${emoji}`}
        title={`Реакция ${emoji}`}
        onclick={() => void react(emoji)}
      >{emoji}</button>
    {/each}{/if}
    <Popover
      bind:open
      placement="top-start"
      flip
      floating
      role="dialog"
      ariaLabel="Выбор реакции"
      panelClass="reaction-picker-panel"
      onBeforeClose={resetOnClose}
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
          <div class="reaction-picker-head">
            <label class="reaction-picker-search">
              <span class="sr-only">Поиск реакции</span>
              <input
                bind:this={searchInput}
                bind:value={search}
                type="search"
                placeholder="Поиск реакции"
                oninput={() => (activeIndex = 0)}
              />
            </label>

            <div
              class="reaction-picker-tabs"
              role="tablist"
              tabindex="-1"
              aria-label="Категории реакций"
              onkeydown={categoryKeydown}
            >
              <button
                id="reaction-category-frequent"
                class="reaction-picker-tab"
                class:is-active={!searching && activeGroupKey === 'frequent'}
                type="button"
                role="tab"
                aria-selected={activeGroupKey === 'frequent'}
                aria-label="Часто используемые"
                aria-controls="reaction-picker-category-panel"
                tabindex={activeGroupKey === 'frequent' ? 0 : -1}
                title="Часто используемые"
                onclick={() => selectGroup('frequent')}
              >🕘</button>
              {#each GROUPS as group (group.key)}
                <button
                  id={`reaction-category-${group.key}`}
                  class="reaction-picker-tab"
                  class:is-active={!searching && activeGroupKey === group.key}
                  type="button"
                  role="tab"
                  aria-selected={activeGroupKey === group.key}
                  aria-label={group.label}
                  aria-controls="reaction-picker-category-panel"
                  tabindex={activeGroupKey === group.key ? 0 : -1}
                  title={group.label}
                  onclick={() => selectGroup(group.key)}
                >{group.icon}</button>
              {/each}
            </div>
          </div>

          <div id="reaction-picker-category-panel" role="tabpanel" aria-labelledby={activeTabId}>
            <div
              class="reaction-picker-body"
              role="grid"
              tabindex="-1"
              aria-label="Доступные реакции"
              bind:this={grid}
              onkeydown={gridKeydown}
            >
            {#each sections as section (section.key)}
              {#if section.emojis.length > 0}
                <span class="reaction-picker-section">{section.label}</span>
                <div class="reaction-picker-grid">
                  {#each section.emojis as emoji, index (`${section.key}:${index}:${emoji}`)}
                    {@const optionKey = `${section.key}:${index}:${emoji}`}
                    {@const flatIndex = flatOptions.findIndex((option) => option.key === optionKey)}
                    <button
                      type="button"
                      role="gridcell"
                      tabindex={flatIndex === activeIndex ? 0 : -1}
                      aria-label={`Реакция ${emoji}`}
                      onclick={() => void choose(emoji, close)}
                      onfocus={() => {
                        activeIndex = flatIndex >= 0 ? flatIndex : index;
                        previewEmoji = emoji;
                      }}
                      onpointerenter={() => (previewEmoji = emoji)}
                    >{emoji}</button>
                  {/each}
                </div>
              {/if}
            {/each}

            {#if flatOptions.length === 0}
              <p class="reaction-picker-empty">Ничего не найдено</p>
            {/if}
            </div>
          </div>

          <div class="reaction-picker-foot" aria-hidden="true">
            {#if previewEmoji}
              <span class="reaction-picker-preview">{previewEmoji}</span>
            {:else}
              <span class="reaction-picker-hint">Выберите реакцию</span>
            {/if}
          </div>
        </div>
      {/snippet}
    </Popover>
  </div>
{/if}

<style>
  /* Sits inside the hover pill, so these carry the same 36px round-square shape
     as the sibling action buttons. */
  .reaction-quick-actions { display: flex; align-items: center; gap: 4px; overflow: visible; }
  .reaction-quick-trigger, .reaction-picker-trigger { display: grid; width: 36px; height: 36px; place-items: center; border: 0; border-radius: 12px; padding: 0; background: transparent; color: inherit; cursor: pointer; transition: background 120ms ease, color 120ms ease; }
  .reaction-quick-trigger { font-size: 18px; line-height: 1; }
  .reaction-picker-trigger { color: color-mix(in oklch, currentColor, transparent 42%); }
  .reaction-quick-trigger:hover, .reaction-quick-trigger:focus-visible,
  .reaction-picker-trigger:hover, .reaction-picker-trigger:focus-visible { background: color-mix(in oklch, var(--accent), transparent 86%); color: var(--accent); outline: none; }

  /* The picker draws its own header and footer to the panel edges. */
  :global(.reaction-picker-panel) { padding: 0; overflow: hidden; }

  .reaction-picker {
    display: flex;
    width: min(392px, calc(100vw - 28px));
    max-height: var(--popover-available-height, calc(100dvh - 16px));
    flex-direction: column;
  }

  .reaction-picker-head { display: flex; flex: none; flex-direction: column; gap: 12px; padding: 14px 14px 10px; }

  .reaction-picker-search input {
    width: 100%;
    height: 44px;
    box-sizing: border-box;
    padding: 0 14px;
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 15px;
    background: color-mix(in oklch, var(--control), transparent 45%);
    color: var(--warm-ink);
    font-family: var(--font-ui);
    font-size: 14.5px;
  }

  .reaction-picker-search input::placeholder { color: var(--warm-muted-dim); }
  .reaction-picker-search input:focus { border-color: color-mix(in oklch, var(--accent), transparent 40%); outline: none; }

  .reaction-picker-tabs { display: flex; flex-wrap: wrap; gap: 6px; }

  .reaction-picker-tab {
    display: grid;
    width: 40px;
    height: 40px;
    place-items: center;
    border: 0;
    border-radius: 13px;
    background: color-mix(in oklch, var(--control), transparent 55%);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    transition: background 120ms ease;
  }

  .reaction-picker-tab:hover,
  .reaction-picker-tab.is-active { background: color-mix(in oklch, var(--accent), transparent 86%); }

  .reaction-picker-body {
    display: flex;
    max-height: min(300px, 46vh);
    min-height: 0;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 10px;
    padding: 2px 14px 14px;
    overflow-y: auto;
  }

  .reaction-picker-body:focus { outline: none; }

  .reaction-picker-section {
    color: var(--warm-faint);
    font-family: var(--font-mono);
    font-size: 10.5px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .reaction-picker-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }

  .reaction-picker-grid button {
    display: grid;
    height: 44px;
    place-items: center;
    border: 0;
    border-radius: 13px;
    background: transparent;
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
  }

  .reaction-picker-grid button:hover,
  .reaction-picker-grid button:focus-visible {
    background: color-mix(in oklch, var(--accent), transparent 86%);
    outline: none;
  }

  .reaction-picker-empty { margin: 8px 0; color: var(--warm-faint); font-size: 13px; text-align: center; }

  .reaction-picker-foot {
    display: flex;
    flex: none;
    align-items: center;
    gap: 11px;
    min-height: 48px;
    padding: 12px 16px;
    border-top: 1px solid rgba(255, 255, 255, 0.09);
    background: color-mix(in oklch, var(--control), transparent 82%);
  }

  .reaction-picker-preview { font-size: 22px; line-height: 1; }
  .reaction-picker-hint { color: var(--warm-muted-dim); font-family: var(--font-mono); font-size: 12.5px; }

  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
