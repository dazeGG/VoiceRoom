<script lang="ts">
  import { ArrowRight, MessageSquare, MonitorPlay, Mic } from '@lucide/svelte';
  import { createRoom } from '$lib/api/rooms';
  import { markInAppRoomNavigation } from '$lib/platform/open-in-app';
  import { Button, MascotIcon } from '$lib/shared/ui';
  import { iconMd, iconSm } from '$lib/shared/ui/icons';

  let { onToast } = $props<{ onToast?: (message: string) => void }>();

  let creating = $state(false);

  // A phone may run the room page, so `/` offers the one thing it can start:
  // a temporary room, joined as a guest. Permanent rooms, the lobby, friends
  // and push stay behind the desktop boundary.
  async function createTempRoom(): Promise<void> {
    if (creating) return;
    creating = true;
    try {
      const roomId = await createRoom({ isStatic: false });
      markInAppRoomNavigation();
      window.location.href = `/r/${encodeURIComponent(roomId)}`;
    } catch (error) {
      creating = false;
      onToast?.(error instanceof Error && error.message ? error.message : 'Не удалось создать комнату');
    }
  }
</script>

<main class="mobile-start" aria-labelledby="mobileStartTitle">
  <section class="mobile-start-card">
    <span class="mobile-start-orb"><MascotIcon variant="look" size={52} /></span>
    <p class="mobile-start-kicker">Комната по ссылке за секунду</p>
    <h1 id="mobileStartTitle">Голосовая комната прямо в браузере</h1>
    <p class="mobile-start-lead">
      Создайте временную комнату и отправьте ссылку друзьям. Имя и регистрация не нужны.
    </p>

    <Button variant="primary" type="button" disabled={creating} onclick={createTempRoom}>
      {#if creating}
        <span class="mobile-start-spinner" aria-hidden="true"></span>
      {/if}
      {creating ? 'Создаём…' : 'Создать комнату'}
      {#if !creating}<ArrowRight {...iconMd} aria-hidden="true" />{/if}
    </Button>

    <ul class="mobile-start-features">
      <li><Mic {...iconSm} aria-hidden="true" /> Голос</li>
      <li><MessageSquare {...iconSm} aria-hidden="true" /> Чат комнаты</li>
      <li><MonitorPlay {...iconSm} aria-hidden="true" /> Чужой экран</li>
    </ul>

    <p class="mobile-start-note">
      Комната живёт, пока в ней есть люди. Свои комнаты, друзья и личные сообщения —
      на компьютере или в приложении.
    </p>
  </section>
</main>

<style>
  .mobile-start {
    box-sizing: border-box;
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: 24px 16px calc(24px + env(safe-area-inset-bottom));
    background: var(--paper-deep);
    font-family: var(--font-ui);
  }

  .mobile-start-card {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 14px;
    width: min(440px, 100%);
    padding: clamp(22px, 6vw, 30px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: var(--radius-xl);
    background: var(--warm-800);
    box-shadow: var(--shadow);
  }

  .mobile-start-orb {
    display: grid;
    place-items: center;
    width: 64px;
    height: 64px;
    border-radius: 20px;
    background: color-mix(in oklch, var(--accent) 12%, var(--control));
  }

  .mobile-start-kicker {
    margin: 0;
    color: var(--accent);
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .mobile-start-card h1 {
    margin: 0;
    color: var(--warm-ink);
    font-size: clamp(24px, 7vw, 30px);
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.12;
  }

  .mobile-start-lead {
    margin: 0;
    color: var(--warm-muted);
    font-size: 14.5px;
    line-height: 1.5;
  }

  .mobile-start-card :global(.ui-button) {
    width: 100%;
    margin-top: 4px;
  }

  .mobile-start-spinner {
    width: 15px;
    height: 15px;
    border: 2px solid color-mix(in srgb, var(--accent-ink) 35%, transparent);
    border-top-color: var(--accent-ink);
    border-radius: 50%;
    animation: mobile-start-spin 0.7s linear infinite;
  }

  @keyframes mobile-start-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .mobile-start-features {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .mobile-start-features li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 11px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: var(--radius-pill);
    background: var(--control);
    color: var(--warm-ink);
    font-size: 12.5px;
    font-weight: 650;
  }

  .mobile-start-note {
    margin: 0;
    color: var(--muted);
    font-size: 12.5px;
    line-height: 1.45;
  }
</style>
