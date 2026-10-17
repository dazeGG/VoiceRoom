<script lang="ts">
  // "How was the call?" after leaving one: a small card in the corner, not a
  // dialog, hidden during a call. It shows the question about the call just
  // left, then a short thanks.
  import CallFeedbackCard from './CallFeedbackCard.svelte';
  import { callFeedback } from './call-feedback.svelte';

  let { inCall = false }: { inCall?: boolean } = $props();

  const THANKS_MS = 2500;

  let thanked = $state(false);

  const call = $derived(callFeedback.call);

  $effect(() => {
    if (!thanked) return;
    const timer = setTimeout(() => (thanked = false), THANKS_MS);
    return () => clearTimeout(timer);
  });
</script>

{#if !inCall && (call || thanked)}
  <aside class="call-feedback" aria-labelledby="callFeedbackTitle">
    {#if call}
      {#key call}<CallFeedbackCard {call} onAnswered={() => (thanked = true)} />{/key}
    {:else}
      <p class="call-feedback-thanks" id="callFeedbackTitle" role="status">
        Спасибо! Это помогает делать звонки лучше.
      </p>
    {/if}
  </aside>
{/if}

<style>
  .call-feedback {
    /* Bottom right, above the page and the guest's leave screen: the update
       notice keeps the top centre. */
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 60;
    display: grid;
    gap: 12px;
    width: min(340px, calc(100vw - 32px));
    padding: 14px 16px 16px;
    border: 1px solid var(--vr-line-strong);
    border-radius: var(--radius-xl);
    background: var(--vr-surface);
    box-shadow: var(--vr-shadow-popover);
    color: var(--vr-text);
    font-family: var(--font-ui);
    animation: call-feedback-in 0.2s ease-out;
  }

  @keyframes call-feedback-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .call-feedback {
      animation: none;
    }
  }

  @media (max-width: 560px) {
    .call-feedback {
      right: 16px;
      bottom: calc(16px + env(safe-area-inset-bottom, 0px));
      left: 16px;
      width: auto;
    }
  }

  .call-feedback-thanks {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }
</style>
