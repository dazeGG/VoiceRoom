<script lang="ts">
  import { MonitorSmartphone } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import { normalizeLoginAlert } from '@voice-room/shared/account-security';
  import {
    confirmLoginAlert,
    denyLoginAlert,
    fetchLoginAlerts,
    type LoginAlert,
    type RecoveryCodesStatus
  } from '$lib/api/auth';
  import { getAppRealtime } from '$lib/api/realtime';
  import { Dialog } from '$lib/shared/ui';
  import { iconMd } from '$lib/shared/ui/icons';
  import {
    loginAlertDevice,
    loginAlertHeadline,
    loginAlertWhen,
    queueLoginAlert,
    type SecureAccountTarget
  } from '../model/login-alerts';
  import type { ToastOptions } from '../model/toasts.svelte';

  let { onSecureAccount, onOpenChange = () => {}, onToast } = $props<{
    onSecureAccount: (target: SecureAccountTarget) => void;
    onOpenChange?: (open: boolean) => void;
    onToast: (message: string, options?: ToastOptions) => void;
  }>();

  let alerts = $state<LoginAlert[]>([]);
  // Closed without an answer: hidden for this visit, asked again next time.
  let postponedIds = $state<string[]>([]);
  let secured = $state<{ sessionEnded: boolean; recoveryCodes: RecoveryCodesStatus } | null>(null);
  let answering = $state(false);

  const current = $derived(alerts.find((alert) => !postponedIds.includes(alert.id)) ?? null);
  const open = $derived(Boolean(secured) || Boolean(current));

  $effect(() => {
    onOpenChange(open);
  });

  function addAlert(alert: LoginAlert): void {
    alerts = queueLoginAlert(alerts, alert);
  }

  function removeAlert(alertId: string): void {
    alerts = alerts.filter((alert) => alert.id !== alertId);
  }

  async function load(): Promise<void> {
    try {
      for (const alert of await fetchLoginAlerts()) addAlert(alert);
    } catch {
      // Asked again on the next visit or reconnect.
    }
  }

  onMount(() => {
    void load();
    const realtime = getAppRealtime();
    const stopEvents = realtime.subscribe((event) => {
      if (event.type === 'account.login.new') {
        const alert = normalizeLoginAlert(event.payload.alert);
        if (alert) addAlert(alert);
      } else if (event.type === 'account.login.resolved') {
        removeAlert(event.payload.alertId);
      }
    });
    // Sign-ins that happened while the socket was down come with a reload.
    const stopRestore = realtime.onRestore(() => void load());
    return () => {
      stopEvents();
      stopRestore();
      onOpenChange(false);
    };
  });

  async function answer(resolution: 'confirmed' | 'denied'): Promise<void> {
    const alert = current;
    if (!alert || answering) return;
    answering = true;
    try {
      if (resolution === 'confirmed') {
        await confirmLoginAlert(alert.id);
        removeAlert(alert.id);
      } else {
        const result = await denyLoginAlert(alert.id);
        removeAlert(alert.id);
        secured = result;
      }
    } catch (error) {
      onToast(error instanceof Error && error.message ? error.message : 'Не удалось ответить', { variant: 'error' });
    } finally {
      answering = false;
    }
  }

  function secure(target: SecureAccountTarget): void {
    secured = null;
    onSecureAccount(target);
  }

  function close(): void {
    if (secured) {
      secured = null;
      return;
    }
    if (current) postponedIds = [...postponedIds, current.id];
  }
</script>

<!-- A security question outranks every other dialog in the lobby. -->
<div class="login-alert-layer">
  <Dialog {open} title={secured ? 'Защитите аккаунт' : 'Новый вход в аккаунт'} onClose={close} width={440}>
    {#if secured}
      <p class="login-alert-text">
        {secured.sessionEnded
          ? 'Сеанс на том устройстве завершён — там аккаунт больше не открыт.'
          : 'Сеанс на том устройстве уже был завершён.'}
        Если это были не вы, кто-то мог узнать ваш пароль.
      </p>
      <div class="login-alert-actions login-alert-actions--stack">
        <button class="login-alert-button login-alert-button--danger" type="button" onclick={() => secure('password')}>
          Сменить пароль
        </button>
        <button class="login-alert-button login-alert-button--ghost" type="button" onclick={() => secure('recovery-codes')}>
          {secured.recoveryCodes.remaining > 0 ? 'Обновить коды восстановления' : 'Создать коды восстановления'}
        </button>
        <button class="login-alert-later" type="button" onclick={() => (secured = null)}>Позже</button>
      </div>
    {:else if current}
      <p class="login-alert-text">{loginAlertHeadline(current)}. Это были вы?</p>
      <div class="login-alert-device">
        <span class="login-alert-icon" aria-hidden="true"><MonitorSmartphone {...iconMd} /></span>
        <div>
          <strong>{loginAlertDevice(current)}</strong>
          <small>{loginAlertWhen(current)}</small>
        </div>
      </div>
      <div class="login-alert-actions">
        <button
          class="login-alert-button login-alert-button--danger"
          type="button"
          disabled={answering}
          onclick={() => void answer('denied')}
        >
          Это не я
        </button>
        <button
          class="login-alert-button login-alert-button--safe"
          type="button"
          disabled={answering}
          onclick={() => void answer('confirmed')}
        >
          Это я
        </button>
      </div>
    {/if}
  </Dialog>
</div>

<style>
  .login-alert-layer :global(.ui-dialog-overlay) {
    z-index: 110;
  }

  .login-alert-text {
    margin: 0;
    color: var(--warm-muted);
    font-size: 14px;
    line-height: 1.45;
  }

  .login-alert-device {
    display: grid;
    grid-template-columns: 38px minmax(0, 1fr);
    gap: 12px;
    align-items: center;
    margin: 16px 0 18px;
    padding: 12px 14px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    background: var(--warm-900);
  }

  .login-alert-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    border-radius: 11px;
    background: var(--control);
    color: var(--warm-ink);
  }

  .login-alert-device strong {
    display: block;
    color: var(--warm-ink);
    font-size: 14px;
  }

  .login-alert-device small {
    display: block;
    margin-top: 2px;
    color: var(--warm-faint);
    font-size: 12.5px;
  }

  .login-alert-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .login-alert-actions--stack {
    grid-template-columns: 1fr;
    margin-top: 16px;
  }

  .login-alert-button {
    min-height: 44px;
    padding: 0 16px;
    border: 1px solid transparent;
    border-radius: 12px;
    font: inherit;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
  }

  .login-alert-button:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .login-alert-button--safe {
    background: var(--green);
    color: var(--accent-ink);
  }

  .login-alert-button--safe:hover:not(:disabled) {
    background: color-mix(in oklch, var(--green), transparent 12%);
  }

  .login-alert-button--danger {
    border-color: color-mix(in oklch, var(--coral), transparent 45%);
    background: color-mix(in oklch, var(--coral), transparent 78%);
    color: #f3c2b8;
  }

  .login-alert-button--danger:hover:not(:disabled) {
    background: color-mix(in oklch, var(--coral), transparent 66%);
  }

  .login-alert-button--ghost {
    border-color: rgba(255, 255, 255, 0.12);
    background: transparent;
    color: var(--warm-ink);
  }

  .login-alert-button--ghost:hover {
    background: var(--control);
  }

  .login-alert-later {
    justify-self: center;
    padding: 6px 10px;
    border: none;
    background: none;
    color: var(--warm-faint);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }

  .login-alert-later:hover {
    color: var(--warm-ink);
  }
</style>
