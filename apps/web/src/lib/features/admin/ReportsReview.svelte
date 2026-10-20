<script lang="ts">
  // The platform administrator's review of open reports, a tab of the admin
  // panel: each shows the message as it stands now, and one decision closes
  // every report of that message.
  import { dateTime } from '$lib/shared/utils/date-format';
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { ApiError } from '$lib/api/client';
  import { fetchOpenReports, resolveReport, type AdminReport } from '$lib/api/reports';
  import { Button } from '$lib/shared/ui';
  import { REPORT_REASON_LABELS as REASON_LABELS } from './report-reasons';

  let reports = $state<AdminReport[]>([]);
  let status = $state<'loading' | 'ready' | 'signed_out' | 'forbidden' | 'failed'>('loading');
  let error = $state('');
  let busyId = $state<string | null>(null);

  const formatDate = (value: number | null) => (value ? dateTime(value) : 'время неизвестно');

  async function load(): Promise<void> {
    status = 'loading';
    error = '';
    try {
      reports = await fetchOpenReports();
      status = 'ready';
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) status = 'signed_out';
      else if (cause instanceof ApiError && cause.status === 403) status = 'forbidden';
      else {
        status = 'failed';
        error = cause instanceof Error && cause.message ? cause.message : 'Не удалось загрузить жалобы';
      }
    }
  }

  async function decide(report: AdminReport, action: 'remove_message' | 'dismiss'): Promise<void> {
    if (busyId) return;
    busyId = report.id;
    error = '';
    try {
      await resolveReport(report.id, action);
      // The server closed every open report of the same message.
      reports = reports.filter(
        (other) => other.target.kind !== report.target.kind || other.target.messageId !== report.target.messageId
      );
    } catch (cause) {
      error = cause instanceof Error && cause.message ? cause.message : 'Не удалось закрыть жалобу';
    } finally {
      busyId = null;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<div class="reports">
  {#if status === 'loading'}
    <p class="reports-note" aria-busy="true">Загружаем жалобы…</p>
  {:else if status === 'signed_out'}
    <p class="reports-note">Войдите в аккаунт администратора: <a href={resolve('/login')}>вход</a>.</p>
  {:else if status === 'forbidden'}
    <p class="reports-note">Этот раздел доступен только администратору сервиса.</p>
  {:else if status === 'failed'}
    <p class="reports-error" role="alert">{error}</p>
    <Button variant="outline" onclick={() => void load()}>Повторить</Button>
  {:else}
    {#if error}<p class="reports-error" role="alert">{error}</p>{/if}
    {#if reports.length === 0}
      <p class="reports-note">Открытых жалоб нет.</p>
    {:else}
      <ul class="reports-list">
        {#each reports as report (report.id)}
          <li class="report-card">
            <div class="report-meta">
              <strong>{REASON_LABELS[report.reason]}</strong>
              <span>
                {report.target.kind === 'room_message'
                  ? `Комната «${report.target.roomName || report.target.roomId}»`
                  : 'Личное сообщение'}
              </span>
              <span>от {report.reporter.displayName} (@{report.reporter.login}), {formatDate(report.createdAt)}</span>
            </div>
            <blockquote class="report-message" class:is-deleted={report.target.deleted}>
              <span class="report-author">
                {report.target.authorName || 'Без имени'} · {formatDate(report.target.sentAt)}
                {#if report.target.deleted}· уже удалено{/if}
              </span>
              <span class="report-text">{report.target.text || '(без текста)'}</span>
            </blockquote>
            {#if report.comment}
              <p class="report-comment">Комментарий: {report.comment}</p>
            {/if}
            <div class="report-actions">
              <Button variant="ghost" disabled={busyId !== null} onclick={() => void decide(report, 'dismiss')}>
                Отклонить
              </Button>
              <Button
                variant="danger"
                disabled={busyId !== null || report.target.deleted}
                onclick={() => void decide(report, 'remove_message')}
              >
                Удалить сообщение
              </Button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>

<style>
  .reports {
    display: grid;
    gap: 14px;
  }

  .reports-note a {
    color: var(--vr-text-2);
  }

  .reports-note {
    color: var(--vr-text-2);
  }

  .reports-error {
    color: var(--vr-danger);
  }

  .reports-list {
    display: grid;
    gap: 14px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .report-card {
    display: grid;
    gap: 12px;
    padding: 16px 18px;
    border: 1px solid var(--vr-line-strong);
    border-radius: 16px;
    background: var(--vr-surface);
  }

  .report-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    color: var(--vr-text-2);
    font-size: 13px;
  }

  .report-meta strong {
    color: var(--vr-text);
  }

  .report-message {
    display: grid;
    gap: 4px;
    margin: 0;
    padding: 10px 14px;
    border-left: 3px solid var(--vr-line-strong);
    border-radius: 8px;
    background: var(--vr-surface-2);
  }

  .report-message.is-deleted {
    opacity: 0.6;
  }

  .report-author {
    color: var(--vr-text-3);
    font-size: 12.5px;
  }

  .report-text {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .report-comment {
    margin: 0;
    color: var(--vr-text-2);
    font-size: 14px;
  }

  .report-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  }
</style>
