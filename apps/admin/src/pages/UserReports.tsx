// User review is deliberately separate from message removal and account sanctions.
import { useEffect, useState } from 'react';
import type { AdminUserReport, UserReportResolveBody } from '@voice-room/shared/contracts/reports';
import { REPORT_REASON_LABELS } from '@voice-room/shared/report-labels';
import { fetchOpenUserReports, resolveUserReport } from '../api/admin.ts';
import { formatDateTime } from '../format.ts';
import { useAdminResource } from '../load-state.ts';
import { Notice } from '../Notice.tsx';
import { Button, Empty, Pill } from '../ui/index.tsx';

export function UserReports({
  onResolved,
  onOpenAccount
}: {
  onResolved: (count: number) => void;
  onOpenAccount: (id: string) => void;
}) {
  const resource = useAdminResource(fetchOpenUserReports, [], {
    failureText: 'Не удалось загрузить жалобы на пользователей',
    refreshMs: 60_000
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (resource.data) onResolved(resource.data.length);
  }, [resource.data, onResolved]);

  async function decide(report: AdminUserReport, action: UserReportResolveBody['action']) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await resolveUserReport(report.id, action);
      resource.update((current) => (current ?? []).filter((item) => item.target.userId !== report.target.userId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось закрыть жалобу');
    } finally {
      setBusy(false);
    }
  }

  const groups = new Map<string, AdminUserReport[]>();
  for (const report of resource.data ?? []) {
    const group = groups.get(report.target.userId);
    if (group) group.push(report);
    else groups.set(report.target.userId, [report]);
  }
  return (
    <section className="ui-panel" aria-labelledby="user-reports-title">
      <h2 id="user-reports-title">Жалобы на пользователей</h2>
      <p className="ui-section-note">
        Проверьте аккаунт и при необходимости примените меры в его карточке. Закрытие жалоб само по себе не блокирует и
        не удаляет аккаунт.
      </p>
      {resource.failure ? <Notice failure={resource.failure} onRetry={resource.reload} /> : null}
      {!resource.data && !resource.failure ? <p aria-busy="true">Загружаем жалобы…</p> : null}
      {resource.data?.length === 0 ? <Empty>Жалоб на пользователей нет</Empty> : null}
      {error ? (
        <p className="admin-error" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="reports-cards" aria-label="Жалобы на пользователей">
        {[...groups.values()].map((reports) => {
          const report = reports[0];
          if (!report) return null;
          return (
            <li key={report.target.userId} className="ui-panel">
              <h3>
                {report.target.displayName || 'Удалённый аккаунт'}{' '}
                {report.target.login ? `@${report.target.login}` : ''}
              </h3>
              <Pill tone="danger">{reports.length}</Pill>
              {report.target.deleted ? (
                <p>Аккаунт уже удалён</p>
              ) : (
                <Button variant="ghost" onClick={() => onOpenAccount(report.target.userId)}>
                  Открыть аккаунт
                </Button>
              )}
              <ul>
                {reports.map((item) => (
                  <li key={item.id}>
                    <strong>{REPORT_REASON_LABELS[item.reason]}</strong> · {item.reporter.displayName} ·{' '}
                    {formatDateTime(item.createdAt)}
                    {item.comment ? <p className="report-comments-text">{item.comment}</p> : null}
                  </li>
                ))}
              </ul>
              <div className="report-actions">
                <Button disabled={busy} onClick={() => void decide(report, 'dismiss')}>
                  Отклонить жалобы
                </Button>
                <Button disabled={busy} onClick={() => void decide(report, 'reviewed')}>
                  Рассмотрено
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
