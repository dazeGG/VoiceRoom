<script lang="ts">
  // The composer row that shows which message the draft answers. It renders
  // inside the bordered composer field, directly above the text row and on the
  // same footing as pending image attachments, so the draft reads as one input
  // rather than a stray card floating above it. The quote is a jump target, and
  // cancelling is an icon so the row reads as part of the composer instead of a
  // form with a stray text button.
  import { X } from '@lucide/svelte';
  import ReplyPreview from './ReplyPreview.svelte';
  import type { ReplyTarget } from './reply-store.svelte';

  let {
    target,
    onjump,
    oncancel
  }: {
    target: ReplyTarget;
    onjump?: (messageId: string) => void;
    oncancel: () => void;
  } = $props();
</script>

<div class="reply-target">
  <ReplyPreview preview={target} interactive={Boolean(onjump) && !target.deleted} {onjump} />
  <button
    class="reply-target-cancel"
    type="button"
    aria-label="Отменить ответ"
    title="Отменить ответ"
    onclick={oncancel}
  >
    <X size={16} aria-hidden="true" />
  </button>
</div>

<style>
  /* Matches .attachment-composer padding so a reply and a pending image line up
     against the same field edge. */
  .reply-target {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    padding: 10px 10px 0;
  }

  .reply-target :global(.reply-preview) {
    min-height: 0;
    border-start-end-radius: 8px;
    border-end-end-radius: 8px;
    padding-block: 5px;
  }

  .reply-target-cancel {
    display: grid;
    width: 28px;
    height: 28px;
    flex: none;
    place-items: center;
    border: 0;
    border-radius: 9px;
    padding: 0;
    background: transparent;
    color: var(--warm-muted);
    cursor: pointer;
    transition: background 120ms ease, color 120ms ease;
  }

  .reply-target-cancel:hover,
  .reply-target-cancel:focus-visible {
    background: color-mix(in oklch, var(--coral), transparent 86%);
    color: var(--coral);
    outline: none;
  }
</style>
