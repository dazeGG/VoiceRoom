<script lang="ts">
  import { KeyRound, Laptop, MonitorSmartphone } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import {
    changePassword,
    fetchAccountSecurity,
    fetchAccountSessions,
    revokeAccountSession,
    revokeOtherAccountSessions,
    type AccountSession,
    type RecoveryCodesStatus
  } from '$lib/api/auth';
  import { isValidPassword, PASSWORD_MIN_LENGTH } from '$lib/features/auth/account';
  import { clearSession, expectSessionEnd } from '$lib/features/auth/session.svelte';
  import { iconMd } from '$lib/shared/ui/icons';
  import { formatLastSeen, recoveryCodesSummary, sessionDeviceLabel } from '../model/account-security';
  import type { ToastOptions } from '../model/toasts.svelte';
  import RecoveryCodesDialog from './RecoveryCodesDialog.svelte';

  let { login, highlightRecoveryCodes = false, onToast, onDialogOpenChange = () => {} } = $props<{
    login: string;
    // Set when the lobby reminder brought the user here.
    highlightRecoveryCodes?: boolean;
    onToast: (message: string, options?: ToastOptions) => void;
    onDialogOpenChange?: (open: boolean) => void;
  }>();

  let recoveryCodesButton = $state<HTMLButtonElement>();

  let recoveryCodes = $state<RecoveryCodesStatus | null>(null);
  let sessions = $state<AccountSession[]>([]);
  let loading = $state(true);
  let endingSessionId = $state('');
  let endingOthers = $state(false);
  let codesDialogOpen = $state(false);
  let currentPassword = $state('');
  let newPassword = $state('');
  let changingPassword = $state(false);

  const hasOtherSessions = $derived(sessions.some((session) => !session.current));
  const lowOnCodes = $derived(Boolean(recoveryCodes && recoveryCodes.remaining > 0 && recoveryCodes.remaining <= 2));

  const recoveryCodesHighlighted = $derived(highlightRecoveryCodes && recoveryCodes?.remaining === 0);

  $effect(() => {
    onDialogOpenChange(codesDialogOpen);
  });

  $effect(() => {
    if (recoveryCodesHighlighted) recoveryCodesButton?.scrollIntoView({ block: 'center', behavior: 'smooth' });
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

  async function submitPasswordChange(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (changingPassword) return;
    if (!currentPassword) {
      onToast('Введите текущий пароль');
      return;
    }
    if (!isValidPassword(newPassword)) {
      onToast(`Новый пароль: минимум ${PASSWORD_MIN_LENGTH} символов`);
      return;
    }
    changingPassword = true;
    // The server ends every session of the account, this one included.
    expectSessionEnd();
    try {
      await changePassword(currentPassword, newPassword);
      currentPassword = '';
      newPassword = '';
      clearSession();
      onToast('Пароль изменён, войдите снова');
    } catch (error) {
      expectSessionEnd(false);
      onToast(errorMessage(error, 'Не удалось сменить пароль'), { variant: 'error' });
    } finally {
      changingPassword = false;
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
  <section class="settings-notification-group" aria-labelledby="accountPasswordTitle">
    <span class="settings-section-title" id="accountPasswordTitle">Пароль</span>
    <form class="account-security-password" onsubmit={submitPasswordChange}>
      <div class="settings-password-fields">
        <div>
          <span class="settings-field-label">Текущий пароль</span>
          <input class="settings-input" type="password" bind:value={currentPassword} placeholder="••••••••" autocomplete="current-password" />
        </div>
        <div>
          <span class="settings-field-label">Новый пароль</span>
          <input class="settings-input" type="password" bind:value={newPassword} placeholder="Минимум {PASSWORD_MIN_LENGTH} символов" autocomplete="new-password" />
        </div>
      </div>
      <div class="account-security-password-foot">
        <div class="settings-gate-hint">После смены пароля завершатся все сеансы, включая этот.</div>
        <button class="settings-save account-security-action" type="submit" disabled={changingPassword || !currentPassword || !newPassword}>
          {#if changingPassword}<span class="home-spinner" aria-hidden="true"></span>{/if}
          Сменить пароль
        </button>
      </div>
    </form>
  </section>

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
        <button
          class="settings-save account-security-action"
          type="button"
          bind:this={recoveryCodesButton}
          data-highlight={recoveryCodesHighlighted}
          onclick={() => (codesDialogOpen = true)}
        >
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

  .account-security-action[data-highlight='true'] {
    animation: account-security-highlight 1.4s ease-in-out 4;
  }

  @keyframes account-security-highlight {
    0%,
    100% {
      box-shadow: 0 0 0 0 color-mix(in oklch, var(--accent), transparent 40%);
    }

    50% {
      box-shadow: 0 0 0 7px color-mix(in oklch, var(--accent), transparent 80%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .account-security-action[data-highlight='true'] {
      animation: none;
      outline: 2px solid var(--accent);
      outline-offset: 3px;
    }
  }

  .account-security-password-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 12px;
  }

  .account-security-password-foot .settings-gate-hint {
    margin-top: 0;
  }

  @media (max-width: 560px) {
    .account-security-head {
      flex-direction: column;
    }
  }
</style>
