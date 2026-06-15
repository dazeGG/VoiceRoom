<script lang="ts">
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

<section class="entry-card" aria-label="Быстрый старт">
  <div class="entry-kicker">Быстрый старт</div>

  <button class="entry-primary" type="button" disabled={creatingTemp} onclick={onCreateTemp}>
    <span class="entry-primary-main">
      {#if creatingTemp}
        <span class="home-spinner" aria-hidden="true"></span>
      {:else}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2 L4 14 h6 l-1 8 L20 9 h-6 z"></path></svg>
      {/if}
      Создать временную комнату
    </span>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="13 5 20 12 13 19"></polyline></svg>
  </button>
  <p class="entry-hint">Без регистрации. Код и ссылка — сразу. Комната живёт, пока в ней есть люди, и ещё сутки после.</p>

  <div class="home-or entry-divider"><span>Нужны постоянные комнаты?</span></div>
  <div class="entry-auth">
    <a class="entry-auth-btn entry-auth-btn--solid" href="/login">Войти</a>
    <a class="entry-auth-btn entry-auth-btn--ghost" href="/register">Регистрация</a>
  </div>

  <div class="home-or entry-divider"><span>или войдите по коду</span></div>
  <form class="entry-join" onsubmit={submitJoin}>
    <input
      class="home-input home-input--code"
      maxlength="120"
      autocapitalize="off"
      autocomplete="off"
      spellcheck="false"
      placeholder="x7m2kq9p"
      bind:value={roomCode}
      onkeydown={onRoomCodeKeydown}
    />
    <button class="home-ghost-button" type="submit" disabled={joining}>Войти</button>
  </form>
</section>
