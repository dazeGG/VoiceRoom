<script lang="ts">
  import { ArrowRight } from '@lucide/svelte';
  import { Button } from '$lib/shared/ui';
  import { START_FEATURES } from '$lib/features/shared-content/start-features';
  import { iconMd } from '$lib/shared/ui/icons';
  import LandingFeatureGrid from './LandingFeatureGrid.svelte';

  let {
    creatingTemp,
    joining,
    roomCode = $bindable(),
    onCreateTemp,
    onJoin,
    onRoomCodeKeydown
  } = $props<{
    creatingTemp: boolean;
    joining: boolean;
    roomCode: string;
    onCreateTemp: () => void;
    onJoin: () => void;
    onRoomCodeKeydown: (event: KeyboardEvent) => void;
  }>();

  function submitJoin(event: Event): void {
    event.preventDefault();
    onJoin();
  }
</script>

<section class="landing-hero" aria-labelledby="landingTitle">
  <p class="landing-kicker"><span class="landing-kicker-dot"></span>Комната по ссылке за секунду</p>
  <h1 class="landing-title" id="landingTitle">Голосовые комнаты для своих</h1>
  <p class="landing-lead">
    Нажмите — и вы уже в комнате. Код и ссылка появятся сразу. Аккаунт нужен, только чтобы сохранять комнаты.
  </p>

  <div class="landing-cta-row">
    <Button variant="primary" size="xl" disabled={creatingTemp} onclick={onCreateTemp}>
      {#if creatingTemp}
        <span class="home-spinner" aria-hidden="true"></span>
      {/if}
      Создать комнату
      <ArrowRight {...iconMd} aria-hidden="true" />
    </Button>

    <form class="landing-join" onsubmit={submitJoin}>
      <!-- A search field, so iCloud Passwords does not offer logins here. -->
      <input
        class="landing-join-input"
        type="search"
        name="room-search"
        placeholder="Код комнаты"
        aria-label="Код комнаты"
        maxlength="120"
        autocapitalize="off"
        autocomplete="off"
        spellcheck="false"
        data-1p-ignore
        data-lpignore="true"
        data-bwignore
        bind:value={roomCode}
        onkeydown={onRoomCodeKeydown}
      />
      <button class="landing-join-btn" type="submit" disabled={joining}>Войти</button>
    </form>
  </div>

  <p class="landing-disclaimer">Без имени и регистрации · комната живёт, пока в ней есть люди, и ещё сутки после</p>

  <LandingFeatureGrid items={START_FEATURES} />
</section>

<style>
  .landing-hero {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    text-align: left;
  }
  .landing-kicker {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 16px;
    color: var(--vr-accent);
    font-size: 13.5px;
    font-weight: 500;
  }
  .landing-kicker-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--vr-accent);
    box-shadow: 0 0 0 3px var(--vr-accent-soft);
  }
  .landing-title {
    margin: 0;
    color: var(--vr-text);
    font-size: clamp(34px, 4.6vw, 58px);
    font-weight: 600;
    line-height: 1.04;
    letter-spacing: -0.035em;
    text-wrap: balance;
  }
  .landing-lead {
    max-width: 500px;
    margin: 18px 0 0;
    color: var(--vr-text-2);
    font-size: 17px;
    line-height: 1.55;
    text-wrap: pretty;
  }
  .landing-cta-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-top: 28px;
  }
  .landing-join {
    display: flex;
    align-items: stretch;
    height: 50px;
    overflow: hidden;
    border: 1px solid var(--vr-line-strong);
    border-radius: 13px;
    background: var(--vr-surface-2);
  }
  .landing-join:focus-within {
    border-color: var(--vr-accent-line);
  }
  .landing-join-input {
    appearance: none;
    width: 170px;
    height: 100%;
    padding: 0 16px;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--vr-text);
    font-family: var(--font-mono);
    font-size: 14px;
  }
  .landing-join-input::placeholder {
    color: var(--vr-text-3);
  }
  .landing-join-input::-webkit-search-cancel-button,
  .landing-join-input::-webkit-search-decoration {
    appearance: none;
  }
  .landing-join-btn {
    padding: 0 18px;
    border: 0;
    border-left: 1px solid var(--vr-line-strong);
    background: transparent;
    color: var(--vr-text);
    font: 500 14.5px var(--font-ui);
    cursor: pointer;
  }
  .landing-join-btn:hover:not(:disabled) {
    background: var(--vr-hover);
  }
  .landing-disclaimer {
    margin: 14px 0 0;
    color: var(--vr-text-3);
    font-size: 13px;
  }
</style>
