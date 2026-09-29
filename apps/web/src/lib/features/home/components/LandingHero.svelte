<script lang="ts">
  import { ArrowRight } from '@lucide/svelte';
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
  <p class="landing-kicker">Комната по ссылке за секунду</p>
  <h1 class="landing-title" id="landingTitle">Голосовая комната без лишних дверей</h1>
  <p class="landing-lead">
    Нажмите — и вы уже в комнате. Код и ссылка появятся сразу. Аккаунт нужен, только чтобы сохранять комнаты.
  </p>

  <div class="landing-cta-row">
    <button class="landing-primary-button" type="button" disabled={creatingTemp} onclick={onCreateTemp}>
      {#if creatingTemp}
        <span class="home-spinner" aria-hidden="true"></span>
      {/if}
      Создать временную комнату
      <ArrowRight {...iconMd} aria-hidden="true" />
    </button>

    <form class="lv-join" onsubmit={submitJoin}>
      <input
        class="lv-join-input"
        placeholder="Код комнаты"
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
      <button class="lv-join-btn" type="submit" disabled={joining}>Войти</button>
    </form>
  </div>

  <p class="landing-disclaimer">Без имени и регистрации · комната живёт, пока в ней есть люди, и ещё сутки после</p>

  <LandingFeatureGrid items={START_FEATURES} />
</section>

<style>
  :global(.landing-hero) {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  :global(.landing-kicker) {
    margin: 0 0 20px;
    font-family: var(--font-ui);
    font-size: 12px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--accent);
  }
  :global(.landing-title) {
    margin: 0;
    max-width: 16ch;
    font-family: var(--font-display);
    font-weight: 700;
    font-size: clamp(2.5rem, 5.5vw, 4.125rem);
    line-height: 1;
    letter-spacing: -0.035em;
    color: var(--warm-ink, var(--warm-100));
  }
  :global(.landing-lead) {
    margin: 22px 0 0;
    max-width: 540px;
    font-size: 17.5px;
    line-height: 1.55;
    color: var(--warm-muted, var(--warm-muted));
  }
  :global(.landing-disclaimer) {
    margin: 16px 0 0;
    color: var(--warm-faint, var(--warm-faint));
    font-size: 13px;
  }
</style>
