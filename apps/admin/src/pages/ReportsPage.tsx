// The review of open reports: a list on the left, one card per reported
// message (×2 when it was reported twice), and the chosen one on the right
// with the message as it stands now. One decision closes every report of that
// message. The list asks again every minute.

import { Flag, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AdminReport } from '@voice-room/shared/contracts/reports';
import { REPORT_REASON_LABELS } from '@voice-room/shared/report-labels';
import { fetchOpenReports, resolveReport } from '../api/admin.ts';
import { formatCount, formatDateTime, plural } from '../format.ts';
import { useRefreshStatus } from '../frame.tsx';
import { useAdminResource } from '../load-state.ts';
import { Notice } from '../Notice.tsx';
import { Avatar, Button, Empty, Pill } from '../ui/index.tsx';
import './ReportsPage.css';
import { UserReports } from './UserReports.tsx';

const REFRESH_MS = 60_000;

/** Every open report of one message, the newest first. */
interface ReportedMessage {
  key: string;
  reports: AdminReport[];
  latest: AdminReport;
}

const keyOf = (report: AdminReport) => `${report.target.kind}:${report.target.messageId}`;

/** The reports by message, in the order the newest report of each came in. */
function byMessage(reports: readonly AdminReport[]): ReportedMessage[] {
  const groups = new Map<string, AdminReport[]>();
  for (const report of [...reports].sort((a, b) => b.createdAt - a.createdAt)) {
    const key = keyOf(report);
    const group = groups.get(key);
    if (group) group.push(report);
    else groups.set(key, [report]);
  }
  return [...groups.entries()].flatMap(([key, group]) => {
    const latest = group[0];
    return latest ? [{ key, reports: group, latest }] : [];
  });
}

const placeOf = (report: AdminReport) =>
  report.target.kind === 'room_message'
    ? `Комната «${report.target.roomName || report.target.roomId}»`
    : 'Личное сообщение';

const formatWhen = (value: number | null) => (value ? formatDateTime(value) : 'время неизвестно');

const reportsWord = (count: number) => `${formatCount(count)} ${plural(count, ['жалоба', 'жалобы', 'жалоб'])}`;

export function ReportsPage({
  onResolved,
  onOpenAccount
}: {
  onResolved: (openLeft: number) => void;
  onOpenAccount: (accountId: string) => void;
}) {
  const [messageCount, setMessageCount] = useState<number | null>(null);
  const [userCount, setUserCount] = useState<number | null>(null);
  useEffect(() => {
    if (messageCount !== null && userCount !== null) onResolved(messageCount + userCount);
  }, [messageCount, userCount, onResolved]);
  return (
    <>
      <MessageReports onResolved={setMessageCount} onOpenAccount={onOpenAccount} />
      <UserReports onResolved={setUserCount} onOpenAccount={onOpenAccount} />
    </>
  );
}

function MessageReports({
  onResolved,
  onOpenAccount
}: {
  onResolved: (openLeft: number) => void;
  onOpenAccount: (accountId: string) => void;
}) {
  const {
    data: reports,
    failure,
    busy: loading,
    loadedAt,
    reload: load,
    update: updateReports
  } = useAdminResource(fetchOpenReports, [], { failureText: 'Не удалось загрузить жалобы', refreshMs: REFRESH_MS });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  useRefreshStatus({ at: loadedAt, everyMs: REFRESH_MS, busy: loading, reload: load });

  // The panel's count of open reports follows what is shown.
  useEffect(() => {
    if (reports) onResolved(reports.length);
  }, [reports, onResolved]);

  async function decide(message: ReportedMessage, action: 'remove_message' | 'dismiss'): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await resolveReport(message.latest.id, action);
      // The server closed every open report of the same message.
      updateReports((current) => (current ?? []).filter((other) => keyOf(other) !== message.key));
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : 'Не удалось закрыть жалобу');
    } finally {
      setBusy(false);
    }
  }

  if (failure && !reports) return <Notice failure={failure} onRetry={load} />;
  if (!reports) {
    return (
      <p className="ui-empty" aria-busy="true">
        Загружаем жалобы…
      </p>
    );
  }

  const messages = byMessage(reports);
  // The chosen message, or the first once it is decided or before any is chosen.
  const current = messages.find((message) => message.key === selected) ?? messages[0] ?? null;

  return (
    <div className="reports">
      <section className="reports-list" aria-labelledby="reports-open-title">
        <header className="reports-list-head">
          <h2 id="reports-open-title">Открытые</h2>
          {reports.length ? <Pill tone="danger">{formatCount(reports.length)}</Pill> : null}
          <span className="ui-section-note">сначала новые</span>
        </header>
        {messages.length === 0 ? (
          <div className="ui-panel">
            <Empty>Открытых жалоб нет</Empty>
          </div>
        ) : (
          <ul className="reports-cards" aria-label="Открытые жалобы">
            {messages.map((message) => {
              const report = message.latest;
              return (
                <li key={message.key}>
                  <button
                    type="button"
                    className="report-card"
                    aria-pressed={message.key === current?.key}
                    onClick={() => setSelected(message.key)}
                  >
                    <span className="report-card-top">
                      <Pill tone="danger" compact>
                        {REPORT_REASON_LABELS[report.reason]}
                      </Pill>
                      {message.reports.length > 1 ? (
                        <span className="report-card-many" aria-label={reportsWord(message.reports.length)}>
                          ×{message.reports.length}
                        </span>
                      ) : null}
                      <span className="report-card-when">{formatWhen(report.createdAt)}</span>
                    </span>
                    <span className="report-card-text" data-deleted={report.target.deleted}>
                      {report.target.text || '(без текста)'}
                    </span>
                    <span className="report-card-place">
                      {placeOf(report)} · {report.target.authorName || 'Без имени'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {current ? (
        <section className="ui-panel report-detail" aria-labelledby="report-detail-title">
          <header className="report-detail-head">
            <div className="report-detail-title">
              <h2 id="report-detail-title">{REPORT_REASON_LABELS[current.latest.reason]}</h2>
              {current.reports.length > 1 ? (
                <Pill tone="danger">{reportsWord(current.reports.length)} на это сообщение</Pill>
              ) : null}
            </div>
            <p className="report-detail-meta">
              {placeOf(current.latest)} · жалоба от {current.latest.reporter.displayName}{' '}
              <span className="ui-mono">@{current.latest.reporter.login}</span> · {formatWhen(current.latest.createdAt)}
            </p>
          </header>

          <div className="report-message">
            <Avatar name={current.latest.target.authorName || '?'} size={36} />
            <div className="report-message-body">
              <span className="report-message-author">
                <strong>{current.latest.target.authorName || 'Без имени'}</strong> ·{' '}
                {formatWhen(current.latest.target.sentAt)}
                {current.latest.target.deleted ? <span className="report-gone"> · уже удалено</span> : null}
              </span>
              <p className="report-bubble" data-deleted={current.latest.target.deleted}>
                {current.latest.target.text || '(без текста)'}
              </p>
            </div>
          </div>

          {current.reports.some((report) => report.comment) || current.reports.length > 1 ? (
            <div className="report-comments">
              <span className="report-comments-label">
                {current.reports.length > 1 ? 'Жалобы' : 'Комментарий к жалобе'}
              </span>
              <ul>
                {current.reports.map((report) => (
                  <li key={report.id}>
                    {current.reports.length > 1 ? (
                      <span className="report-comments-who">
                        <Flag size={12} aria-hidden="true" /> {report.reporter.displayName} ·{' '}
                        {REPORT_REASON_LABELS[report.reason]} · {formatWhen(report.createdAt)}
                      </span>
                    ) : null}
                    {report.comment ? <span className="report-comments-text">{report.comment}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {error ? (
            <p className="admin-error" role="alert">
              {error}
            </p>
          ) : null}

          <footer className="report-actions">
            {current.latest.target.authorUserId ? (
              <Button
                variant="ghost"
                onClick={() => current.latest.target.authorUserId && onOpenAccount(current.latest.target.authorUserId)}
              >
                <UserRound size={16} aria-hidden="true" />
                Аккаунт автора
              </Button>
            ) : null}
            <span className="report-actions-note">Решение закроет все жалобы на это сообщение</span>
            <Button disabled={busy} onClick={() => void decide(current, 'dismiss')}>
              Отклонить
            </Button>
            <Button
              variant="danger"
              disabled={busy || current.latest.target.deleted}
              onClick={() => void decide(current, 'remove_message')}
            >
              Удалить сообщение
            </Button>
          </footer>
        </section>
      ) : null}
    </div>
  );
}
