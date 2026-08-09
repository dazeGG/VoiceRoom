<script lang="ts">
  // Collapsed strip above the chat body. Collapsed it is just a count; expanded
  // it lists the pinned messages newest-first, each jumping to the message.
  import { ChevronDown, Pin, X } from '@lucide/svelte';
  import { iconSm } from '$lib/shared/ui/icons';
  import { roomPins } from '../pins.svelte';

  let {
    onJump,
    onUnpin,
    canUnpin = false
  }: {
    onJump: (messageId: string) => void;
    onUnpin: (messageId: string) => void;
    canUnpin?: boolean;
  } = $props();

  let expanded = $state(false);

  const count = $derived(roomPins.pins.length);

  // A pin removed while the list is open should not leave an empty panel behind.
  $effect(() => {
    if (count === 0) expanded = false;
  });

  function preview(text: string): string {
    const clean = text.replace(/\s+/g, ' ').trim();
    return clean.length > 90 ? `${clean.slice(0, 89)}…` : clean || 'Вложение';
  }
</script>

{#if count > 0}
  <div class="pinned-bar" class:is-expanded={expanded}>
    <button
      class="pinned-bar-toggle"
      type="button"
      aria-expanded={expanded}
      onclick={() => (expanded = !expanded)}
    >
      <span class="pinned-bar-icon" aria-hidden="true"><Pin {...iconSm} /></span>
      <span class="pinned-bar-title">Закреплённые</span>
      <span class="pinned-bar-count">{count}</span>
      <span class="pinned-bar-chevron" aria-hidden="true"><ChevronDown {...iconSm} /></span>
    </button>

    {#if expanded}
      <ul class="pinned-bar-list">
        {#each roomPins.pins as pin (pin.messageId)}
          <li class="pinned-bar-item">
            <button class="pinned-bar-jump" type="button" onclick={() => onJump(pin.messageId)}>
              <span class="pinned-bar-author">{pin.author.name || 'Участник'}</span>
              <span class="pinned-bar-text">{preview(pin.text)}</span>
            </button>
            {#if canUnpin}
              <button
                class="pinned-bar-unpin"
                type="button"
                aria-label="Открепить сообщение"
                title="Открепить"
                onclick={() => onUnpin(pin.messageId)}
              >
                <X {...iconSm} aria-hidden="true" />
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .pinned-bar {
    flex: none;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    background: color-mix(in oklch, var(--control), transparent 82%);
  }

  .pinned-bar-toggle {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    height: 38px;
    padding: 0 12px;
    border: 0;
    background: transparent;
    color: var(--warm-muted);
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }

  .pinned-bar-toggle:hover {
    color: var(--warm-ink);
  }

  .pinned-bar-icon {
    display: inline-flex;
    flex: none;
    color: var(--accent);
  }

  .pinned-bar-title {
    flex: 1;
    text-align: left;
  }

  .pinned-bar-count {
    flex: none;
    color: var(--warm-faint);
    font-family: var(--font-mono);
    font-size: 11.5px;
  }

  .pinned-bar-chevron {
    display: inline-flex;
    flex: none;
    transition: transform 150ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .pinned-bar.is-expanded .pinned-bar-chevron {
    transform: rotate(180deg);
  }

  .pinned-bar-list {
    display: flex;
    max-height: min(220px, 30vh);
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0 8px 8px;
    overflow-y: auto;
    list-style: none;
  }

  .pinned-bar-item {
    display: flex;
    align-items: center;
    gap: 4px;
    border-radius: 12px;
  }

  .pinned-bar-item:hover {
    background: color-mix(in oklch, var(--accent), transparent 92%);
  }

  .pinned-bar-jump {
    display: flex;
    flex: 1;
    min-width: 0;
    flex-direction: column;
    gap: 2px;
    padding: 8px 10px;
    border: 0;
    border-radius: 12px;
    background: transparent;
    font-family: var(--font-ui);
    text-align: left;
    cursor: pointer;
  }

  .pinned-bar-author {
    color: var(--warm-muted-dim);
    font-size: 11.5px;
    font-weight: 700;
  }

  .pinned-bar-text {
    overflow: hidden;
    color: var(--warm-ink-dim);
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pinned-bar-unpin {
    display: grid;
    flex: none;
    width: 28px;
    height: 28px;
    margin-right: 6px;
    place-items: center;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: var(--warm-faint);
    cursor: pointer;
  }

  .pinned-bar-unpin:hover {
    background: color-mix(in oklch, var(--coral), transparent 86%);
    color: var(--coral);
  }
</style>
