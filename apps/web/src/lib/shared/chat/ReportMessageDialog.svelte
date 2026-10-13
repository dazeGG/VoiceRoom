<script lang="ts">
  // Reporting a room or direct message to the service operator. The reason is
  // required, the comment is optional; the operator sees the message itself.
  import { REPORT_COMMENT_MAX_LENGTH } from '@voice-room/shared/contracts/reports';
  import { fileReport, type ReportReason, type ReportTarget } from '$lib/api/reports';
  import { Button, Dialog } from '$lib/shared/ui';

  let {
    target,
    onClose,
    onReported
  }: {
    target: ReportTarget;
    onClose: () => void;
    onReported: (message: string) => void;
  } = $props();

  const REASONS: { value: ReportReason; label: string }[] = [
    { value: 'spam', label: 'Спам или реклама' },
    { value: 'abuse', label: 'Оскорбления, травля или угрозы' },
    { value: 'illegal', label: 'Запрещённый законом контент' },
    { value: 'other', label: 'Другое' }
  ];

  let reason = $state<ReportReason | null>(null);
  let comment = $state('');
  let sending = $state(false);
  let error = $state('');

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!reason || sending) return;
    sending = true;
    error = '';
    try {
      const status = await fileReport({ target, reason, comment: comment.trim() || undefined });
      onReported(status === 'filed' ? 'Жалоба отправлена, спасибо' : 'Вы уже пожаловались на это сообщение');
      onClose();
    } catch (cause) {
      error = cause instanceof Error && cause.message ? cause.message : 'Не удалось отправить жалобу';
    } finally {
      sending = false;
    }
  }
</script>

<Dialog open title="Пожаловаться на сообщение" {onClose} width={460} initialFocus="[name=report-reason]">
  <form class="report-form" onsubmit={submit}>
    <fieldset class="report-reasons">
      <legend class="report-label">Что не так с сообщением?</legend>
      {#each REASONS as option (option.value)}
        <label class="report-reason">
          <input type="radio" name="report-reason" value={option.value} bind:group={reason} />
          <span>{option.label}</span>
        </label>
      {/each}
    </fieldset>

    <div>
      <label class="report-label" for="reportComment"
        >Комментарий <span class="report-soft">· необязательно</span></label
      >
      <textarea
        id="reportComment"
        class="report-comment"
        rows="3"
        maxlength={REPORT_COMMENT_MAX_LENGTH}
        placeholder="Что ещё стоит знать модератору"
        bind:value={comment}></textarea>
    </div>

    <p class="report-note">Жалобу рассмотрит администратор сервиса. Автор сообщения не узнает, кто пожаловался.</p>

    {#if error}
      <p class="report-error" role="alert">{error}</p>
    {/if}

    <div class="report-actions">
      <Button variant="ghost" type="button" onclick={onClose}>Отмена</Button>
      <Button variant="danger" type="submit" disabled={!reason || sending}>
        {sending ? 'Отправляем…' : 'Отправить жалобу'}
      </Button>
    </div>
  </form>
</Dialog>

<style>
  .report-form {
    display: grid;
    gap: 16px;
  }

  .report-reasons {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 0;
    border: 0;
  }

  .report-label {
    display: block;
    margin-bottom: 8px;
    padding: 0;
    color: var(--vr-text-2);
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 500;
  }

  .report-soft {
    color: var(--vr-text-3);
    font-weight: 400;
  }

  .report-reason {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--vr-text);
    font-size: 14px;
    cursor: pointer;
  }

  .report-reason input {
    accent-color: var(--vr-accent);
  }

  .report-comment {
    width: 100%;
    padding: 10px 14px;
    border: 1px solid var(--vr-line-strong);
    border-radius: 12px;
    background: var(--vr-surface-2);
    color: var(--vr-text);
    font: inherit;
    font-size: 14px;
    resize: vertical;
    outline: none;
  }

  .report-comment:focus {
    border-color: var(--vr-accent-line);
  }

  .report-note,
  .report-error {
    margin: 0;
    font-size: 13px;
    line-height: 1.45;
  }

  .report-note {
    color: var(--vr-text-3);
  }

  .report-error {
    color: var(--vr-danger);
  }

  .report-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  }
</style>
