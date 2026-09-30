<script lang="ts">
  import { SmilePlus } from '@lucide/svelte';
  import { iconSm } from '$lib/shared/ui/icons';
  import { Popover } from '$lib/shared/ui';
  import Emoji from './Emoji.svelte';
  import EmojiPickerPanel from './EmojiPickerPanel.svelte';
  import type { ReactionStore } from './reaction-store.svelte';
  import { DEFAULT_FREQUENT_REACTIONS, loadFrequentReactions, recordFrequentReaction } from './frequent-reactions';

  const PERSISTENCE_NAMESPACE = 'chat';

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

  async function react(emoji: string): Promise<void> {
    const wasReacted = store.forMessage(messageId).some((summary) => summary.emoji === emoji && summary.reactedByMe);
    if (!(await store.toggle(messageId, emoji))) return;
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
    {#if showQuickReactions}{#each frequentEmoji as emoji (emoji)}
        <button
          class="reaction-quick-trigger"
          type="button"
          {disabled}
          aria-label={`Добавить быструю реакцию ${emoji}`}
          title={`Реакция ${emoji}`}
          onclick={() => void react(emoji)}><Emoji {emoji} size={20} decorative /></button
        >
      {/each}{/if}
    <Popover
      bind:open
      placement="top-start"
      flip
      floating
      role="dialog"
      ariaLabel="Выбор реакции"
      panelClass="reaction-picker-panel"
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
          onclick={toggle}><SmilePlus {...iconSm} aria-hidden="true" /></button
        >
      {/snippet}

      {#snippet content({ close })}
        <EmojiPickerPanel {frequentEmoji} onpick={(emoji) => void choose(emoji, close)} />
      {/snippet}
    </Popover>
  </div>
{/if}

<style>
  /* Sits inside the hover pill, so these carry the same 36px round-square shape
     as the sibling action buttons. */
  .reaction-quick-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    overflow: visible;
  }
  .reaction-quick-trigger,
  .reaction-picker-trigger {
    display: grid;
    width: 36px;
    height: 36px;
    place-items: center;
    border: 0;
    border-radius: 12px;
    padding: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    transition:
      background 120ms ease,
      color 120ms ease;
  }
  .reaction-picker-trigger {
    color: color-mix(in oklch, currentColor, transparent 42%);
  }
  .reaction-quick-trigger:hover,
  .reaction-quick-trigger:focus-visible,
  .reaction-picker-trigger:hover,
  .reaction-picker-trigger:focus-visible {
    background: color-mix(in oklch, var(--accent), transparent 86%);
    color: var(--accent);
    outline: none;
  }
</style>
