<script module lang="ts">
  export type AuthMode = 'login' | 'register';
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { X } from '@lucide/svelte';
  import { login, register } from '$lib/api/auth';
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

  let dialog: HTMLDialogElement;
  let loginInput: HTMLInputElement;
  let loginValue = $state('');
  let displayName = $state('');
  let password = $state('');
  let passwordConfirm = $state('');
  let error = $state('');
  let submitting = $state(false);

  const isLogin = $derived(mode === 'login');

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

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (submitting) return;

    error = '';
    if (!isLogin && !normalizeLogin(loginValue)) {
      error = `Логин: ${LOGIN_HINT}`;
      return;
    }
    if (!isLogin && !isValidPassword(password)) {
      error = `Пароль должен быть не короче ${PASSWORD_MIN_LENGTH} символов`;
      return;
    }
    if (!isLogin && password !== passwordConfirm) {
      error = 'Пароли не совпадают';
      return;
    }

    submitting = true;
    try {
      const user = isLogin
        ? await login({ login: loginValue.trim(), password })
        : await register({
            login: loginValue.trim(),
            displayName: displayName.trim(),
            password,
            passwordConfirm
          });
      setUser(user);
      await goto('/');
    } catch (cause) {
      error = cause instanceof Error && cause.message
        ? cause.message
        : isLogin
          ? 'Не удалось войти'
          : 'Не удалось создать аккаунт';
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
      <h1 class="auth-title" id="authDialogTitle">{isLogin ? 'Вход' : 'Создать аккаунт'}</h1>
      <p class="auth-subtitle">
        {isLogin ? 'Продолжите с сохранёнными комнатами и именем.' : 'Сохраняйте комнаты, историю и своё имя.'}
      </p>
    </div>

    <form class="auth-form" onsubmit={handleSubmit}>
      {#if error}
        <p class="auth-error" role="alert">{error}</p>
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

      {#if !isLogin}
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

      <div class="auth-field">
        <label class="auth-label" for="authPasswordInput">Пароль</label>
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
          {isLogin ? 'Входим…' : 'Создаём…'}
        {:else}
          {isLogin ? 'Войти' : 'Создать аккаунт'}
        {/if}
      </button>
    </form>

    <p class="auth-foot">
      {isLogin ? 'Нет аккаунта?' : 'Уже есть аккаунт?'}
      <button
        type="button"
        class="auth-link"
        onclick={() => switchMode(isLogin ? 'register' : 'login')}
      >
        {isLogin ? 'Зарегистрироваться' : 'Войти'}
      </button>
    </p>
  </div>
</dialog>
