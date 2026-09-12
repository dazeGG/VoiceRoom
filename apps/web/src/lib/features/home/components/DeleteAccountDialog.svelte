<script lang="ts">
  import { fetchAccountDeletionPreview, requestAccountDeletion, type AccountDeletionPreview } from '$lib/api/auth';
  import { clearSession, expectSessionEnd } from '$lib/features/auth/session.svelte';
  import { Button, Dialog } from '$lib/shared/ui';
  import type { ToastOptions } from '../model/toasts.svelte';

  let { open, onClose, onToast } = $props<{
    open: boolean;
    onClose: () => void;
    onToast: (message: string, options?: ToastOptions) => void;
  }>();

  const DAY_MS = 24 * 60 * 60 * 1000;

  let preview = $state<AccountDeletionPreview | null>(null);
  let password = $state('');
  let understood = $state(false);
  let deleting = $state(false);
  let error = $state('');

  const graceDays = $derived(preview?.graceDays ?? 7);

  $effect(() => {
    if (!open) return;
    password = '';
    understood = false;
    error = '';
    preview = null;
    let cancelled = false;
    void fetchAccountDeletionPreview()
      .then((result) => {
        if (!cancelled) preview = result;
      })
      .catch((cause) => {
        if (!cancelled) error = cause instanceof Error && cause.message ? cause.message : 'Не удалось подготовить удаление';
      });
    return () => {
      cancelled = true;
    };
  });

  function formatDate(value: number): string {
    return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(value);
  }

  async function confirmDeletion(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (deleting || !understood || !password) return;
    deleting = true;
    error = '';
    // The server ends every session of the account, this one included.
    expectSessionEnd();
    try {
      const { deletionScheduledFor } = await requestAccountDeletion(password);
      password = '';
      clearSession();
      onToast(`Аккаунт будет удалён ${formatDate(deletionScheduledFor)}. Передумали — просто войдите снова`);
    } catch (cause) {
      expectSessionEnd(false);
      error = cause instanceof Error && cause.message ? cause.message : 'Не удалось удалить аккаунт';
    } finally {
      deleting = false;
    }
  }
</script>

<!-- Opened from the settings modal, whose overlay sits at z-index 60. -->
<div class="delete-account-layer">
  <Dialog {open} title="Удалить аккаунт" {onClose} width={500} initialFocus="#deleteAccountPassword">
    <form class="delete-account" onsubmit={confirmDeletion}>
      <p class="delete-account-text">
        Аккаунт сразу скроется, а все сеансы завершатся. До {formatDate(Date.now() + graceDays * DAY_MS)} его можно
        восстановить, просто войдя с паролем. После этого удаление окончательное:
      </p>
      <ul class="delete-account-list">
        <li>друзья, заявки, блокировки, настройки и коды восстановления удалятся;</li>
        <li>ваши сообщения останутся у собеседников от имени «Удалённый аккаунт»;</li>
        <li>занять этот логин снова будет нельзя.</li>
      </ul>

      {#if preview && preview.rooms.length > 0}
        <div class="delete-account-rooms">
          <span class="settings-field-label">Ваши постоянные комнаты через {graceDays} дней</span>
          {#each preview.rooms as room (room.roomId)}
            <div class="delete-account-room">
              <strong>{room.name || 'Комната без названия'}</strong>
              <small>
                {room.heir
                  ? `перейдёт к ${room.heir.displayName || room.heir.login} — самому давнему участнику`
                  : 'удалится: других участников нет'}
              </small>
            </div>
          {/each}
        </div>
      {/if}

      <div>
        <label class="settings-field-label" for="deleteAccountPassword">Текущий пароль</label>
        <input
          id="deleteAccountPassword"
          class="settings-input"
          type="password"
          autocomplete="current-password"
          placeholder="••••••••"
          bind:value={password}
        />
      </div>

      <label class="delete-account-confirm">
        <input type="checkbox" bind:checked={understood} />
        <span>Я понимаю, что через {graceDays} дней аккаунт удалится навсегда</span>
      </label>

      {#if error}
        <p class="delete-account-error" role="alert">{error}</p>
      {/if}

      <div class="lr-dialog-actions">
        <Button variant="ghost" type="button" onclick={onClose}>Отмена</Button>
        <button class="delete-account-submit" type="submit" disabled={deleting || !understood || !password}>
          {deleting ? 'Удаляем…' : 'Удалить аккаунт'}
        </button>
      </div>
    </form>
  </Dialog>
</div>

<style>
  .delete-account-layer :global(.ui-dialog-overlay) {
    z-index: 100;
  }

  .delete-account {
    display: grid;
    gap: 14px;
  }

  .delete-account-text,
  .delete-account-error {
    margin: 0;
    font-size: 14px;
    line-height: 1.45;
  }

  .delete-account-text {
    color: var(--warm-muted);
  }

  .delete-account-error {
    color: #e8b3a8;
  }

  .delete-account-list {
    display: grid;
    gap: 4px;
    margin: -6px 0 0;
    padding-left: 20px;
    color: var(--warm-muted);
    font-size: 13.5px;
    line-height: 1.45;
  }

  .delete-account-rooms {
    display: grid;
    gap: 6px;
  }

  .delete-account-room {
    padding: 10px 12px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    background: var(--warm-900);
  }

  .delete-account-room strong {
    display: block;
    color: var(--warm-ink);
    font-size: 13.5px;
  }

  .delete-account-room small {
    display: block;
    margin-top: 2px;
    color: var(--warm-faint);
    font-size: 12.5px;
  }

  .delete-account-confirm {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--warm-ink);
    font-size: 14px;
    cursor: pointer;
  }

  .delete-account-confirm input {
    width: 16px;
    height: 16px;
    margin: 0;
    accent-color: var(--coral);
  }

  .delete-account-submit {
    min-height: 40px;
    padding: 0 18px;
    border: 1px solid color-mix(in oklch, var(--coral), transparent 45%);
    border-radius: 12px;
    background: color-mix(in oklch, var(--coral), transparent 78%);
    color: #f3c2b8;
    font: inherit;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
  }

  .delete-account-submit:hover:not(:disabled) {
    background: color-mix(in oklch, var(--coral), transparent 66%);
  }

  .delete-account-submit:disabled {
    cursor: default;
    opacity: 0.55;
  }
</style>
