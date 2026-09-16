<script lang="ts">
  import AuthDialog, { type AuthMode } from '$lib/features/auth/AuthDialog.svelte';
  import { addRoomByCode } from '$lib/api/auth';
  import { Button } from '$lib/shared/ui';
  import { guestLeaveUi } from '../guest-leave.svelte';

  let authMode = $state<AuthMode | null>(null);

  function goHome(): void {
    window.location.href = '/';
  }

  // A permanent room is saved to the new account, so «вернёшься сюда» is true.
  // A temporary room is deleted once empty and promises nothing.
  async function afterAccountCreated(): Promise<void> {
    if (guestLeaveUi.isStatic && guestLeaveUi.roomId) {
      try {
        await addRoomByCode(guestLeaveUi.roomId);
      } catch (error) {
        console.error('[voice-room] save left room to new account', error);
      }
    }
    goHome();
  }
</script>

{#if guestLeaveUi.open}
  <div class="guest-leave" role="dialog" aria-modal="true" aria-labelledby="guestLeaveTitle">
    <div class="guest-leave-card">
      <h1 id="guestLeaveTitle">Вы вышли из комнаты</h1>
      {#if guestLeaveUi.isStatic}
        <p>Создайте аккаунт, и эта комната сохранится у вас: вернётесь сюда без ссылки.</p>
      {:else}
        <p>С аккаунтом у вас будут свои постоянные комнаты, друзья и личные сообщения.</p>
      {/if}
      <div class="guest-leave-actions">
        <Button variant="primary" type="button" onclick={() => (authMode = 'register')}>Создать аккаунт</Button>
        <Button variant="ghost" type="button" onclick={goHome}>Не сейчас</Button>
      </div>
    </div>
  </div>
{/if}

{#if authMode}
  <AuthDialog
    mode={authMode}
    onClose={() => (authMode = null)}
    onModeChange={(mode) => (authMode = mode)}
    onAuthenticated={afterAccountCreated}
  />
{/if}

<style>
  .guest-leave {
    position: fixed;
    inset: 0;
    z-index: 55;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: color-mix(in srgb, var(--warm-950) 78%, transparent);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
  }

  .guest-leave-card {
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: min(440px, 100%);
    padding: 26px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: var(--radius-xl);
    background: var(--warm-800);
    box-shadow: var(--shadow);
  }

  .guest-leave-card h1 {
    margin: 0;
    color: var(--warm-ink);
    font-family: var(--font-ui);
    font-size: 20px;
    font-weight: 700;
  }

  .guest-leave-card p {
    margin: 0;
    color: var(--warm-muted);
    font-size: 14px;
    line-height: 1.5;
  }

  .guest-leave-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 6px;
  }
</style>
