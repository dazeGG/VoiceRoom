<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { register } from '$lib/api/auth';
  import { loadSession, session, setUser } from './session.svelte';
  import { LOGIN_HINT, PASSWORD_MIN_LENGTH, isValidPassword, normalizeLogin } from './account';
  import AuthShell from './AuthShell.svelte';
  import PasswordField from './PasswordField.svelte';

  let loginValue = $state('');
  let displayName = $state('');
  let password = $state('');
  let passwordConfirm = $state('');
  let error = $state('');
  let submitting = $state(false);

  onMount(() => {
    document.body.dataset.screen = 'auth';
    void loadSession().then((user) => {
      if (user) void goto('/');
    });
    return () => {
      delete document.body.dataset.screen;
    };
  });

  async function handleSubmit(event: Event): Promise<void> {
    event.preventDefault();
    if (submitting) return;

    error = '';
    if (!normalizeLogin(loginValue)) {
      error = `Логин: ${LOGIN_HINT}`;
      return;
    }
    if (!isValidPassword(password)) {
      error = `Пароль должен быть не короче ${PASSWORD_MIN_LENGTH} символов`;
      return;
    }
    if (password !== passwordConfirm) {
      error = 'Пароли не совпадают';
      return;
    }

    submitting = true;
    try {
      const user = await register({
        login: loginValue.trim(),
        displayName: displayName.trim(),
        password,
        passwordConfirm
      });
      setUser(user);
      await goto('/');
    } catch (cause) {
      error = cause instanceof Error && cause.message ? cause.message : 'Не удалось создать аккаунт';
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>Регистрация · Voice Room</title>
  <meta name="theme-color" content="#10110f" />
</svelte:head>

<AuthShell>
  <h1 class="auth-title">Создать аккаунт</h1>
  <p class="auth-subtitle">Чтобы комнаты и имя оставались с вами.</p>

  <form class="auth-form" onsubmit={handleSubmit}>
    {#if error}
      <p class="auth-error" role="alert">{error}</p>
    {/if}

    <div class="auth-field">
      <label class="auth-label" for="loginInput">Логин</label>
      <input
        id="loginInput"
        class="auth-input"
        maxlength="32"
        autocapitalize="off"
        autocomplete="username"
        spellcheck="false"
        placeholder="например, vovosh"
        bind:value={loginValue}
        required
      />
    </div>

    <div class="auth-field">
      <label class="auth-label" for="displayNameInput">
        Отображаемое имя <span class="auth-label-soft">· необязательно</span>
      </label>
      <input
        id="displayNameInput"
        class="auth-input"
        maxlength="40"
        autocomplete="nickname"
        placeholder="Как вас будут видеть в комнате"
        bind:value={displayName}
      />
    </div>

    <div class="auth-field">
      <label class="auth-label" for="passwordInput">Пароль</label>
      <PasswordField id="passwordInput" autocomplete="new-password" placeholder="Минимум 8 символов" bind:value={password} />
    </div>

    <div class="auth-field">
      <label class="auth-label" for="passwordConfirmInput">Повторите пароль</label>
      <PasswordField id="passwordConfirmInput" autocomplete="new-password" placeholder="Ещё раз" bind:value={passwordConfirm} />
    </div>

    <button class="auth-submit" type="submit" disabled={submitting || !session.loaded}>
      {#if submitting}
        <span class="auth-spinner" aria-hidden="true"></span>Создаём…
      {:else}
        Создать аккаунт
      {/if}
    </button>
  </form>

  <p class="auth-foot">
    Уже есть аккаунт? <a class="auth-link" href="/login">Войти</a>
  </p>
</AuthShell>
