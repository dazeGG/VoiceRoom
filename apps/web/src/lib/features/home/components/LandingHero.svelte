<script lang="ts">
  import { START_FEATURES } from '$lib/features/shared-content/start-features';
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
  <p class="landing-kicker">Комната по ссылке за секунду</p>
  <h1 class="landing-title" id="landingTitle">Голосовая комната без лишних дверей</h1>
  <p class="landing-lead">Нажмите — и вы уже в комнате. Код и ссылка появятся сразу. Аккаунт нужен, только чтобы сохранять комнаты.</p>

  <div class="landing-cta-row">
    <button class="landing-primary-button" type="button" disabled={creatingTemp} onclick={onCreateTemp}>
      {#if creatingTemp}
        <span class="home-spinner" aria-hidden="true"></span>
      {/if}
      Создать временную комнату
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="13 5 20 12 13 19"></polyline></svg>
    </button>

    <form class="lv-join" onsubmit={submitJoin}>
      <input
        class="lv-join-input"
        placeholder="Код комнаты"
        maxlength="120"
        autocapitalize="off"
        autocomplete="off"
        spellcheck="false"
        bind:value={roomCode}
        onkeydown={onRoomCodeKeydown}
      />
      <button class="lv-join-btn" type="submit" disabled={joining}>Войти</button>
    </form>
  </div>

  <p class="landing-disclaimer">Без имени и регистрации · комната живёт, пока в ней есть люди, и ещё сутки после</p>

  <p class="landing-auth-line">Нужны постоянные комнаты? <a href="/login">Войти</a> · <a href="/register">Регистрация</a></p>

  <LandingFeatureGrid items={START_FEATURES} />
</section>
