<script lang="ts">
  import { Home } from '@lucide/svelte';
  import { iconMd } from '$lib/shared/ui/icons';
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
        <Home {...iconMd} aria-hidden="true" />
        На стартовый экран
      </a>
    </div>
  </div>
</main>