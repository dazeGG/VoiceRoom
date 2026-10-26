// Answers to "how was the call?": how many calls went well over the period,
// what people liked and what got in the way, and the newest answers in a
// table with the call's own numbers next to each, the bad ones in red: who
// answered (a guest by the name they gave) from what device and where, the
// averages and the worst moments, and the stay's network on a bar.

import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { useState } from 'react';
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
import { CONCEALMENT_THRESHOLDS, networkLevelOfValue, type NetworkMeasure } from '@voice-room/shared/network-quality';
import { fetchCallFeedback } from '../api/admin.ts';
import { formatCount, formatDateTime, formatMinutes, formatMs, formatPercent } from '../format.ts';
import { useAdminResource } from '../load-state.ts';
import { Notice } from '../Notice.tsx';
import { Empty, Panel, Pill, Segment } from '../ui/index.tsx';
import { NetworkSpan, describeNetwork } from './rooms/network-bar.tsx';
import { Origin } from './rooms/room-bits.tsx';
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

/**
 * Where a call's numbers turn red, by the thresholds the room's connection pill
 * uses too: an average past unstable, a worst moment past bad (one spike in a
 * long call is normal), audible concealment, any reconnect, and a call through
 * the TURN relay. A busy computer alone is not red: the pressure reading is the
 * whole system's, and a game keeps it high through calls that sound fine.
 */
const averageBad = (measure: NetworkMeasure, value: number | null | undefined) => {
  const level = networkLevelOfValue(measure, value);
  return level === 'unstable' || level === 'bad';
};
const peakBad = (measure: NetworkMeasure, value: number | null | undefined) =>
  networkLevelOfValue(measure, value) === 'bad';

const worse = (a: number | null | undefined, b: number | null | undefined) =>
  a == null && b == null ? null : Math.max(a ?? 0, b ?? 0);

function Quality({ quality }: { quality: NonNullable<AdminCallFeedbackEntry['quality']> }) {
  const loss = Math.max(quality.inboundLossAvgPct ?? 0, quality.outboundLossAvgPct ?? 0);
  const lossPeak = worse(quality.inboundLossMaxPct, quality.outboundLossMaxPct);
  const rttPeak = quality.rttMaxMs ?? null;
  const jitterPeak = quality.jitterMaxMs ?? null;
  const counted = (lost: number | undefined, packets: number | undefined, way: string) =>
    packets === undefined || lost === undefined
      ? null
      : `${way}: потеряно ${formatCount(lost)} из ${formatCount(packets)} пакетов`;
  const lossCounts = [
    counted(quality.inboundLostPackets, quality.inboundPackets, 'к вам'),
    counted(quality.outboundLostPackets, quality.outboundPackets, 'от вас')
  ].filter((line): line is string => line !== null);
  const parts: { text: string; bad: boolean; title?: string }[] = [
    {
      text: `пинг ${formatMs(quality.rttAvgMs)}${rttPeak === null ? '' : ` (до ${formatMs(rttPeak)})`}`,
      bad: averageBad('rttMs', quality.rttAvgMs) || peakBad('rttMs', rttPeak)
    },
    {
      text: `потери ${formatPercent(loss)}${lossPeak === null ? '' : ` (до ${formatPercent(lossPeak)})`}`,
      bad: averageBad('lossPct', loss) || peakBad('lossPct', lossPeak),
      ...(lossCounts.length ? { title: lossCounts.join('\n') } : {})
    }
  ];
  const concealed = quality.concealedAvgPct ?? null;
  if (concealed !== null) {
    const peak = quality.concealedMaxPct ?? null;
    parts.push({
      text: `звук додуман ${formatPercent(concealed)}${peak === null ? '' : ` (до ${formatPercent(peak)})`}`,
      bad: concealed >= CONCEALMENT_THRESHOLDS.noticeablePct || (peak ?? 0) >= CONCEALMENT_THRESHOLDS.badPct,
      title: 'Доля звука, которую плееру пришлось достроить: пакеты пришли поздно или не пришли'
    });
  }
  if (quality.jitterAvgMs !== null) {
    parts.push({
      text: `джиттер ${formatMs(quality.jitterAvgMs)}${jitterPeak === null ? '' : ` (до ${formatMs(jitterPeak)})`}`,
      bad: averageBad('jitterMs', quality.jitterAvgMs) || peakBad('jitterMs', jitterPeak)
    });
  }
  if (quality.reconnects) parts.push({ text: `переподкл. ${quality.reconnects}`, bad: true });
  if (quality.micDrops) parts.push({ text: `микрофон отключался ${quality.micDrops}`, bad: true });
  if (quality.cpuPressureMax === 'critical' || quality.cpuPressureMax === 'serious') {
    parts.push({
      text: quality.cpuRelieved ? 'система загружена · облегчённый шумодав' : 'система загружена',
      bad: false,
      title: 'Загрузка всего компьютера, не только звонка: например, шла игра'
    });
  }
  if (quality.transport === 'relay') parts.push({ text: 'TURN', bad: true });
  if (quality.transport === 'tcp') parts.push({ text: 'TCP', bad: false });
  return (
    <span className="feedback-quality ui-mono">
      {parts.map((part) => (
        <span key={part.text} data-bad={part.bad} title={part.title}>
          {part.text}
        </span>
      ))}
    </span>
  );
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
  tone: 'danger' | 'success';
  summary: AdminCallFeedbackPage['summary'];
}) {
  const count = (tag: CallFeedbackTag) => summary.tags.find((item) => item.tag === tag)?.count ?? 0;
  const rows = tags
    .map((tag) => ({ tag, count: count(tag), share: of ? (count(tag) / of) * 100 : 0 }))
    .sort((a, b) => b.count - a.count);
  return (
    <Panel title={title}>
      <ul className="feedback-tags" data-tone={tone}>
        {rows.map((row) => (
          <li key={row.tag}>
            <span className="feedback-tag-line">
              <span className="feedback-tag-label">{CALL_FEEDBACK_TAG_LABELS[row.tag]}</span>
              <span className="feedback-tag-count">
                {formatCount(row.count)} <small>{formatPercent(row.share)}</small>
              </span>
            </span>
            <span className="feedback-tag-bar" aria-hidden="true">
              <span style={{ width: `${String(row.share)}%` }} />
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function FeedbackPage() {
  const [period, setPeriod] = useState<Period>('30');
  const [rating, setRating] = useState<RatingFilter>('all');
  // Only the reply to the latest choice is shown: an earlier, slower one is dropped. A choice
  // marks the numbers busy until its answer.
  const {
    data: page,
    failure,
    busy: loading,
    reload
  } = useAdminResource(
    () => {
      const query: AdminCallFeedbackQuery = { days: period, ...(rating === 'all' ? {} : { rating }) };
      return fetchCallFeedback(query);
    },
    [period, rating],
    { failureText: 'Не удалось загрузить отзывы' }
  );

  const summary = page?.summary ?? null;
  const total = summary ? summary.good + summary.bad : 0;
  const goodShare = summary && total ? (summary.good / total) * 100 : null;

  return (
    <>
      <div className="ui-toolbar">
        <Segment
          options={ADMIN_CALL_FEEDBACK_PERIODS.map((value) => ({ value, label: PERIOD_LABELS[value] }))}
          value={period}
          onChange={setPeriod}
          ariaLabel="Период"
        />
        <Segment options={RATING_OPTIONS} value={rating} onChange={setRating} ariaLabel="Оценка" />
      </div>

      {failure && !page ? (
        <Notice failure={failure} onRetry={reload} />
      ) : !page || !summary ? (
        <p className="ui-empty" aria-busy="true">
          Загружаем…
        </p>
      ) : (
        <>
          {failure ? (
            <p className="admin-error" role="alert">
              {failure.message}
            </p>
          ) : null}
          <div className="ui-grid feedback-cards" style={{ '--grid-min': '320px' }} aria-busy={loading}>
            <Panel title="Довольны звонком">
              <div className="feedback-score">
                <span className="feedback-score-value">{formatPercent(goodShare)}</span>
                <span className="feedback-score-of">из {formatCount(total)} ответов</span>
              </div>
              <span className="feedback-split" aria-hidden="true">
                <span style={{ width: `${String(goodShare ?? 0)}%` }} />
              </span>
              <div className="feedback-counts">
                <span className="feedback-count" data-rating="good">
                  <ThumbsUp size={16} aria-hidden="true" />
                  Хорошо <strong>{formatCount(summary.good)}</strong>
                </span>
                <span className="feedback-count" data-rating="bad">
                  <ThumbsDown size={16} aria-hidden="true" />
                  Плохо <strong>{formatCount(summary.bad)}</strong>
                </span>
              </div>
            </Panel>
            <TagList
              title="Что мешало"
              tags={CALL_FEEDBACK_BAD_TAGS}
              of={summary.bad}
              tone="danger"
              summary={summary}
            />
            <TagList
              title="Что понравилось"
              tags={CALL_FEEDBACK_GOOD_TAGS}
              of={summary.good}
              tone="success"
              summary={summary}
            />
          </div>

          <Panel title="Ответы" flush>
            {page.entries.length === 0 ? (
              <Empty>За этот период ответов нет</Empty>
            ) : (
              <div className="ui-table-scroll">
                <table className="feedback-table" aria-label="Ответы">
                  <thead>
                    <tr>
                      <th scope="col">Оценка</th>
                      <th scope="col">Кто</th>
                      <th scope="col">Звонок</th>
                      <th scope="col">Связь</th>
                      <th scope="col">Отзыв</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.entries.map((entry) => (
                      <tr key={entry.id}>
                        <td>
                          {entry.rating === 'good' ? (
                            <Pill tone="success" compact>
                              <ThumbsUp size={12} aria-hidden="true" /> Хорошо
                            </Pill>
                          ) : (
                            <Pill tone="danger" compact>
                              <ThumbsDown size={12} aria-hidden="true" /> Плохо
                            </Pill>
                          )}
                        </td>
                        <td>
                          <span className="feedback-who">
                            {entry.author ? (
                              <span>
                                {entry.author.displayName} · <span className="ui-mono">@{entry.author.login}</span>
                              </span>
                            ) : (
                              <span className="feedback-guest">
                                {entry.stay?.guestName ?? 'Гость'}
                                <Pill compact>гость</Pill>
                              </span>
                            )}
                            <small>{formatDateTime(entry.createdAt)}</small>
                            {entry.stay ? <Origin seat={entry.stay} /> : null}
                          </span>
                        </td>
                        <td>
                          <span className="feedback-who">
                            <span>{entry.roomName ? `«${entry.roomName}»` : 'временная комната'}</span>
                            <small>
                              {`${formatMinutes(entry.durationS / 60)} · собеседников ${entry.peers} · ${PLATFORM_LABELS[entry.platform]}`}
                            </small>
                          </span>
                        </td>
                        <td>
                          <span className="feedback-network">
                            {entry.quality ? (
                              <Quality quality={entry.quality} />
                            ) : (
                              <span className="feedback-none">—</span>
                            )}
                            {entry.stay ? (
                              <span
                                className="feedback-network-bar"
                                role="img"
                                aria-label={describeNetwork(
                                  { from: entry.stay.joinedAt, to: entry.stay.leftAt },
                                  entry.stay.network ?? []
                                )}
                              >
                                <NetworkSpan
                                  from={entry.stay.joinedAt}
                                  to={entry.stay.leftAt}
                                  points={entry.stay.network ?? []}
                                  style={{ left: 0, right: 0 }}
                                />
                              </span>
                            ) : null}
                          </span>
                        </td>
                        <td>
                          <span className="feedback-review">
                            {entry.tags.length ? (
                              <span className="feedback-review-tags">
                                {entry.tags.map((tag) => (
                                  <Pill key={tag} compact>
                                    {CALL_FEEDBACK_TAG_LABELS[tag]}
                                  </Pill>
                                ))}
                              </span>
                            ) : null}
                            {entry.comment ? <span className="feedback-comment">{entry.comment}</span> : null}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {page.entries.length >= ADMIN_CALL_FEEDBACK_LIMIT ? (
              <p className="ui-footnote feedback-footnote">
                Показаны последние {ADMIN_CALL_FEEDBACK_LIMIT} ответов за период.
              </p>
            ) : null}
          </Panel>
        </>
      )}
    </>
  );
}
