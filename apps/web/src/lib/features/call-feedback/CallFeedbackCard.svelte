<script lang="ts">
  // The question about one call: a thumb opens what went well or wrong and a
  // comment; the cross or Escape closes it. Mounted per call, so a new
  // question starts with nothing chosen. `hosted` is the question as the top
  // of the leave screen: that window has its own ways out, so the question
  // has no cross, no Escape and does not go away by itself.
  import { ThumbsDown, ThumbsUp, X } from '@lucide/svelte';
  import {
    CALL_FEEDBACK_COMMENT_MAX_LENGTH,
    CALL_FEEDBACK_TAGS_BY_RATING
  } from '@voice-room/shared/contracts/feedback';
  import type { CallFeedbackCall, CallFeedbackRating, CallFeedbackTag } from '$lib/api/feedback';
  import { Button } from '$lib/shared/ui';
  import { iconMd, iconSm } from '$lib/shared/ui/icons';
  import { answerCallFeedback, dropCallFeedback, skipCallFeedback } from './call-feedback.svelte';
  import { CALL_FEEDBACK_TAG_LABELS } from './tags';

  let {
    call,
    onAnswered,
    hosted = false
  }: { call: CallFeedbackCall; onAnswered: () => void; hosted?: boolean } = $props();

  /** How long an untouched question stays on a page someone is looking at. */
  const UNANSWERED_CLOSE_MS = 60_000;

  let rating = $state<CallFeedbackRating | null>(null);
  let tags = $state<CallFeedbackTag[]>([]);
  let comment = $state('');
  let card = $state<HTMLElement | null>(null);

  const minutes = $derived(Math.max(1, Math.round(call.durationS / 60)));

  // Untouched, the question goes away by itself, but only counting the time
  // the page is in view, and without counting as a skip: it may go unseen.
  $effect(() => {
    if (rating || hosted) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      if (document.visibilityState === 'visible') timer = setTimeout(dropCallFeedback, UNANSWERED_CLOSE_MS);
    };
    arm();
    document.addEventListener('visibilitychange', arm);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', arm);
    };
  });

  function choose(next: CallFeedbackRating): void {
    if (rating !== next) tags = [];
    rating = next;
  }

  function toggle(tag: CallFeedbackTag): void {
    tags = tags.includes(tag) ? tags.filter((other) => other !== tag) : [...tags, tag];
  }

  function send(event?: SubmitEvent): void {
    event?.preventDefault();
    if (!rating) return;
    void answerCallFeedback({ rating, tags, comment });
    onAnswered();
  }

  // A chosen thumb is already an answer: closing sends what is there.
  function close(): void {
    if (rating) send();
    else skipCallFeedback();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (!hosted && event.key === 'Escape' && card?.contains(document.activeElement)) close();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="call-feedback-card" bind:this={card}>
  <div class="call-feedback-head">
    <div>
      <h2 id="callFeedbackTitle">Как прошёл звонок?</h2>
      <p class="call-feedback-sub">Звонок длился {minutes} мин</p>
    </div>
    {#if !hosted}
      <button class="call-feedback-close" type="button" aria-label="Закрыть" data-feedback-close onclick={close}>
        <X {...iconSm} aria-hidden="true" />
      </button>
    {/if}
  </div>

  <div class="call-feedback-thumbs">
    <button
      class="call-feedback-thumb is-good"
      type="button"
      aria-label="Хорошо"
      aria-pressed={rating === 'good'}
      onclick={() => choose('good')}
    >
      <ThumbsUp {...iconMd} aria-hidden="true" />
    </button>
    <button
      class="call-feedback-thumb is-bad"
      type="button"
      aria-label="Плохо"
      aria-pressed={rating === 'bad'}
      onclick={() => choose('bad')}
    >
      <ThumbsDown {...iconMd} aria-hidden="true" />
    </button>
  </div>

  {#if rating}
    <form class="call-feedback-details" onsubmit={send}>
      <fieldset class="call-feedback-tags">
        <legend>{rating === 'good' ? 'Что понравилось?' : 'Что пошло не так?'}</legend>
        {#each CALL_FEEDBACK_TAGS_BY_RATING[rating] as tag (tag)}
          <button class="call-feedback-tag" type="button" aria-pressed={tags.includes(tag)} onclick={() => toggle(tag)}>
            {CALL_FEEDBACK_TAG_LABELS[tag]}
          </button>
        {/each}
      </fieldset>
      <textarea
        class="call-feedback-comment"
        aria-label="Комментарий"
        rows="2"
        maxlength={CALL_FEEDBACK_COMMENT_MAX_LENGTH}
        placeholder={rating === 'good' ? 'Что ещё улучшить? Необязательно' : 'Расскажите подробнее. Необязательно'}
        bind:value={comment}></textarea>
      <div class="call-feedback-actions">
        <Button variant="primary" type="submit">Отправить</Button>
      </div>
    </form>
  {/if}
</div>

<style>
  .call-feedback-card {
    display: grid;
    gap: 12px;
  }

  .call-feedback-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .call-feedback-head h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 700;
  }

  .call-feedback-sub {
    margin: 3px 0 0;
    color: var(--vr-text-3);
    font-size: 13px;
  }

  .call-feedback-close {
    display: grid;
    flex: none;
    width: 28px;
    height: 28px;
    min-height: 0;
    margin: -4px -6px 0 0;
    padding: 0;
    place-items: center;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--vr-text-3);
    cursor: pointer;
  }

  .call-feedback-close:hover {
    background: var(--vr-surface-2-hover);
    color: var(--vr-text);
  }

  .call-feedback-thumbs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .call-feedback-thumb {
    display: grid;
    height: 44px;
    place-items: center;
    border: 1px solid var(--vr-line);
    border-radius: 12px;
    background: var(--vr-surface-2);
    color: var(--vr-text-2);
    cursor: pointer;
    transition:
      border-color 0.14s ease,
      background 0.14s ease,
      color 0.14s ease;
  }

  .call-feedback-thumb:hover {
    background: var(--vr-surface-2-hover);
    color: var(--vr-text);
  }

  .call-feedback-thumb.is-good[aria-pressed='true'] {
    border-color: var(--vr-success);
    background: color-mix(in oklch, var(--vr-success), transparent 88%);
    color: var(--vr-success);
  }

  .call-feedback-thumb.is-bad[aria-pressed='true'] {
    border-color: var(--vr-danger);
    background: color-mix(in oklch, var(--vr-danger), transparent 88%);
    color: var(--vr-danger);
  }

  .call-feedback-details {
    display: grid;
    gap: 12px;
  }

  .call-feedback-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0;
    padding: 0;
    border: 0;
  }

  .call-feedback-tags legend {
    margin-bottom: 8px;
    padding: 0;
    color: var(--vr-text-2);
    font-size: 13px;
    font-weight: 500;
  }

  .call-feedback-tag {
    min-height: 30px;
    padding: 0 12px;
    border: 1px solid var(--vr-line);
    border-radius: 999px;
    background: var(--vr-surface-2);
    color: var(--vr-text);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
    transition:
      border-color 0.14s ease,
      background 0.14s ease;
  }

  .call-feedback-tag:hover {
    background: var(--vr-surface-2-hover);
  }

  .call-feedback-tag[aria-pressed='true'] {
    border-color: var(--vr-accent-line);
    background: color-mix(in oklch, var(--vr-accent), transparent 88%);
  }

  .call-feedback-comment {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid var(--vr-line-strong);
    border-radius: 12px;
    background: var(--vr-surface-2);
    color: var(--vr-text);
    font: inherit;
    font-size: 13.5px;
    resize: vertical;
    outline: none;
  }

  .call-feedback-comment:focus {
    border-color: var(--vr-accent-line);
  }

  .call-feedback-actions {
    display: flex;
    justify-content: flex-end;
  }
</style>
