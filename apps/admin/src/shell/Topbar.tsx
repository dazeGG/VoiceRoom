// The bar over every section: where you are, the search over accounts and
// rooms, and how fresh the section's numbers are with a button to ask again.

import { ChevronRight, RefreshCw } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { RefreshStatus } from '../frame.tsx';

/** "каждые 5 с", "каждые 30 с", "каждую минуту". */
export function formatEvery(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds === 60) return 'каждую минуту';
  if (seconds % 60 === 0) return `каждые ${seconds / 60} мин`;
  return `каждые ${seconds} с`;
}

/** "только что", "8 с назад", "3 мин назад". */
export function formatFresh(at: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 1) return 'только что';
  if (seconds < 60) return `${seconds} с назад`;
  return `${Math.floor(seconds / 60)} мин назад`;
}

function Freshness({ status }: { status: RefreshStatus }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="top-fresh">
      <span className="top-fresh-text">
        <span className="top-fresh-dot" aria-hidden="true" />
        <span className="top-fresh-ago">
          {status.at === null ? 'Загружаем…' : `Обновлено ${formatFresh(status.at, Math.max(now, status.at))}`}
        </span>
        <span className="top-fresh-every">· {formatEvery(status.everyMs)}</span>
      </span>
      <button
        type="button"
        className="top-refresh"
        aria-label="Обновить"
        title="Обновить"
        data-busy={status.busy}
        onClick={status.reload}
      >
        <RefreshCw size={15} aria-hidden="true" />
      </button>
    </div>
  );
}

export function Topbar({
  crumb,
  title,
  search,
  refresh
}: {
  crumb: string;
  title: string;
  search: ReactNode;
  refresh: RefreshStatus | null;
}) {
  return (
    <header className="top">
      <div className="top-where">
        <span className="top-crumb">{crumb}</span>
        <ChevronRight size={14} className="top-crumb-sep" aria-hidden="true" />
        <h1 className="top-title">{title}</h1>
      </div>
      {search}
      {refresh ? <Freshness status={refresh} /> : <span className="top-fresh" />}
    </header>
  );
}
