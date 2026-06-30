<script lang="ts">
  import { state } from '../client/core/state.svelte';
  import { showRoomRoute } from '../client/room/room';
</script>

<main class="not-found-layout" id="entryErrorScreen" hidden={state.screen !== 'entry-error'} aria-labelledby="entryErrorTitle">
  <div class="not-found-watermark" aria-hidden="true">!</div>
  <div class="not-found-content">
    <h1 class="not-found-title" id="entryErrorTitle">Не удалось проверить вход</h1>
    <p class="not-found-copy">
      Мы не смогли проверить аккаунт или подготовить гостевой вход. Попробуйте ещё раз — комната останется открытой.
    </p>
    <div class="not-found-actions">
      <button class="not-found-home" id="entryRetryButton" type="button" onclick={() => void showRoomRoute()}>Повторить проверку</button>
      <a class="not-found-home" href="/" data-sveltekit-reload>На стартовый экран</a>
    </div>
  </div>
</main>