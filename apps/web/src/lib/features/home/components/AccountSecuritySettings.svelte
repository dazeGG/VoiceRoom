<script lang="ts">
  import { KeyRound, Laptop, MonitorSmartphone } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import {
    fetchAccountSecurity,
    fetchAccountSessions,
    revokeAccountSession,
    revokeOtherAccountSessions,
    type AccountSession,
    type RecoveryCodesStatus
  } from '$lib/api/auth';
  import { iconMd } from '$lib/shared/ui/icons';
  import { formatLastSeen, recoveryCodesSummary, sessionDeviceLabel } from '../model/account-security';
  import type { ToastOptions } from '../model/toasts.svelte';
  import RecoveryCodesDialog from './RecoveryCodesDialog.svelte';

  let { login, onToast, onDialogOpenChange = () => {} } = $props<{
    login: string;
    onToast: (message: string, options?: ToastOptions) => void;
    onDialogOpenChange?: (open: boolean) => void;
  }>();

  let recoveryCodes = $state<RecoveryCodesStatus | null>(null);
  let sessions = $state<AccountSession[]>([]);
  let loading = $state(true);
  let endingSessionId = $state('');
  let endingOthers = $state(false);
  let codesDialogOpen = $state(false);

  const hasOtherSessions = $derived(sessions.some((session) => !session.current));
  const lowOnCodes = $derived(Boolean(recoveryCodes && recoveryCodes.remaining > 0 && recoveryCodes.remaining <= 2));

  $effect(() => {
    onDialogOpenChange(codesDialogOpen);
  });

  onMount(() => {
    void load();
    return () => onDialogOpenChange(false);
  });

  function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  async function load(): Promise<void> {
    loading = true;
    try {
      const [security, list] = await Promise.all([fetchAccountSecurity(), fetchAccountSessions()]);
      recoveryCodes = security.recoveryCodes;
      sessions = list;
    } catch (error) {
      onToast(errorMessage(error, 'Не удалось загрузить настройки безопасности'), { variant: 'error' });
    } finally {
      loading = false;
    }
  }

  async function endSession(session: AccountSession): Promise<void> {
    if (endingSessionId || endingOthers) return;
    endingSessionId = session.id;
    try {
      await revokeAccountSession(session.id);
      sessions = sessions.filter((entry) => entry.id !== session.id);
      onToast('Сеанс завершён');
    } catch (error) {
      onToast(errorMessage(error, 'Не удалось завершить сеанс'), { variant: 'error' });
    } finally {
      endingSessionId = '';
    }
  }

  async function endOtherSessions(): Promise<void> {
    if (endingSessionId || endingOthers) return;
    endingOthers = true;
    try {
      const ended = await revokeOtherAccountSessions();
      sessions = sessions.filter((session) => session.current);
      onToast(ended > 0 ? `Завершено сеансов: ${ended}` : 'Других сеансов нет');
    } catch (error) {
      onToast(errorMessage(error, 'Не удалось завершить сеансы'), { variant: 'error' });
    } finally {
      endingOthers = false;
    }
  }
</script>

<div class="account-security">
  <section class="settings-notification-group" aria-labelledby="recoveryCodesTitle">
    <span class="settings-section-title" id="recoveryCodesTitle">Коды восстановления</span>
    {#if loading && !recoveryCodes}
      <div class="settings-notification-empty" role="status">Загружаем…</div>
    {:else if recoveryCodes}
      <div class="settings-notification-row account-security-row" data-warning={recoveryCodes.remaining === 0 || lowOnCodes}>
        <span class="account-security-icon" aria-hidden="true"><KeyRound {...iconMd} /></span>
        <span class="settings-notification-name">
          <strong>{recoveryCodes.remaining > 0 ? 'Коды созданы' : 'Коды не созданы'}</strong>
          <small>{recoveryCodesSummary(recoveryCodes)}</small>
        </span>
        <button class="settings-save account-security-action" type="button" onclick={() => (codesDialogOpen = true)}>
          {recoveryCodes.generatedAt ? 'Создать новые' : 'Создать коды'}
        </button>
      </div>
      {#if lowOnCodes}
        <div class="settings-gate-hint">Кодов почти не осталось — создайте новый набор.</div>
      {/if}
    {/if}
  </section>

  <section class="settings-notification-group" aria-labelledby="accountSessionsTitle">
    <div class="account-security-head">
      <div>
        <span class="settings-section-title" id="accountSessionsTitle">Устройства</span>
        <div class="settings-gate-hint">Где открыт ваш аккаунт. Незнакомый сеанс завершите — пароль после этого лучше сменить.</div>
      </div>
      {#if hasOtherSessions}
        <button class="settings-unblock-button" type="button" disabled={endingOthers || Boolean(endingSessionId)} onclick={() => void endOtherSessions()}>
          {endingOthers ? 'Завершаем…' : 'Выйти на других устройствах'}
        </button>
      {/if}
    </div>
    {#if loading && sessions.length === 0}
      <div class="settings-notification-empty" role="status">Загружаем…</div>
    {:else if sessions.length > 0}
      <div class="settings-notification-list">
        {#each sessions as session (session.id)}
          <div class="settings-notification-row account-security-row">
            <span class="account-security-icon" aria-hidden="true">
              {#if session.client === 'VoiceRoom Desktop'}
                <MonitorSmartphone {...iconMd} />
              {:else}
                <Laptop {...iconMd} />
              {/if}
            </span>
            <span class="settings-notification-name">
              <strong>{sessionDeviceLabel(session)}</strong>
              <small>
                {session.current ? 'Это устройство' : formatLastSeen(session.lastSeenAt)}{session.location ? ` · ${session.location}` : ''}
              </small>
            </span>
            {#if !session.current}
              <button
                class="settings-unblock-button"
                type="button"
                disabled={endingOthers || Boolean(endingSessionId)}
                onclick={() => void endSession(session)}
              >
                {endingSessionId === session.id ? 'Завершаем…' : 'Завершить'}
              </button>
            {/if}
          </div>
        {/each}
      </div>
    {:else}
      <div class="settings-notification-empty">Активных сеансов нет.</div>
    {/if}
    {#if sessions.some((session) => session.location)}
      <div class="settings-gate-hint">
        Город определяется по IP-адресу с помощью <a href="https://db-ip.com" target="_blank" rel="noreferrer">DB-IP</a>; сам адрес не сохраняется.
      </div>
    {/if}
  </section>
</div>

<RecoveryCodesDialog
  open={codesDialogOpen}
  {login}
  replacing={Boolean(recoveryCodes?.generatedAt && recoveryCodes.remaining > 0)}
  onClose={() => (codesDialogOpen = false)}
  onGenerated={(status) => (recoveryCodes = status)}
  {onToast}
/>

<style>
  .account-security {
    display: grid;
    gap: 22px;
  }

  .account-security-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
  }

  .account-security-head .settings-gate-hint {
    margin-top: 0;
  }

  .account-security-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 10px;
    background: var(--control);
    color: var(--warm-muted);
  }

  .account-security-row[data-warning='true'] .account-security-icon {
    color: var(--amber, #e0b457);
  }

  .account-security-action {
    padding: 8px 14px;
    font-size: 13px;
  }

  @media (max-width: 560px) {
    .account-security-head {
      flex-direction: column;
    }
  }
</style>
