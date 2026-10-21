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
import './ProductPage.css';

export function ProductPage() {
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
    <div className="product-toolbar">
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
      <div className="product-charts">
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

      <section className="product-retention" aria-label="Возвращаемость">
        <h2>Возвращаемость по неделе регистрации</h2>
        {stats.retention.length === 0 ? (
          <p className="product-quiet">Пока нет аккаунтов.</p>
        ) : (
          <div className="product-table-wrap">
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
                    <td>{week.accounts}</td>
                    <td>{week.returnedWeek1Pct}%</td>
                    <td>{week.returnedWeek2Pct}%</td>
                    <td>{week.returnedMonth1Pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="product-quiet">
          Доля аккаунтов недели, которые снова заходили в этот промежуток после регистрации. {trackingNote} У более
          ранних недель проценты занижены.
        </p>
      </section>
    </>
  );
}
