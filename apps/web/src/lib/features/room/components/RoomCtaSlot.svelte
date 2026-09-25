<script lang="ts">
  import { onMount } from 'svelte';
  import { MonitorDown, UserPlus, X } from '@lucide/svelte';
  import AuthDialog, { type AuthMode } from '$lib/features/auth/AuthDialog.svelte';
  import { session } from '$lib/features/auth/session.svelte';
  import AppBenefitsModal from '$lib/features/home/components/AppBenefitsModal.svelte';
  import { getDesktopBoundaryPolicy } from '$lib/platform/desktop-boundary';
  import { readOpenInAppSignals, shouldOfferOpenInApp } from '$lib/platform/open-in-app';
  import { Button } from '$lib/shared/ui';
  import { iconMd, iconSm } from '$lib/shared/ui/icons';
  import { isRoomEmbedded } from '../client/core/embed';
  import { state as roomClientState } from '../client/core/state.svelte';
  import { rejoinRoomSignedIn } from '../client/room/room';
  import { resolveRoomCta } from '../room-cta';

  // Decided once per page: the platform does not change under a visit.
  let appAvailable = $state(false);
  let embedded = $state(false);
  let mobile = $state(false);
  let dismissed = $state(false);
  let authMode = $state<AuthMode | null>(null);
  let benefitsOpen = $state(false);

  onMount(() => {
    appAvailable = shouldOfferOpenInApp(readOpenInAppSignals());
    embedded = isRoomEmbedded();
    mobile = !getDesktopBoundaryPolicy().desktopAllowed;
  });

  const cta = $derived(
    resolveRoomCta({
      joined: roomClientState.joined,
      guest: !embedded && !session.user,
      appAvailable,
      hasUsedDesktopApp: session.user?.hasUsedDesktopApp ?? false,
      dismissed
    })
  );

  // One promise per offer: a headline worth reading, and the reason under it.
  const copy = $derived.by(() => {
    if (cta === 'app') {
      return {
        label: 'Скачать приложение',
        title: 'В приложении звонок удобнее',
        text: 'Оверлей поверх игр, горячие клавиши и push-to-talk',
        action: 'Скачать'
      };
    }
    if (roomClientState.roomIsStatic) {
      return {
        label: 'Создать аккаунт',
        title: 'Сохраните эту комнату за собой',
        text: 'С аккаунтом она останется в списке — вернётесь без ссылки',
        action: 'Создать аккаунт'
      };
    }
    return {
      label: 'Создать аккаунт',
      title: 'Заберите этот звонок с собой',
      text: 'Свои комнаты, друзья и личные сообщения — в одном аккаунте',
      action: 'Создать аккаунт'
    };
  });
</script>

{#if cta || (mobile && roomClientState.joined)}
  <div class="room-cta-stack">
    {#if cta}
      <aside class="room-cta" data-kind={cta} aria-label={copy.label}>
        <span class="room-cta-icon" aria-hidden="true">
          {#if cta === 'account'}<UserPlus {...iconMd} />{:else}<MonitorDown {...iconMd} />{/if}
        </span>
        <div class="room-cta-copy">
          <strong class="room-cta-title">{copy.title}</strong>
          <span class="room-cta-text">{copy.text}</span>
        </div>
        <Button
          class="compact room-cta-action"
          variant="primary"
          type="button"
          onclick={() => (cta === 'account' ? (authMode = 'register') : (benefitsOpen = true))}>{copy.action}</Button
        >
        <button
          class="room-cta-close"
          type="button"
          aria-label="Скрыть до следующего захода"
          onclick={() => (dismissed = true)}
        >
          <X {...iconSm} aria-hidden="true" />
        </button>
      </aside>
    {/if}
    {#if mobile && roomClientState.joined}
      <!-- A mobile browser suspends the microphone when it leaves the foreground. -->
      <p class="room-mobile-hint" role="note">Звонок идёт, пока браузер открыт и экран включён</p>
    {/if}
  </div>
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
  /* Floats just above the dock, mirroring its offsets, so it never covers the
     heading: on narrow screens the heading wraps and its tabs move down. */
  .room-cta-stack {
    position: fixed;
    right: 0;
    bottom: calc(max(var(--space-lg), env(safe-area-inset-bottom)) + 80px);
    left: 0;
    z-index: 15;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding-inline: 16px;
    pointer-events: none;
  }

  .room-cta-stack > :global(*) {
    max-width: min(640px, 100%);
    pointer-events: auto;
  }

  :global(body[data-lobby-embedded='true']) .room-cta-stack {
    left: var(--lobby-sidebar-width, 312px);
  }

  @media (min-width: 901px) {
    :global(body[data-chat-open='true']) .room-cta-stack {
      right: var(--room-panel-width);
    }
  }

  .room-mobile-hint {
    margin: 0;
    padding: 6px 12px;
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--warm-800) 88%, transparent);
    color: var(--warm-muted);
    font-size: 12px;
    text-align: center;
  }

  /* Reads as a second dock: same glass, same 18px corner and the same inner
     13px radius on the icon, so the pair sits together instead of the card
     looking bolted on above it. */
  .room-cta {
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 100%;
    padding: 10px 11px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 18px;
    background: color-mix(in srgb, color-mix(in srgb, var(--warm-800) 60%, var(--warm-900)) 90%, transparent);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55);
  }

  .room-cta-icon {
    display: grid;
    place-items: center;
    flex: none;
    width: 38px;
    height: 38px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 13px;
    background: color-mix(in oklch, var(--accent) 14%, var(--control));
    color: var(--accent);
  }

  .room-cta-copy {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .room-cta-title {
    color: var(--warm-ink);
    font-size: 14px;
    font-weight: 700;
    letter-spacing: -0.01em;
    line-height: 1.25;
  }

  .room-cta-text {
    color: var(--warm-muted);
    font-size: 12.5px;
    line-height: 1.35;
  }

  .room-cta-close {
    display: grid;
    place-items: center;
    flex: none;
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: 11px;
    background: transparent;
    color: #8c8676;
    cursor: pointer;
    transition:
      background 150ms var(--ease-out),
      color 150ms var(--ease-out);
  }

  .room-cta-close:hover {
    background: var(--control-hover);
    color: var(--warm-ink);
  }

  /* Narrow: the copy keeps the full width next to the icon and the action drops
     to its own row, so neither the headline nor the button is squeezed. */
  @media (max-width: 640px) {
    .room-cta {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      column-gap: 10px;
      row-gap: 10px;
      padding: 12px;
    }

    /* Placed explicitly: the action spans the full width, and sparse
       auto-placement would otherwise push the close button past it into a
       third row instead of the free cell beside the copy. */
    .room-cta-icon {
      grid-column: 1;
      grid-row: 1;
    }

    .room-cta-copy {
      grid-column: 2;
      grid-row: 1;
    }

    .room-cta-close {
      grid-column: 3;
      grid-row: 1;
      width: 40px;
      height: 40px;
      align-self: start;
      margin: -4px -4px 0 0;
    }

    .room-cta :global(.room-cta-action) {
      grid-column: 1 / -1;
      grid-row: 2;
      width: 100%;
    }
  }
</style>
