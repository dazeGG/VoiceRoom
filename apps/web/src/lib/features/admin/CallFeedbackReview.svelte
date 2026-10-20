<script lang="ts">
  // Answers to "how was the call?", a tab of the admin panel: how many calls
  // went well over the period, what people liked and what got in the way, and
  // the newest answers with the call's own numbers next to each.
  import { onMount } from 'svelte';
  import { ThumbsDown, ThumbsUp } from '@lucide/svelte';
  import {
    ADMIN_CALL_FEEDBACK_LIMIT,
    ADMIN_CALL_FEEDBACK_PERIODS,
    CALL_FEEDBACK_BAD_TAGS,
    CALL_FEEDBACK_GOOD_TAGS,
    type AdminCallFeedbackQuery
  } from '@voice-room/shared/contracts/feedback';
  import { fetchCallFeedback, type AdminCallFeedbackEntry, type AdminCallFeedbackPage } from '$lib/api/feedback';
  import { SegmentControl } from '$lib/shared/ui';
  import { iconSm } from '$lib/shared/ui/icons';
  import { CALL_FEEDBACK_TAG_LABELS } from '$lib/features/call-feedback/tags';
  import AdminNotice from './AdminNotice.svelte';
  import { formatCount, formatDateTime, formatMinutes, formatMs, formatPercent } from './format';
  import { loadFailure, type LoadFailure } from './load-state';

  type Period = (typeof ADMIN_CALL_FEEDBACK_PERIODS)[number];
  type RatingFilter = 'all' | 'good' | 'bad';

  const PERIOD_LABELS: Record<Period, string> = { '7': '7 дней', '30': '30 дней', '90': '90 дней', '365': 'Год' };
  const PLATFORM_LABELS: Record<AdminCallFeedbackEntry['platform'], string> = {
    browser: 'браузер',
    desktop_app: 'приложение',
    mobile: 'телефон'
  };

  let period = $state<Period>('30');
  let rating = $state<RatingFilter>('all');
  let page = $state<AdminCallFeedbackPage | null>(null);
  let failure = $state<LoadFailure | null>(null);
  let loading = $state(false);
  // Only the reply to the latest choice is shown: an earlier, slower one is dropped.
  let latestLoad = 0;

  async function load(): Promise<void> {
    const id = ++latestLoad;
    loading = true;
    const query: AdminCallFeedbackQuery = { days: period, ...(rating === 'all' ? {} : { rating }) };
    try {
      const next = await fetchCallFeedback(query);
      if (id !== latestLoad) return;
      page = next;
      failure = null;
    } catch (cause) {
      if (id === latestLoad) failure = loadFailure(cause, 'Не удалось загрузить отзывы');
    } finally {
      if (id === latestLoad) loading = false;
    }
  }

  function selectPeriod(next: Period): void {
    period = next;
    void load();
  }

  function selectRating(next: RatingFilter): void {
    rating = next;
    void load();
  }

  onMount(() => {
    void load();
  });

  const summary = $derived(page?.summary ?? null);
  const total = $derived(summary ? summary.good + summary.bad : 0);
  const goodShare = $derived(summary && total ? (summary.good / total) * 100 : null);
  const tagCount = (tag: string) => summary?.tags.find((item) => item.tag === tag)?.count ?? 0;
  const tagRows = (tags: readonly (keyof typeof CALL_FEEDBACK_TAG_LABELS)[], of: number) =>
    tags
      .map((tag) => ({ tag, count: tagCount(tag), share: of ? (tagCount(tag) / of) * 100 : 0 }))
      .sort((a, b) => b.count - a.count);

  function qualityLine(entry: AdminCallFeedbackEntry): string {
    const quality = entry.quality;
    if (!quality) return '';
    const parts = [`пинг ${formatMs(quality.rttAvgMs)}`];
    const loss = Math.max(quality.inboundLossAvgPct ?? 0, quality.outboundLossAvgPct ?? 0);
    parts.push(`потери ${formatPercent(loss)}`);
    if (quality.jitterAvgMs !== null) parts.push(`джиттер ${formatMs(quality.jitterAvgMs)}`);
    if (quality.reconnects) parts.push(`переподключений ${quality.reconnects}`);
    if (quality.transport && quality.transport !== 'udp') parts.push(quality.transport.toUpperCase());
    return parts.join(' · ');
  }
</script>

{#snippet tagList(title: string, tags: readonly (keyof typeof CALL_FEEDBACK_TAG_LABELS)[], of: number, tone: string)}
  <section class="feedback-tags" aria-label={title}>
    <h2>{title}</h2>
    <ul>
      {#each tagRows(tags, of) as row (row.tag)}
        <li>
          <span class="feedback-tag-label">{CALL_FEEDBACK_TAG_LABELS[row.tag]}</span>
          <span class="feedback-tag-count">{formatCount(row.count)}</span>
          <span class="feedback-tag-bar" aria-hidden="true">
            <span style:width={`${row.share}%`} style:background={tone}></span>
          </span>
        </li>
      {/each}
    </ul>
  </section>
{/snippet}

<div class="feedback">
  <div class="feedback-controls">
    <SegmentControl
      kind="radio"
      size="sm"
      options={ADMIN_CALL_FEEDBACK_PERIODS.map((value) => ({ value, label: PERIOD_LABELS[value] }))}
      value={period}
      onChange={selectPeriod}
      ariaLabel="Период"
    />
    <SegmentControl
      kind="radio"
      size="sm"
      options={[
        { value: 'all', label: 'Все' },
        { value: 'good', label: 'Хорошие' },
        { value: 'bad', label: 'Плохие' }
      ]}
      value={rating}
      onChange={selectRating}
      ariaLabel="Оценка"
    />
  </div>

  {#if failure && !page}
    <AdminNotice {failure} onRetry={() => void load()} />
  {:else if !page || !summary}
    <p class="feedback-quiet" aria-busy="true">Загружаем…</p>
  {:else}
    {#if failure}<p class="feedback-error" role="alert">{failure.message}</p>{/if}
    <section class="feedback-kpis" aria-label="Итог за период" aria-busy={loading}>
      <div class="feedback-kpi">
        <span class="feedback-kpi-label">Довольны звонком</span>
        <span class="feedback-kpi-value">{formatPercent(goodShare)}</span>
        <span class="feedback-kpi-hint">из {formatCount(total)} ответов</span>
      </div>
      <div class="feedback-kpi">
        <span class="feedback-kpi-label">Хорошо</span>
        <span class="feedback-kpi-value is-good">{formatCount(summary.good)}</span>
      </div>
      <div class="feedback-kpi">
        <span class="feedback-kpi-label">Плохо</span>
        <span class="feedback-kpi-value is-bad">{formatCount(summary.bad)}</span>
      </div>
    </section>

    <div class="feedback-tag-columns">
      {@render tagList('Что мешало', CALL_FEEDBACK_BAD_TAGS, summary.bad, 'var(--vr-danger)')}
      {@render tagList('Что понравилось', CALL_FEEDBACK_GOOD_TAGS, summary.good, 'var(--vr-success)')}
    </div>

    {#if page.entries.length === 0}
      <p class="feedback-quiet">За этот период ответов нет.</p>
    {:else}
      <ul class="feedback-list" aria-label="Ответы">
        {#each page.entries as entry (entry.id)}
          <li class="feedback-entry">
            <div class="feedback-entry-head">
              <span class="feedback-rating" data-rating={entry.rating}>
                {#if entry.rating === 'good'}
                  <ThumbsUp {...iconSm} aria-hidden="true" /> Хорошо
                {:else}
                  <ThumbsDown {...iconSm} aria-hidden="true" /> Плохо
                {/if}
              </span>
              <span>{entry.author ? `${entry.author.displayName} (@${entry.author.login})` : 'Гость'}</span>
              <span>{formatDateTime(entry.createdAt)}</span>
            </div>
            <div class="feedback-entry-call">
              {entry.roomName ? `«${entry.roomName}»` : 'временная комната'} · {formatMinutes(entry.durationS / 60)} · собеседников
              {entry.peers} · {PLATFORM_LABELS[entry.platform]}
              {#if entry.quality}<br /><span class="feedback-entry-quality">{qualityLine(entry)}</span>{/if}
            </div>
            {#if entry.tags.length}
              <ul class="feedback-entry-tags">
                {#each entry.tags as tag (tag)}<li>{CALL_FEEDBACK_TAG_LABELS[tag]}</li>{/each}
              </ul>
            {/if}
            {#if entry.comment}<p class="feedback-entry-comment">{entry.comment}</p>{/if}
          </li>
        {/each}
      </ul>
      {#if page.entries.length >= ADMIN_CALL_FEEDBACK_LIMIT}
        <p class="feedback-quiet">Показаны последние {ADMIN_CALL_FEEDBACK_LIMIT} ответов за период.</p>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .feedback {
    display: grid;
    gap: 18px;
  }

  .feedback-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 16px;
  }

  .feedback-quiet {
    color: var(--vr-text-2);
  }

  .feedback-error {
    color: var(--vr-danger);
  }

  .feedback-kpis {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 165px), 1fr));
    gap: 12px;
  }

  .feedback-kpi {
    display: grid;
    gap: 4px;
    padding: 14px 16px 12px;
    border: 1px solid var(--vr-line);
    border-radius: 14px;
    background: var(--vr-surface);
  }

  .feedback-kpi-label {
    color: var(--vr-text-2);
    font-size: 12.5px;
  }

  .feedback-kpi-value {
    font-size: 30px;
    font-weight: 700;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
  }

  .feedback-kpi-value.is-good {
    color: var(--vr-success);
  }

  .feedback-kpi-value.is-bad {
    color: var(--vr-danger);
  }

  .feedback-kpi-hint {
    color: var(--vr-text-3);
    font-size: 12px;
  }

  .feedback-tag-columns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
    gap: 12px;
  }

  .feedback-tags {
    padding: 14px 16px;
    border: 1px solid var(--vr-line);
    border-radius: 14px;
    background: var(--vr-surface);
  }

  .feedback-tags h2 {
    margin: 0 0 10px;
    font-size: 14px;
  }

  .feedback-tags ul {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .feedback-tags li {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 4px 10px;
    font-size: 13px;
  }

  .feedback-tag-count {
    color: var(--vr-text-2);
    font-variant-numeric: tabular-nums;
  }

  .feedback-tag-bar {
    grid-column: 1 / -1;
    height: 4px;
    border-radius: 2px;
    background: var(--vr-surface-2);
    overflow: hidden;
  }

  .feedback-tag-bar span {
    display: block;
    height: 100%;
    border-radius: 2px;
  }

  .feedback-list {
    display: grid;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .feedback-entry {
    display: grid;
    gap: 8px;
    padding: 14px 16px;
    border: 1px solid var(--vr-line-strong);
    border-radius: 14px;
    background: var(--vr-surface);
  }

  .feedback-entry-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 14px;
    color: var(--vr-text-2);
    font-size: 13px;
  }

  .feedback-rating {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-weight: 600;
  }

  .feedback-rating[data-rating='good'] {
    color: var(--vr-success);
  }

  .feedback-rating[data-rating='bad'] {
    color: var(--vr-danger);
  }

  .feedback-entry-call {
    color: var(--vr-text-2);
    font-size: 13px;
    line-height: 1.5;
  }

  .feedback-entry-quality {
    color: var(--vr-text-3);
    font-variant-numeric: tabular-nums;
  }

  .feedback-entry-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .feedback-entry-tags li {
    padding: 3px 10px;
    border: 1px solid var(--vr-line);
    border-radius: 999px;
    background: var(--vr-surface-2);
    font-size: 12.5px;
  }

  .feedback-entry-comment {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
