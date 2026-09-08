<script lang="ts">
  import { SKIN_TONES } from '@voice-room/shared/emoji-skin-tones';
  import { SmilePlus } from '@lucide/svelte';
  import { iconSm } from '$lib/shared/ui/icons';
  import { Popover } from '$lib/shared/ui';
  import { tick } from 'svelte';
  import Emoji from './Emoji.svelte';
  import type { ReactionStore } from './reaction-store.svelte';
  import {
    DEFAULT_FREQUENT_REACTIONS,
    loadFrequentReactions,
    recordFrequentReaction
  } from './frequent-reactions';
  import { NEUTRAL_TONE, loadSkinTone, saveSkinTone } from './skin-tone-preference';
  import {
    BROWSABLE_EMOJIS,
    TONE_SWATCH_BASE,
    hasSkinToneChoices,
    listBrowsableCategories,
    skinToneChoices,
    withSkinTone
  } from './emoji-catalog';

  const CATEGORIES = listBrowsableCategories();
  const COLUMNS = 7;
  const PERSISTENCE_NAMESPACE = 'chat';

  // The browse list is one continuous scroller holding every category, so the
  // category buttons are anchors into it rather than tabs that swap the content
  // out. That costs ~2400 tiles, far past what the DOM wants to hold, so only
  // the visible rows are rendered against a spacer of the full height.
  const TILE = 44;
  const TILE_GAP = 4;
  const ROW_HEIGHT = TILE + TILE_GAP;
  const HEADER_HEIGHT = 28;
  // Two rows of slack: enough that a fast wheel never shows a blank strip,
  // few enough that a jump to a category asks for one screen of artwork.
  const OVERSCAN_ROWS = 2;
  const TONE_HOVER_DELAY_MS = 300;

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
  let activeSectionKey = $state('frequent');
  let activeIndex = $state(0);
  let previewEmoji = $state('');
  let frequentEmoji = $state<string[]>([...DEFAULT_FREQUENT_REACTIONS]);
  let skinTone = $state(NEUTRAL_TONE);
  let toneMenuOpen = $state(false);
  let toneStripFor = $state('');
  let toneStripLeft = $state(0);
  let toneStripTop = $state(0);
  let strip: HTMLDivElement | null = $state(null);
  let scroller: HTMLDivElement | null = $state(null);
  let searchInput: HTMLInputElement | null = $state(null);
  let scrollTop = $state(0);
  let viewportHeight = $state(300);
  let toneHoverTimer = 0;
  let picker: HTMLDivElement | null = $state(null);

  const searching = $derived(search.trim().length > 0);

  interface PickerSection {
    key: string;
    label: string;
    emojis: string[];
  }

  const sections = $derived.by((): PickerSection[] => {
    const query = search.trim();
    if (query) {
      const matches = BROWSABLE_EMOJIS.filter((emoji) => emoji.includes(query));
      return [{ key: 'search', label: 'Результаты', emojis: [...matches] }];
    }

    const browse: PickerSection[] = [];
    if (frequentEmoji.length) {
      browse.push({ key: 'frequent', label: 'Часто используемые', emojis: [...frequentEmoji] });
    }
    for (const category of CATEGORIES) {
      browse.push({ key: category.key, label: category.label, emojis: category.emojis });
    }
    return browse;
  });

  /** Whatever the reader's tone preference turns this base into. */
  function toned(emoji: string): string {
    return withSkinTone(emoji, skinTone);
  }

  type PickerRow =
    | { kind: 'header'; key: string; sectionKey: string; label: string; top: number; height: number }
    | {
        kind: 'grid';
        key: string;
        sectionKey: string;
        emojis: string[];
        firstIndex: number;
        top: number;
        height: number;
      };

  const layout = $derived.by(() => {
    const rows: PickerRow[] = [];
    const flat: string[] = [];
    const sectionTop = new Map<string, number>();
    let top = 0;

    for (const section of sections) {
      if (!section.emojis.length) continue;
      sectionTop.set(section.key, top);
      rows.push({
        kind: 'header',
        key: `${section.key}:header`,
        sectionKey: section.key,
        label: section.label,
        top,
        height: HEADER_HEIGHT
      });
      top += HEADER_HEIGHT;

      for (let offset = 0; offset < section.emojis.length; offset += COLUMNS) {
        rows.push({
          kind: 'grid',
          key: `${section.key}:${offset}`,
          sectionKey: section.key,
          emojis: section.emojis.slice(offset, offset + COLUMNS),
          firstIndex: flat.length + offset,
          top,
          height: ROW_HEIGHT
        });
        top += ROW_HEIGHT;
      }
      flat.push(...section.emojis);
    }

    return { rows, flat, sectionTop, totalHeight: top };
  });

  const visibleRows = $derived.by(() => {
    const from = scrollTop - OVERSCAN_ROWS * ROW_HEIGHT;
    const to = scrollTop + viewportHeight + OVERSCAN_ROWS * ROW_HEIGHT;
    return layout.rows.filter((row) => row.top + row.height >= from && row.top <= to);
  });

  const toneStripOptions = $derived(toneStripFor ? skinToneChoices(toneStripFor) : []);

  $effect(() => {
    skinTone = loadSkinTone(SKIN_TONES.length);
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
    void tick().then(() => {
      searchInput?.focus();
      if (scroller) viewportHeight = scroller.clientHeight || viewportHeight;
    });
  });

  // Which category the reader is actually looking at, so the anchors stay honest
  // while they scroll instead of only when they click.
  $effect(() => {
    const position = scrollTop + 1;
    let current = layout.rows[0]?.sectionKey ?? 'frequent';
    for (const row of layout.rows) {
      if (row.kind !== 'header' || row.top > position) continue;
      current = row.sectionKey;
    }
    activeSectionKey = current;
  });

  function onScroll(event: Event): void {
    const target = event.currentTarget as HTMLDivElement;
    scrollTop = target.scrollTop;
    viewportHeight = target.clientHeight;
  }


  function goToSection(key: string): void {
    search = '';
    activeSectionKey = key;
    activeIndex = 0;
    void tick().then(() => {
      const top = layout.sectionTop.get(key);
      if (top === undefined || !scroller) return;
      // Instant, not smooth: an animated scroll walks the window across every
      // row in between, so the jump asked for hundreds of screens of artwork on
      // the way and felt like the picker was loading forever.
      scroller.scrollTop = top;
      scrollTop = top;
    });
  }

  async function focusOption(index: number): Promise<void> {
    const flat = layout.flat;
    if (!flat.length) return;
    activeIndex = Math.max(0, Math.min(index, flat.length - 1));
    previewEmoji = toned(flat[activeIndex] ?? '');

    // The target row may be outside the rendered window, so bring it into view
    // first and let the window rebuild before reaching for the button.
    const row = layout.rows.find(
      (entry) =>
        entry.kind === 'grid'
        && activeIndex >= entry.firstIndex
        && activeIndex < entry.firstIndex + entry.emojis.length
    );
    if (row && scroller) {
      if (row.top < scrollTop) scroller.scrollTop = row.top;
      else if (row.top + row.height > scrollTop + viewportHeight) {
        scroller.scrollTop = row.top + row.height - viewportHeight;
      }
    }
    await tick();
    scroller?.querySelector<HTMLButtonElement>(`[data-option-index="${activeIndex}"]`)?.focus();
  }

  function gridKeydown(event: KeyboardEvent): void {
    let next = activeIndex;
    if (event.key === 'ArrowRight') next += 1;
    else if (event.key === 'ArrowLeft') next -= 1;
    else if (event.key === 'ArrowDown') next += COLUMNS;
    else if (event.key === 'ArrowUp') next -= COLUMNS;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = layout.flat.length - 1;
    else return;
    event.preventDefault();
    // A context menu may be hosting this picker; it must not also move its own
    // selection on the same key.
    event.stopPropagation();
    void focusOption(next);
  }

  function categoryKeydown(event: KeyboardEvent): void {
    const anchors = Array.from(
      (event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[data-category]')
    );
    const current = anchors.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    let next = current;
    if (event.key === 'ArrowRight') next = (current + 1) % anchors.length;
    else if (event.key === 'ArrowLeft') next = (current - 1 + anchors.length) % anchors.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = anchors.length - 1;
    else return;
    event.preventDefault();
    event.stopPropagation();
    anchors[next]?.focus();
    anchors[next]?.click();
  }

  /** A press anywhere that is not the strip or the tone menu puts them away. */
  function dismissOverlays(event: PointerEvent): void {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (strip?.contains(target)) return;
    if (!(target instanceof Element) || !target.closest('.reaction-tone')) toneMenuOpen = false;
    if (!(target instanceof Element) || !target.closest('.reaction-picker-grid button')) {
      toneStripFor = '';
    }
  }

  function chooseTone(tone: number): void {
    skinTone = tone;
    saveSkinTone(tone, SKIN_TONES.length);
    toneMenuOpen = false;
  }

  // A one-off pick, which leaves the remembered default alone. It opens on a
  // dwell or a right click; the strip is anchored to the tile so the colours
  // appear where the eye already is.
  function openToneStrip(emoji: string, tile: HTMLElement): void {
    if (!hasSkinToneChoices(emoji) || !picker) return;
    const tileBox = tile.getBoundingClientRect();
    const pickerBox = picker.getBoundingClientRect();
    toneStripLeft = tileBox.left - pickerBox.left + tileBox.width / 2;
    toneStripTop = tileBox.top - pickerBox.top;
    toneStripFor = emoji;
  }

  function beginToneHover(emoji: string, event: PointerEvent): void {
    const tile = event.currentTarget as HTMLElement;
    if (!hasSkinToneChoices(emoji)) return;
    window.clearTimeout(toneHoverTimer);
    toneHoverTimer = window.setTimeout(() => openToneStrip(emoji, tile), TONE_HOVER_DELAY_MS);
  }

  function cancelToneHover(): void {
    window.clearTimeout(toneHoverTimer);
    toneHoverTimer = 0;
  }

  /** Leaving the tile closes the strip unless the pointer moved onto it. */
  function leaveTile(event: PointerEvent): void {
    cancelToneHover();
    const next = event.relatedTarget;
    if (next instanceof Node && strip?.contains(next)) return;
    toneStripFor = '';
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
    cancelToneHover();
    await react(emoji);
    close();
  }

  async function chooseFromStrip(emoji: string, close: () => void): Promise<void> {
    toneStripFor = '';
    await react(emoji);
    close();
  }

  function resetOnClose(): void {
    cancelToneHover();
    search = '';
    activeSectionKey = 'frequent';
    activeIndex = 0;
    previewEmoji = '';
    toneMenuOpen = false;
    toneStripFor = '';
    scrollTop = 0;
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
      ><Emoji {emoji} size={20} decorative /></button>
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
        <div
          class="reaction-picker"
          role="presentation"
          bind:this={picker}
          onpointerdown={dismissOverlays}
        >
          <div class="reaction-picker-head">
            <div class="reaction-picker-search-row">
              <label class="reaction-picker-search">
                <span class="sr-only">Поиск реакции</span>
                <input
                  bind:this={searchInput}
                  bind:value={search}
                  type="search"
                  placeholder="Поиск реакции"
                  oninput={() => {
                    activeIndex = 0;
                    scrollTop = 0;
                    if (scroller) scroller.scrollTop = 0;
                  }}
                />
              </label>

              <div class="reaction-tone">
                <button
                  class="reaction-tone-trigger"
                  type="button"
                  aria-label="Цвет кожи по умолчанию"
                  title="Цвет кожи по умолчанию"
                  aria-haspopup="true"
                  aria-expanded={toneMenuOpen}
                  onclick={() => (toneMenuOpen = !toneMenuOpen)}
                ><Emoji emoji={withSkinTone(TONE_SWATCH_BASE, skinTone)} size={20} decorative /></button>

                {#if toneMenuOpen}
                  <div class="reaction-tone-menu" role="menu" aria-label="Цвет кожи">
                    {#each skinToneChoices(TONE_SWATCH_BASE) as swatch, index (swatch)}
                      {@const tone = index - 1}
                      <button
                        class="reaction-tone-option"
                        class:is-active={tone === skinTone}
                        type="button"
                        role="menuitemradio"
                        aria-checked={tone === skinTone}
                        aria-label={tone === NEUTRAL_TONE ? 'Без цвета кожи' : `Тон ${index}`}
                        onclick={() => chooseTone(tone)}
                      ><Emoji emoji={swatch} size={20} decorative /></button>
                    {/each}
                  </div>
                {/if}
              </div>
            </div>

            <!-- Anchors, not tabs: they scroll the one list rather than swapping
                 its contents. -->
            <div
              class="reaction-picker-anchors"
              role="toolbar"
              tabindex="-1"
              aria-label="Разделы реакций"
              onkeydown={categoryKeydown}
            >
              {#if frequentEmoji.length}
                <button
                  class="reaction-picker-anchor"
                  class:is-active={!searching && activeSectionKey === 'frequent'}
                  type="button"
                  data-category="frequent"
                  aria-label="Часто используемые"
                  aria-current={activeSectionKey === 'frequent' ? 'true' : undefined}
                  title="Часто используемые"
                  onclick={() => goToSection('frequent')}
                >🕘</button>
              {/if}
              {#each CATEGORIES as group (group.key)}
                <button
                  class="reaction-picker-anchor"
                  class:is-active={!searching && activeSectionKey === group.key}
                  type="button"
                  data-category={group.key}
                  aria-label={group.label}
                  aria-current={activeSectionKey === group.key ? 'true' : undefined}
                  title={group.label}
                  onclick={() => goToSection(group.key)}
                ><Emoji emoji={group.icon} size={20} decorative /></button>
              {/each}
            </div>
          </div>

          <div
            class="reaction-picker-body"
            role="grid"
            tabindex="-1"
            aria-label="Доступные реакции"
            bind:this={scroller}
            onscroll={onScroll}
            onkeydown={gridKeydown}
          >
            <div class="reaction-picker-spacer" style:height={`${layout.totalHeight}px`}>
              {#each visibleRows as row (row.key)}
                {#if row.kind === 'header'}
                  <span class="reaction-picker-section" style:top={`${row.top}px`}>{row.label}</span>
                {:else}
                  <div class="reaction-picker-grid" style:top={`${row.top}px`} role="row">
                    {#each row.emojis as emoji, column (emoji)}
                      {@const index = row.firstIndex + column}
                      {@const display = toned(emoji)}
                      <button
                        type="button"
                        role="gridcell"
                        data-option-index={index}
                        tabindex={index === activeIndex ? 0 : -1}
                        aria-label={`Реакция ${display}`}
                        aria-haspopup={hasSkinToneChoices(emoji) ? 'true' : undefined}
                        onclick={() => void choose(display, close)}
                        oncontextmenu={(event) => {
                          if (!hasSkinToneChoices(emoji)) return;
                          event.preventDefault();
                          openToneStrip(emoji, event.currentTarget as HTMLElement);
                        }}
                        onfocus={() => {
                          activeIndex = index;
                          previewEmoji = display;
                        }}
                        onpointerenter={(event) => {
                          previewEmoji = display;
                          beginToneHover(emoji, event);
                        }}
                        onpointerleave={leaveTile}
                      >
                        <Emoji emoji={display} decorative />
                        {#if hasSkinToneChoices(emoji)}
                          <span class="reaction-picker-tone-hint" aria-hidden="true"></span>
                        {/if}
                      </button>
                    {/each}
                  </div>
                {/if}
              {/each}
            </div>

            {#if layout.flat.length === 0}
              <p class="reaction-picker-empty">Ничего не найдено</p>
            {/if}
          </div>

          {#if toneStripFor}
            <!-- Anchored to the tile and only as wide as the six swatches. It
                 closes by leaving it or clicking elsewhere; a click inside is
                 never a reason to take the whole picker down with it. -->
            <div
              class="reaction-tone-strip"
              role="group"
              aria-label="Цвет кожи для этой реакции"
              bind:this={strip}
              style:left={`${toneStripLeft}px`}
              style:top={`${toneStripTop}px`}
              onpointerleave={() => (toneStripFor = '')}
            >
              {#each toneStripOptions as option (option)}
                <button
                  type="button"
                  aria-label={`Реакция ${option}`}
                  onclick={() => void chooseFromStrip(option, close)}
                ><Emoji emoji={option} decorative /></button>
              {/each}
            </div>
          {/if}

          <div class="reaction-picker-foot" aria-hidden="true">
            {#if previewEmoji}
              <span class="reaction-picker-preview"><Emoji emoji={previewEmoji} decorative /></span>
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
  .reaction-picker-trigger { color: color-mix(in oklch, currentColor, transparent 42%); }
  .reaction-quick-trigger:hover, .reaction-quick-trigger:focus-visible,
  .reaction-picker-trigger:hover, .reaction-picker-trigger:focus-visible { background: color-mix(in oklch, var(--accent), transparent 86%); color: var(--accent); outline: none; }

  /* The picker draws its own header and footer to the panel edges. */
  :global(.reaction-picker-panel) { padding: 0; overflow: hidden; }

  .reaction-picker {
    position: relative;
    display: flex;
    width: min(392px, calc(100vw - 28px));
    max-height: var(--popover-available-height, calc(100dvh - 16px));
    flex-direction: column;
  }

  .reaction-picker-head { display: flex; flex: none; flex-direction: column; gap: 12px; padding: 14px 14px 10px; }

  .reaction-picker-search-row { display: flex; align-items: center; gap: 8px; min-width: 0; }

  .reaction-picker-search { flex: 1 1 auto; min-width: 0; }

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

  .reaction-tone { position: relative; flex: none; }

  .reaction-tone-trigger {
    display: grid;
    width: 44px;
    height: 44px;
    place-items: center;
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 15px;
    background: color-mix(in oklch, var(--control), transparent 45%);
    cursor: pointer;
  }

  .reaction-tone-trigger:hover,
  .reaction-tone-trigger:focus-visible { border-color: color-mix(in oklch, var(--accent), transparent 40%); outline: none; }

  .reaction-tone-menu {
    position: absolute;
    z-index: 2;
    top: calc(100% + 6px);
    inset-inline-end: 0;
    display: flex;
    gap: 2px;
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 13px;
    padding: 4px;
    background: var(--warm-900);
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.42);
  }

  .reaction-tone-option,
  .reaction-tone-strip button {
    display: grid;
    width: 34px;
    height: 34px;
    place-items: center;
    border: 0;
    border-radius: 10px;
    background: transparent;
    cursor: pointer;
  }

  .reaction-tone-option:hover,
  .reaction-tone-option:focus-visible,
  .reaction-tone-option.is-active,
  .reaction-tone-strip button:hover,
  .reaction-tone-strip button:focus-visible { background: color-mix(in oklch, var(--accent), transparent 86%); outline: none; }

  .reaction-picker-anchors { display: flex; flex-wrap: wrap; gap: 6px; }

  .reaction-picker-anchor {
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

  .reaction-picker-anchor:hover,
  .reaction-picker-anchor.is-active { background: color-mix(in oklch, var(--accent), transparent 86%); }

  .reaction-picker-body {
    position: relative;
    max-height: min(300px, 46vh);
    min-height: 0;
    flex: 1 1 auto;
    padding: 2px 14px 14px;
    overflow-y: auto;
  }

  .reaction-picker-body:focus { outline: none; }

  /* Rows are positioned against the full-height spacer, so scrolling stays
     accurate while only the visible ones exist. */
  .reaction-picker-spacer { position: relative; }

  .reaction-picker-section {
    position: absolute;
    inset-inline: 0;
    display: flex;
    height: 28px;
    align-items: center;
    color: var(--warm-faint);
    font-family: var(--font-mono);
    font-size: 10.5px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .reaction-picker-grid {
    position: absolute;
    inset-inline: 0;
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 4px;
  }

  .reaction-picker-grid button {
    position: relative;
    display: grid;
    height: 44px;
    place-items: center;
    border: 0;
    border-radius: 13px;
    background: transparent;
    cursor: pointer;
  }

  .reaction-picker-grid button:hover,
  .reaction-picker-grid button:focus-visible {
    background: color-mix(in oklch, var(--accent), transparent 86%);
    outline: none;
  }

  /* The corner notch marks what a long press can open, the way a keyboard marks
     a key with alternates. */
  .reaction-picker-tone-hint {
    position: absolute;
    right: 4px;
    bottom: 4px;
    width: 0;
    height: 0;
    border-top: 4px solid transparent;
    border-inline-start: 4px solid color-mix(in oklch, currentColor, transparent 62%);
  }

  .reaction-picker-empty { margin: 8px 0; color: var(--warm-faint); font-size: 13px; text-align: center; }

  /* Anchored over the tile it belongs to and only as wide as its six swatches,
     rather than a full-width bar with empty space on both sides. */
  .reaction-tone-strip {
    position: absolute;
    z-index: 3;
    display: flex;
    width: max-content;
    align-items: center;
    gap: 2px;
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 15px;
    padding: 4px;
    background: var(--warm-900);
    box-shadow: 0 14px 30px rgba(0, 0, 0, 0.46);
    transform: translate(-50%, calc(-100% - 6px));
  }

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

  .reaction-picker-hint { color: var(--warm-muted-dim); font-family: var(--font-mono); font-size: 12.5px; }

  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
