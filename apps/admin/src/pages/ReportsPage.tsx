// The review of open reports: each shows the message as it stands now, and one
// decision closes every report of that message.

import { useEffect, useState } from 'react';
import type { AdminReport } from '@voice-room/shared/contracts/reports';
import { REPORT_REASON_LABELS } from '@voice-room/shared/report-labels';
import { fetchOpenReports, resolveReport } from '../api/admin.ts';
import { loadFailure, type LoadFailure } from '../load-state.ts';
import { Notice } from '../Notice.tsx';
import { Button } from '../ui/index.tsx';
import './ReportsPage.css';

const dateTime = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });

const formatDate = (value: number | null) => (value ? dateTime.format(value) : 'время неизвестно');

export function ReportsPage({ onResolved }: { onResolved: (openLeft: number) => void }) {
  const [reports, setReports] = useState<AdminReport[] | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  // Bumped by "Повторить" to ask again.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    fetchOpenReports().then(
      (loaded) => {
        if (current) setReports(loaded);
      },
      (cause: unknown) => {
        if (current) setFailure(loadFailure(cause, 'Не удалось загрузить жалобы'));
      }
    );
    return () => {
      current = false;
    };
  }, [attempt]);

  function retry(): void {
    setFailure(null);
    setError('');
    setAttempt((value) => value + 1);
  }

  // The panel's count of open reports follows what is shown.
  useEffect(() => {
    if (reports) onResolved(reports.length);
  }, [reports, onResolved]);

  async function decide(report: AdminReport, action: 'remove_message' | 'dismiss'): Promise<void> {
    if (busyId) return;
    setBusyId(report.id);
    setError('');
    try {
      await resolveReport(report.id, action);
      // The server closed every open report of the same message.
      setReports((current) =>
        (current ?? []).filter(
          (other) => other.target.kind !== report.target.kind || other.target.messageId !== report.target.messageId
        )
      );
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : 'Не удалось закрыть жалобу');
    } finally {
      setBusyId(null);
    }
  }

  if (failure) return <Notice failure={failure} onRetry={retry} />;
  if (!reports) {
    return (
      <p className="reports-note" aria-busy="true">
        Загружаем жалобы…
      </p>
    );
  }

  return (
    <div className="reports">
      {error ? (
        <p className="reports-error" role="alert">
          {error}
        </p>
      ) : null}
      {reports.length === 0 ? (
        <p className="reports-note">Открытых жалоб нет.</p>
      ) : (
        <ul className="reports-list">
          {reports.map((report) => (
            <li key={report.id} className="report-card">
              <div className="report-meta">
                <strong>{REPORT_REASON_LABELS[report.reason]}</strong>
                <span>
                  {report.target.kind === 'room_message'
                    ? `Комната «${report.target.roomName || report.target.roomId}»`
                    : 'Личное сообщение'}
                </span>
                <span>
                  от {report.reporter.displayName} (@{report.reporter.login}), {formatDate(report.createdAt)}
                </span>
              </div>
              <blockquote className={report.target.deleted ? 'report-message is-deleted' : 'report-message'}>
                <span className="report-author">
                  {report.target.authorName || 'Без имени'} · {formatDate(report.target.sentAt)}
                  {report.target.deleted ? ' · уже удалено' : ''}
                </span>
                <span className="report-text">{report.target.text || '(без текста)'}</span>
              </blockquote>
              {report.comment ? <p className="report-comment">Комментарий: {report.comment}</p> : null}
              <div className="report-actions">
                <Button variant="ghost" disabled={busyId !== null} onClick={() => void decide(report, 'dismiss')}>
                  Отклонить
                </Button>
                <Button
                  variant="danger"
                  disabled={busyId !== null || report.target.deleted}
                  onClick={() => void decide(report, 'remove_message')}
                >
                  Удалить сообщение
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
