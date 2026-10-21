// Answers to "how was the call?": how many calls went well over the period,
// what people liked and what got in the way, and the newest answers with the
// call's own numbers next to each.

import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ADMIN_CALL_FEEDBACK_LIMIT,
  ADMIN_CALL_FEEDBACK_PERIODS,
  CALL_FEEDBACK_BAD_TAGS,
  CALL_FEEDBACK_GOOD_TAGS,
  type AdminCallFeedbackEntry,
  type AdminCallFeedbackPage,
  type AdminCallFeedbackQuery,
  type CallFeedbackTag
} from '@voice-room/shared/contracts/feedback';
import { CALL_FEEDBACK_TAG_LABELS } from '@voice-room/shared/feedback-labels';
import { fetchCallFeedback } from '../api/admin.ts';
import { formatCount, formatDateTime, formatMinutes, formatMs, formatPercent } from '../format.ts';
import { loadFailure, type LoadFailure } from '../load-state.ts';
import { Notice } from '../Notice.tsx';
import { Segment } from '../ui/index.tsx';
import './FeedbackPage.css';

type Period = (typeof ADMIN_CALL_FEEDBACK_PERIODS)[number];
type RatingFilter = 'all' | 'good' | 'bad';

const PERIOD_LABELS: Record<Period, string> = { '7': '7 дней', '30': '30 дней', '90': '90 дней', '365': 'Год' };
const RATING_OPTIONS: { value: RatingFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'good', label: 'Хорошие' },
  { value: 'bad', label: 'Плохие' }
];
const PLATFORM_LABELS: Record<AdminCallFeedbackEntry['platform'], string> = {
  browser: 'браузер',
  desktop_app: 'приложение',
  mobile: 'телефон'
};

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

function TagList({
  title,
  tags,
  of,
  tone,
  summary
}: {
  title: string;
  tags: readonly CallFeedbackTag[];
  of: number;
  tone: string;
  summary: AdminCallFeedbackPage['summary'];
}) {
  const count = (tag: CallFeedbackTag) => summary.tags.find((item) => item.tag === tag)?.count ?? 0;
  const rows = tags
    .map((tag) => ({ tag, count: count(tag), share: of ? (count(tag) / of) * 100 : 0 }))
    .sort((a, b) => b.count - a.count);
  return (
    <section className="feedback-tags" aria-label={title}>
      <h2>{title}</h2>
      <ul>
        {rows.map((row) => (
          <li key={row.tag}>
            <span className="feedback-tag-label">{CALL_FEEDBACK_TAG_LABELS[row.tag]}</span>
            <span className="feedback-tag-count">{formatCount(row.count)}</span>
            <span className="feedback-tag-bar" aria-hidden="true">
              <span style={{ width: `${row.share}%`, background: tone }} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function FeedbackPage() {
  const [period, setPeriod] = useState<Period>('30');
  const [rating, setRating] = useState<RatingFilter>('all');
  const [page, setPage] = useState<AdminCallFeedbackPage | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [loading, setLoading] = useState(false);
  // Only the reply to the latest choice is shown: an earlier, slower one is dropped.
  const latestLoad = useRef(0);

  const load = useCallback((days: Period, filter: RatingFilter) => {
    latestLoad.current += 1;
    const id = latestLoad.current;
    const query: AdminCallFeedbackQuery = { days, ...(filter === 'all' ? {} : { rating: filter }) };
    fetchCallFeedback(query)
      .then(
        (next) => {
          if (id !== latestLoad.current) return;
          setPage(next);
          setFailure(null);
        },
        (cause: unknown) => {
          if (id === latestLoad.current) setFailure(loadFailure(cause, 'Не удалось загрузить отзывы'));
        }
      )
      .finally(() => {
        if (id === latestLoad.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    load('30', 'all');
  }, [load]);

  // A choice by the person: the numbers are marked busy until its answer.
  function choose(nextPeriod: Period, nextRating: RatingFilter): void {
    setPeriod(nextPeriod);
    setRating(nextRating);
    setLoading(true);
    load(nextPeriod, nextRating);
  }

  const summary = page?.summary ?? null;
  const total = summary ? summary.good + summary.bad : 0;
  const goodShare = summary && total ? (summary.good / total) * 100 : null;

  return (
    <div className="feedback">
      <div className="feedback-controls">
        <Segment
          options={ADMIN_CALL_FEEDBACK_PERIODS.map((value) => ({ value, label: PERIOD_LABELS[value] }))}
          value={period}
          onChange={(next) => choose(next, rating)}
          ariaLabel="Период"
        />
        <Segment options={RATING_OPTIONS} value={rating} onChange={(next) => choose(period, next)} ariaLabel="Оценка" />
      </div>

      {failure && !page ? (
        <Notice failure={failure} onRetry={() => choose(period, rating)} />
      ) : !page || !summary ? (
        <p className="feedback-quiet" aria-busy="true">
          Загружаем…
        </p>
      ) : (
        <>
          {failure ? (
            <p className="feedback-error" role="alert">
              {failure.message}
            </p>
          ) : null}
          <section className="feedback-kpis" aria-label="Итог за период" aria-busy={loading}>
            <div className="feedback-kpi">
              <span className="feedback-kpi-label">Довольны звонком</span>
              <span className="feedback-kpi-value">{formatPercent(goodShare)}</span>
              <span className="feedback-kpi-hint">из {formatCount(total)} ответов</span>
            </div>
            <div className="feedback-kpi">
              <span className="feedback-kpi-label">Хорошо</span>
              <span className="feedback-kpi-value is-good">{formatCount(summary.good)}</span>
            </div>
            <div className="feedback-kpi">
              <span className="feedback-kpi-label">Плохо</span>
              <span className="feedback-kpi-value is-bad">{formatCount(summary.bad)}</span>
            </div>
          </section>

          <div className="feedback-tag-columns">
            <TagList
              title="Что мешало"
              tags={CALL_FEEDBACK_BAD_TAGS}
              of={summary.bad}
              tone="var(--vr-danger)"
              summary={summary}
            />
            <TagList
              title="Что понравилось"
              tags={CALL_FEEDBACK_GOOD_TAGS}
              of={summary.good}
              tone="var(--vr-success)"
              summary={summary}
            />
          </div>

          {page.entries.length === 0 ? (
            <p className="feedback-quiet">За этот период ответов нет.</p>
          ) : (
            <>
              <ul className="feedback-list" aria-label="Ответы">
                {page.entries.map((entry) => (
                  <li key={entry.id} className="feedback-entry">
                    <div className="feedback-entry-head">
                      <span className="feedback-rating" data-rating={entry.rating}>
                        {entry.rating === 'good' ? (
                          <>
                            <ThumbsUp size={14} aria-hidden="true" /> Хорошо
                          </>
                        ) : (
                          <>
                            <ThumbsDown size={14} aria-hidden="true" /> Плохо
                          </>
                        )}
                      </span>
                      <span>{entry.author ? `${entry.author.displayName} (@${entry.author.login})` : 'Гость'}</span>
                      <span>{formatDateTime(entry.createdAt)}</span>
                    </div>
                    <div className="feedback-entry-call">
                      {`${entry.roomName ? `«${entry.roomName}»` : 'временная комната'} · ${formatMinutes(entry.durationS / 60)} · собеседников ${entry.peers} · ${PLATFORM_LABELS[entry.platform]}`}
                      {entry.quality ? (
                        <>
                          <br />
                          <span className="feedback-entry-quality">{qualityLine(entry)}</span>
                        </>
                      ) : null}
                    </div>
                    {entry.tags.length ? (
                      <ul className="feedback-entry-tags">
                        {entry.tags.map((tag) => (
                          <li key={tag}>{CALL_FEEDBACK_TAG_LABELS[tag]}</li>
                        ))}
                      </ul>
                    ) : null}
                    {entry.comment ? <p className="feedback-entry-comment">{entry.comment}</p> : null}
                  </li>
                ))}
              </ul>
              {page.entries.length >= ADMIN_CALL_FEEDBACK_LIMIT ? (
                <p className="feedback-quiet">Показаны последние {ADMIN_CALL_FEEDBACK_LIMIT} ответов за период.</p>
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  );
}
