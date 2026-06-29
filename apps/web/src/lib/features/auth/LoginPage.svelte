<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { login } from '$lib/api/auth';
  import { createRoom } from '$lib/api/rooms';
  import { loadSession, session, setUser } from './session.svelte';
  import AuthShell from './AuthShell.svelte';
  import PasswordField from './PasswordField.svelte';

  let loginValue = $state('');
  let password = $state('');
  let error = $state('');
  let submitting = $state(false);
  let creatingTemp = $state(false);

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
    submitting = true;
    try {
      const user = await login({ login: loginValue.trim(), password });
      setUser(user);
      await goto('/');
    } catch (cause) {
      error = cause instanceof Error && cause.message ? cause.message : 'Не удалось войти';
    } finally {
      submitting = false;
    }
  }

  async function createTempRoom(): Promise<void> {
    if (creatingTemp) return;
    creatingTemp = true;
    try {
      const roomId = await createRoom({ isStatic: false });
      window.location.href = `/r/${encodeURIComponent(roomId)}`;
    } catch (cause) {
      error = cause instanceof Error && cause.message ? cause.message : 'Не удалось создать комнату';
      creatingTemp = false;
    }
  }
</script>

<svelte:head>
  <title>Вход · Voice Room</title>
  <meta name="theme-color" content="#10110f" />
</svelte:head>

<AuthShell>
  <h1 class="auth-title">Вход</h1>
  <p class="auth-subtitle">Рады видеть снова.</p>

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
        placeholder="Ваш логин"
        bind:value={loginValue}
        required
      />
    </div>

    <div class="auth-field">
      <label class="auth-label" for="passwordInput">Пароль</label>
      <PasswordField id="passwordInput" autocomplete="current-password" placeholder="Ваш пароль" bind:value={password} />
    </div>

    <button class="auth-submit" type="submit" disabled={submitting || !session.loaded}>
      {#if submitting}
        <span class="auth-spinner" aria-hidden="true"></span>Входим…
      {:else}
        Войти
      {/if}
    </button>
  </form>

  <p class="auth-foot">
    Нет аккаунта? <a class="auth-link" href="/register">Регистрация</a>
  </p>
  <p class="auth-foot">
    или
    <button type="button" class="auth-link auth-link-soft" onclick={createTempRoom} disabled={creatingTemp}>
      создать временную комнату
    </button>
  </p>
</AuthShell>
