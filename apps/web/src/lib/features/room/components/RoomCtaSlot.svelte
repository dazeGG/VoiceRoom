<script lang="ts">
  import { onMount } from 'svelte';
  import { X } from '@lucide/svelte';
  import AuthDialog, { type AuthMode } from '$lib/features/auth/AuthDialog.svelte';
  import { session } from '$lib/features/auth/session.svelte';
  import AppBenefitsModal from '$lib/features/home/components/AppBenefitsModal.svelte';
  import { readOpenInAppSignals, shouldOfferOpenInApp } from '$lib/platform/open-in-app';
  import { Button } from '$lib/shared/ui';
  import { iconSm } from '$lib/shared/ui/icons';
  import { isRoomEmbedded } from '../client/core/embed';
  import { state as roomClientState } from '../client/core/state.svelte';
  import { rejoinRoomSignedIn } from '../client/room/room';
  import { resolveRoomCta } from '../room-cta';

  // Decided once per page: the platform does not change under a visit.
  let appAvailable = $state(false);
  let embedded = $state(false);
  let dismissed = $state(false);
  let authMode = $state<AuthMode | null>(null);
  let benefitsOpen = $state(false);

  onMount(() => {
    appAvailable = shouldOfferOpenInApp(readOpenInAppSignals());
    embedded = isRoomEmbedded();
  });

  const cta = $derived(resolveRoomCta({
    joined: roomClientState.joined,
    guest: !embedded && !session.user,
    appAvailable,
    hasUsedDesktopApp: session.user?.hasUsedDesktopApp ?? false,
    dismissed
  }));
</script>

{#if cta}
  <aside class="room-cta" aria-label={cta === 'account' ? 'Создать аккаунт' : 'Скачать приложение'}>
    {#if cta === 'account'}
      <span class="room-cta-text">
        {roomClientState.roomIsStatic
          ? 'Создайте аккаунт, чтобы сохранить комнату и возвращаться без ссылки'
          : 'С аккаунтом у вас будут свои комнаты, друзья и личные сообщения'}
      </span>
      <Button variant="primary" type="button" onclick={() => (authMode = 'register')}>Создать аккаунт</Button>
    {:else}
      <span class="room-cta-text">В приложении есть оверлей поверх игр, горячие клавиши и Push-to-talk</span>
      <Button variant="primary" type="button" onclick={() => (benefitsOpen = true)}>Скачать приложение</Button>
    {/if}
    <button class="room-cta-close" type="button" aria-label="Скрыть до следующего захода" onclick={() => (dismissed = true)}>
      <X {...iconSm} aria-hidden="true" />
    </button>
  </aside>
{/if}

{#if authMode}
  <AuthDialog
    mode={authMode}
    onClose={() => (authMode = null)}
    onModeChange={(mode) => (authMode = mode)}
    onAuthenticated={() => rejoinRoomSignedIn(roomClientState.roomId)}
  />
{/if}

<AppBenefitsModal open={benefitsOpen} onClose={() => (benefitsOpen = false)} />

<style>
  .room-cta {
    position: absolute;
    top: 88px;
    left: 50%;
    z-index: 15;
    display: flex;
    align-items: center;
    gap: 12px;
    width: max-content;
    max-width: min(640px, calc(100% - 32px));
    padding: 8px 8px 8px 16px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: var(--radius-pill);
    background: var(--warm-800);
    box-shadow: var(--shadow);
    transform: translateX(-50%);
  }

  .room-cta-text {
    color: var(--warm-ink);
    font-size: 13px;
    line-height: 1.35;
  }

  .room-cta-close {
    display: grid;
    place-items: center;
    flex: none;
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: var(--radius-pill);
    background: transparent;
    color: var(--warm-muted);
    cursor: pointer;
  }

  .room-cta-close:hover {
    background: var(--control-hover);
    color: var(--warm-ink);
  }

  @media (max-width: 640px) {
    .room-cta {
      flex-wrap: wrap;
      border-radius: var(--radius-lg);
    }
  }
</style>
