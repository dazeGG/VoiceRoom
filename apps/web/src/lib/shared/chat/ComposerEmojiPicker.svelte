<script lang="ts">
  import { Smile } from '@lucide/svelte';
  import { untrack } from 'svelte';
  import { iconSm } from '$lib/shared/ui/icons';
  import { Popover } from '$lib/shared/ui';
  import EmojiPickerPanel from './EmojiPickerPanel.svelte';
  import { DEFAULT_FREQUENT_REACTIONS, loadFrequentReactions, recordFrequentReaction } from './frequent-reactions';
  import { TYPING_NOTICE_INTERVAL_MS } from './typing.svelte';

  // Shares the frequent list with reactions: the same few emoji tend to be the
  // ones someone both reacts with and writes.
  const PERSISTENCE_NAMESPACE = 'chat';

  let {
    userId = '',
    disabled = false,
    onpick,
    onbrowse
  }: {
    /** Empty for a guest, whose frequent list is the default and is not kept. */
    userId?: string;
    disabled?: boolean;
    onpick: (emoji: string) => void;
    /** Called on open and then regularly while the panel stays open. */
    onbrowse?: () => void;
  } = $props();

  let open = $state(false);
  let frequentEmoji = $state<string[]>([...DEFAULT_FREQUENT_REACTIONS]);

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

  // Browsing is repeated at half the notice interval so the host's notifier,
  // which throttles to the full interval, never skips a beat and lets the
  // "выбирает эмодзи" state lapse while the panel is still open.
  $effect(() => {
    if (!open) return;
    const browse = untrack(() => onbrowse);
    if (!browse) return;
    browse();
    const timer = setInterval(browse, TYPING_NOTICE_INTERVAL_MS / 2);
    return () => clearInterval(timer);
  });

  function choose(emoji: string, close: (restoreFocus?: boolean) => void): void {
    // Focus goes back to the composer, not to this button.
    close(false);
    onpick(emoji);
    if (userId) {
      void recordFrequentReaction(PERSISTENCE_NAMESPACE, userId, emoji).then((ranked) => {
        frequentEmoji = ranked;
      });
    }
  }
</script>

<Popover
  bind:open
  placement="top-end"
  flip
  floating
  role="dialog"
  ariaLabel="Выбор эмодзи"
  rootClass="composer-emoji-root"
  panelClass="reaction-picker-panel"
>
  {#snippet trigger({ toggle, panelId })}
    <button
      class="composer-emoji-trigger"
      type="button"
      {disabled}
      aria-label="Добавить эмодзи"
      title="Эмодзи"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={panelId}
      onclick={toggle}><Smile {...iconSm} aria-hidden="true" /></button
    >
  {/snippet}

  {#snippet content({ close })}
    <EmojiPickerPanel
      {frequentEmoji}
      searchLabel="Поиск эмодзи"
      sectionsLabel="Разделы эмодзи"
      gridLabel="Эмодзи"
      optionLabel={(emoji) => `Эмодзи ${emoji}`}
      toneStripLabel="Цвет кожи для этого эмодзи"
      onpick={(emoji) => choose(emoji, close)}
    />
  {/snippet}
</Popover>

<style>
  /* The mirror of the attachment button on the other side of the field: the
     same 32px square, centred on the one-line textarea. */
  :global(.composer-emoji-root) {
    align-self: flex-start;
    margin: 8px 8px 0 0;
  }

  .composer-emoji-trigger {
    display: grid;
    width: 32px;
    height: 32px;
    padding: 0;
    place-items: center;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--warm-muted);
    cursor: pointer;
    transition:
      color 0.15s ease,
      background 0.15s ease;
  }

  .composer-emoji-trigger:hover,
  .composer-emoji-trigger[aria-expanded='true'] {
    background: var(--control);
    color: var(--warm-ink);
  }

  .composer-emoji-trigger:focus-visible {
    outline: 2px solid var(--focus-border, rgba(255, 255, 255, 0.72));
    outline-offset: 2px;
  }

  .composer-emoji-trigger:disabled {
    cursor: default;
    opacity: 0.42;
  }
</style>
