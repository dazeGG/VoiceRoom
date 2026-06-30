<script lang="ts">
  import { state } from '../client/core/state.svelte';
  import { startUi } from '../start-ui.svelte';
</script>

<main class="not-found-layout" id="notFoundScreen" hidden={state.screen !== 'not-found'} aria-labelledby="notFoundTitle">
  <div class="not-found-watermark" aria-hidden="true">404</div>
  <div class="not-found-content">
    <h1 class="not-found-title" id="notFoundTitle">Комнаты с таким кодом нет</h1>
    <p class="not-found-copy">
      Код <span class="not-found-code"><span class="not-found-code-dot" aria-hidden="true"></span><span id="missingRoomCode">{startUi.missingRoomCode}</span></span> не привязан к активной комнате. Возможно, она уже завершилась, или в коде опечатка.
    </p>
    <div class="not-found-actions">
      <a class="not-found-home" href="/" data-sveltekit-reload>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 11l9-8 9 8"></path>
          <path d="M5 10v10h14V10"></path>
        </svg>
        На стартовый экран
      </a>
    </div>
  </div>
</main>