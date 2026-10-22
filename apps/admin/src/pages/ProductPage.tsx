// How the product changes day by day: people, messages, rooms, voice, peaks,
// and whether newly registered accounts come back.

import { useEffect, useState } from 'react';
import type { ProductDay, ProductStats } from '@voice-room/shared/contracts/admin';
import { fetchProductStats } from '../api/admin.ts';
import { TimeChart } from '../charts/TimeChart.tsx';
import { formatDay, formatHours } from '../format.ts';
import { loadFailure, type LoadFailure } from '../load-state.ts';
import { Notice } from '../Notice.tsx';
import { PRODUCT_PRESETS, productQuery, type TimeRange } from '../time-range.ts';
import { TimeRangePicker } from '../TimeRangePicker.tsx';
import { Empty, Panel } from '../ui/index.tsx';
import './ProductPage.css';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The spans after registration the cohort table counts returns in, by the first day each starts on. */
const RETENTION_SPANS: readonly {
  key: 'returnedWeek1Pct' | 'returnedWeek2Pct' | 'returnedMonth1Pct';
  firstDay: number;
}[] = [
  { key: 'returnedWeek1Pct', firstDay: 1 },
  { key: 'returnedWeek2Pct', firstDay: 8 },
  { key: 'returnedMonth1Pct', firstDay: 15 }
];

/** Whether a span has begun for the week's first accounts: before that its 0% means nothing yet. */
const reached = (week: string, firstDay: number, now: number) =>
  Date.parse(`${week}T00:00:00+03:00`) + firstDay * DAY_MS <= now;

/** A share as a warm cell: the more came back, the stronger the accent behind it. */
function RetentionCell({ value, reached: begun }: { value: number; reached: boolean }) {
  if (!begun) return <span className="retention-cell retention-cell--none">—</span>;
  const strength = 6 + Math.min(1, value / 55) * 50;
  return (
    <span className="retention-cell" style={{ '--heat': `${String(strength)}%` }}>
      {value}%
    </span>
  );
}

export function ProductPage() {
  const [now] = useState(() => Date.now());
  const [range, setRange] = useState<TimeRange>({ kind: 'preset', id: '30d' });
  const [stats, setStats] = useState<ProductStats | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // A slower answer for a range already left behind is dropped.
    let current = true;
    fetchProductStats(productQuery(range, PRODUCT_PRESETS, Date.now())).then(
      (loaded) => {
        if (!current) return;
        setStats(loaded);
        setFailure(null);
        setLoading(false);
      },
      (cause: unknown) => {
        if (!current) return;
        setFailure(loadFailure(cause, 'Не удалось загрузить статистику'));
        setLoading(false);
      }
    );
    return () => {
      current = false;
    };
  }, [range, attempt]);

  function change(next: TimeRange): void {
    setRange(next);
    setLoading(true);
  }

  function retry(): void {
    setLoading(true);
    setAttempt((count) => count + 1);
  }

  const resolved = stats ? { from: Date.parse(`${stats.from}T12:00`), to: Date.parse(`${stats.to}T12:00`) } : null;

  const toolbar = (
    <div className="ui-toolbar">
      <TimeRangePicker value={range} presets={PRODUCT_PRESETS} withTime={false} onChange={change} resolved={resolved} />
      {loading && stats ? <span className="product-quiet">Обновляем…</span> : null}
    </div>
  );

  if (failure && !stats) {
    return (
      <>
        {toolbar}
        <Notice failure={failure} onRetry={retry} />
      </>
    );
  }
  if (!stats) {
    return (
      <>
        {toolbar}
        <p className="product-quiet" aria-busy="true">
          Загружаем…
        </p>
      </>
    );
  }

  const days = stats.days;
  const labels = days.map((day) => formatDay(day.day));
  const pick = (key: keyof Omit<ProductDay, 'day'>) => days.map((day) => day[key]);
  const totalAccounts = days.reduce<number[]>((totals, day) => {
    totals.push((totals.at(-1) ?? stats.accountsBefore) + day.newAccounts);
    return totals;
  }, []);
  const trackingNote = `Учёт идёт с ${formatDay(stats.trackingSince)}.${stats.trackingSince.slice(0, 4)}.`;

  return (
    <>
      {toolbar}
      <div className="ui-grid" style={{ '--grid-min': '480px' }}>
        <TimeChart
          title="Активные аккаунты"
          labels={labels}
          series={[
            { name: 'Всего', values: pick('activeAccounts'), color: 'var(--vr-accent)' },
            { name: 'Приложение', values: pick('desktopApp'), color: 'var(--vr-success)' },
            { name: 'Браузер', values: pick('browser'), color: 'var(--vr-info)' },
            { name: 'Телефон', values: pick('mobile'), color: 'var(--vr-warning)' }
          ]}
          note={`Один аккаунт за день может зайти с нескольких клиентов. ${trackingNote}`}
        />
        <TimeChart
          title="Аккаунты"
          labels={labels}
          series={[{ name: 'Всего аккаунтов', values: totalAccounts, color: 'var(--vr-accent)' }]}
          note="Нарастающим итогом, включая позже удалённые."
        />
        <TimeChart
          title="Регистрации"
          kind="bar"
          labels={labels}
          series={[{ name: 'Новых аккаунтов', values: pick('newAccounts'), color: 'var(--vr-accent)' }]}
        />
        <TimeChart
          title="Сообщения"
          kind="bar"
          labels={labels}
          series={[
            { name: 'В комнатах', values: pick('roomMessages'), color: 'var(--vr-accent)' },
            { name: 'В личке', values: pick('directMessages'), color: 'var(--vr-info)' }
          ]}
          note="Включая удалённые позже. Гости пишут без аккаунта."
        />
        <TimeChart
          title="Созданные комнаты"
          kind="bar"
          labels={labels}
          series={[
            { name: 'Постоянные', values: pick('staticRoomsCreated'), color: 'var(--vr-accent)' },
            { name: 'Временные', values: pick('temporaryRoomsCreated'), color: 'var(--vr-warning)' }
          ]}
        />
        <TimeChart
          title="Часы в войсе"
          kind="bar"
          labels={labels}
          format={formatHours}
          series={[
            { name: 'Аккаунты', values: pick('voiceAccountHours'), color: 'var(--vr-success)' },
            { name: 'Гости', values: pick('voiceGuestHours'), color: 'var(--vr-warning)' }
          ]}
          note={`Заход относится к дню, в который начался. ${trackingNote}`}
        />
        <TimeChart
          title="Заходы в войс"
          labels={labels}
          series={[
            { name: 'Заходов', values: pick('voiceJoins'), color: 'var(--vr-accent)' },
            { name: 'Аккаунтов в войсе', values: pick('voiceAccounts'), color: 'var(--vr-success)' }
          ]}
        />
        <TimeChart
          title="Пики онлайна за день"
          labels={labels}
          series={[
            { name: 'Аккаунтов', values: pick('peakOnline'), color: 'var(--vr-accent)' },
            { name: 'Гостей', values: pick('peakGuests'), color: 'var(--vr-warning)' },
            { name: 'В войсе', values: pick('peakVoicePeers'), color: 'var(--vr-success)' }
          ]}
          note={`Наибольшее число одновременно за день, по замерам каждые 15 минут. ${trackingNote}`}
        />
      </div>

      <Panel title="Возвращаемость по неделе регистрации" flush>
        {stats.retention.length === 0 ? (
          <Empty>Пока нет аккаунтов.</Empty>
        ) : (
          <div className="ui-table-scroll">
            <table className="product-table">
              <thead>
                <tr>
                  <th scope="col">Неделя</th>
                  <th scope="col">Аккаунтов</th>
                  <th scope="col">Вернулись на 1–7 день</th>
                  <th scope="col">На 8–14 день</th>
                  <th scope="col">На 15–30 день</th>
                </tr>
              </thead>
              <tbody>
                {stats.retention.map((week) => (
                  <tr key={week.week}>
                    <td>с {formatDay(week.week)}</td>
                    <td className="ui-num">{week.accounts}</td>
                    {RETENTION_SPANS.map((span) => (
                      <td key={span.firstDay}>
                        <RetentionCell value={week[span.key]} reached={reached(week.week, span.firstDay, now)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="ui-footnote product-footnote">
          Доля аккаунтов недели, которые снова заходили в этот промежуток после регистрации; «—» — промежуток ещё не
          наступил. {trackingNote} У более ранних недель проценты занижены.
        </p>
      </Panel>
    </>
  );
}
