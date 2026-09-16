<script module lang="ts">
  export type AuthMode = 'login' | 'register' | 'recover';
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { X } from '@lucide/svelte';
  import { normalizeRecoveryCode } from '@voice-room/shared/account-security';
  import { AuthRequestError, login, recoverAccount, register, restoreAccount } from '$lib/api/auth';
  import { iconMd } from '$lib/shared/ui/icons';
  import { LOGIN_HINT, PASSWORD_MIN_LENGTH, isValidPassword, normalizeLogin } from './account';
  import { session, setUser } from './session.svelte';
  import PasswordField from './PasswordField.svelte';
  import './styles/auth.css';

  let {
    mode,
    onClose,
    onModeChange
  }: {
    mode: AuthMode;
    onClose: () => void;
    onModeChange: (mode: AuthMode) => void;
  } = $props();

  const COPY: Record<AuthMode, { title: string; subtitle: string; submit: string; submitting: string; failure: string }> = {
    login: {
      title: 'Вход',
      subtitle: 'Продолжите с сохранёнными комнатами и именем.',
      submit: 'Войти',
      submitting: 'Входим…',
      failure: 'Не удалось войти'
    },
    register: {
      title: 'Создать аккаунт',
      subtitle: 'Сохраняйте комнаты, историю и своё имя.',
      submit: 'Создать аккаунт',
      submitting: 'Создаём…',
      failure: 'Не удалось создать аккаунт'
    },
    recover: {
      title: 'Восстановить доступ',
      subtitle: 'Введите логин, один из кодов восстановления и новый пароль. Код сработает только один раз.',
      submit: 'Сменить пароль и войти',
      submitting: 'Восстанавливаем…',
      failure: 'Не удалось восстановить доступ'
    }
  };

  let dialog: HTMLDialogElement;
  let loginInput: HTMLInputElement;
  let loginValue = $state('');
  let displayName = $state('');
  let recoveryCode = $state('');
  let password = $state('');
  let passwordConfirm = $state('');
  let error = $state('');
  let submitting = $state(false);
  // Set when the account signing in is waiting to be deleted: the dialog offers
  // to restore it instead of an error.
  let pendingDeletionAt = $state<number | null>(null);

  const formatDeletionDate = (value: number): string =>
    new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(value);

  const isLogin = $derived(mode === 'login');
  const isRegister = $derived(mode === 'register');
  const isRecover = $derived(mode === 'recover');
  const copy = $derived(COPY[mode]);

  onMount(() => {
    dialog.showModal();
    queueMicrotask(() => loginInput.focus());
    return () => {
      if (dialog.open) dialog.close();
    };
  });

  function handleBackdropClick(event: MouseEvent): void {
    if (event.target === dialog) onClose();
  }

  function handleCancel(event: Event): void {
    event.preventDefault();
    onClose();
  }

  function switchMode(nextMode: AuthMode): void {
    if (submitting) return;
    onModeChange(nextMode);
  }

  function validate(): string {
    if (isRegister && !normalizeLogin(loginValue)) return `Логин: ${LOGIN_HINT}`;
    if (isRecover && !normalizeLogin(loginValue)) return 'Введите логин аккаунта';
    if (isRecover && !normalizeRecoveryCode(recoveryCode)) return 'Код восстановления — 16 символов, например ABCD-EFGH-JKMN-PQRS';
    if (!isLogin && !isValidPassword(password)) return `Пароль должен быть не короче ${PASSWORD_MIN_LENGTH} символов`;
    if (!isLogin && password !== passwordConfirm) return 'Пароли не совпадают';
    return '';
  }

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (submitting) return;

    error = validate();
    if (error) return;

    submitting = true;
    try {
      if (isRecover) {
        const recovered = await recoverAccount({
          login: loginValue.trim(),
          code: recoveryCode,
          newPassword: password
        });
        setUser(recovered.user);
      } else {
        const user = isLogin
          ? await login({ login: loginValue.trim(), password })
          : await register({
              login: loginValue.trim(),
              displayName: displayName.trim(),
              password,
              passwordConfirm
            });
        setUser(user);
      }
      await goto('/');
    } catch (cause) {
      if (isLogin && cause instanceof AuthRequestError && cause.code === 'account_deletion_pending') {
        pendingDeletionAt = Number(cause.details.deletionScheduledFor) || null;
        return;
      }
      error = cause instanceof Error && cause.message ? cause.message : copy.failure;
    } finally {
      submitting = false;
    }
  }

  async function restorePendingAccount(): Promise<void> {
    if (submitting) return;
    submitting = true;
    error = '';
    try {
      setUser(await restoreAccount({ login: loginValue.trim(), password }));
      pendingDeletionAt = null;
      await goto('/');
    } catch (cause) {
      error = cause instanceof Error && cause.message ? cause.message : 'Не удалось восстановить аккаунт';
    } finally {
      submitting = false;
    }
  }
</script>

<dialog
  bind:this={dialog}
  class="auth-dialog"
  aria-labelledby="authDialogTitle"
  onclick={handleBackdropClick}
  oncancel={handleCancel}
>
  <div class="auth-dialog-panel">
    <button class="auth-dialog-close" type="button" aria-label="Закрыть" onclick={onClose}>
      <X {...iconMd} aria-hidden="true" />
    </button>

    <div class="auth-dialog-heading">
      <p class="auth-dialog-kicker">Ваши комнаты всегда рядом</p>
      <h1 class="auth-title" id="authDialogTitle">{copy.title}</h1>
      <p class="auth-subtitle">{copy.subtitle}</p>
    </div>

    <form class="auth-form" onsubmit={handleSubmit}>
      {#if error}
        <p class="auth-error" role="alert">{error}</p>
      {/if}

      {#if isLogin && pendingDeletionAt !== null}
        <div class="auth-restore" role="status">
          <p>
            Этот аккаунт ожидает удаления — оно произойдёт {formatDeletionDate(pendingDeletionAt)}. Восстановить его?
          </p>
          <button class="auth-submit" type="button" disabled={submitting} onclick={() => void restorePendingAccount()}>
            Восстановить аккаунт
          </button>
        </div>
      {/if}

      <div class="auth-field">
        <label class="auth-label" for="authLoginInput">Логин</label>
        <input
          id="authLoginInput"
          class="auth-input"
          maxlength="32"
          autocapitalize="off"
          autocomplete="username"
          spellcheck="false"
          placeholder="Ваш логин"
          bind:this={loginInput}
          bind:value={loginValue}
          required
        />
      </div>

      {#if isRegister}
        <div class="auth-field">
          <label class="auth-label" for="authDisplayNameInput">
            Отображаемое имя <span class="auth-label-soft">· необязательно</span>
          </label>
          <input
            id="authDisplayNameInput"
            class="auth-input"
            maxlength="40"
            autocomplete="nickname"
            placeholder="Как вас будут видеть в комнате"
            bind:value={displayName}
          />
        </div>
      {/if}

      {#if isRecover}
        <div class="auth-field">
          <label class="auth-label" for="authRecoveryCodeInput">Код восстановления</label>
          <input
            id="authRecoveryCodeInput"
            class="auth-input auth-input--code"
            maxlength="32"
            autocapitalize="characters"
            autocomplete="one-time-code"
            spellcheck="false"
            placeholder="XXXX-XXXX-XXXX-XXXX"
            bind:value={recoveryCode}
            required
          />
        </div>
      {/if}

      <div class="auth-field">
        <label class="auth-label" for="authPasswordInput">{isRecover ? 'Новый пароль' : 'Пароль'}</label>
        <PasswordField
          id="authPasswordInput"
          autocomplete={isLogin ? 'current-password' : 'new-password'}
          placeholder={isLogin ? 'Ваш пароль' : 'Минимум 8 символов'}
          bind:value={password}
        />
      </div>

      {#if !isLogin}
        <div class="auth-field">
          <label class="auth-label" for="authPasswordConfirmInput">Повторите пароль</label>
          <PasswordField
            id="authPasswordConfirmInput"
            autocomplete="new-password"
            placeholder="Ещё раз"
            bind:value={passwordConfirm}
          />
        </div>
      {/if}

      <button class="auth-submit" type="submit" disabled={submitting || !session.loaded}>
        {#if submitting}
          <span class="auth-spinner" aria-hidden="true"></span>
          {copy.submitting}
        {:else}
          {copy.submit}
        {/if}
      </button>
    </form>

    {#if isLogin}
      <p class="auth-foot">
        Нет аккаунта?
        <button type="button" class="auth-link" onclick={() => switchMode('register')}>Зарегистрироваться</button>
      </p>
      <p class="auth-foot auth-foot--secondary">
        Забыли пароль?
        <button type="button" class="auth-link" onclick={() => switchMode('recover')}>Восстановить по коду</button>
      </p>
    {:else}
      <p class="auth-foot">
        {isRecover ? 'Вспомнили пароль?' : 'Уже есть аккаунт?'}
        <button type="button" class="auth-link" onclick={() => switchMode('login')}>Войти</button>
      </p>
    {/if}
  </div>
</dialog>
