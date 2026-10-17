<script lang="ts">
  // "How was the call?" after leaving one, as its own window in the middle of
  // the page: the end of a call, the same window the leave screen is. Hidden
  // during a call, and while the leave screen is up, which asks the question
  // itself. A click beside it closes it as the cross does; an answer leaves a
  // short thanks.
  import { dialogFocusTrap } from '$lib/shared/ui/focus-trap';
  import CallFeedbackCard from './CallFeedbackCard.svelte';
  import { callFeedback } from './call-feedback.svelte';

  let { hidden = false }: { hidden?: boolean } = $props();

  const THANKS_MS = 2500;

  let thanked = $state(false);

  const call = $derived(callFeedback.call);

  $effect(() => {
    if (!thanked) return;
    const timer = setTimeout(() => (thanked = false), THANKS_MS);
    return () => clearTimeout(timer);
  });

  function onOverlayClick(event: MouseEvent & { currentTarget: HTMLElement }): void {
    if (event.target !== event.currentTarget) return;
    const cross = event.currentTarget.querySelector<HTMLButtonElement>('[data-feedback-close]');
    if (cross) cross.click();
    else thanked = false;
  }
</script>

{#if !hidden && (call || thanked)}
  <div class="call-feedback-overlay" role="presentation" onclick={onOverlayClick}>
    <div
      class="call-feedback"
      role="dialog"
      aria-modal="true"
      aria-labelledby="callFeedbackTitle"
      tabindex="-1"
      use:dialogFocusTrap={{ enabled: true, initialFocus: '.call-feedback-thumb' }}
    >
      {#if call}
        {#key call}<CallFeedbackCard {call} onAnswered={() => (thanked = true)} />{/key}
      {:else}
        <p class="call-feedback-thanks" id="callFeedbackTitle" role="status">
          Спасибо! Это помогает делать звонки лучше.
        </p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .call-feedback-overlay {
    position: fixed;
    inset: 0;
    z-index: 45;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: var(--vr-backdrop);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
  }

  .call-feedback {
    width: min(420px, 100%);
    max-height: 100%;
    padding: 22px 24px 24px;
    overflow-y: auto;
    border: 1px solid var(--vr-line-strong);
    border-radius: var(--radius-xl);
    background: var(--vr-surface-2);
    box-shadow: var(--vr-shadow-modal);
    color: var(--vr-text);
    font-family: var(--font-ui);
    outline: none;
    animation: call-feedback-in 0.18s ease-out;
  }

  @keyframes call-feedback-in {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.98);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .call-feedback {
      animation: none;
    }
  }

  .call-feedback-thanks {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    text-align: center;
  }
</style>
