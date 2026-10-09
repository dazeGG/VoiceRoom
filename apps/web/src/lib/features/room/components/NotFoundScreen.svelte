<script lang="ts">
  import { Home } from '@lucide/svelte';
  import { iconMd } from '$lib/shared/ui/icons';
  import { MascotIcon } from '$lib/shared/ui';
  import { state } from '../client/core/state.svelte';
  import { startUi } from '../start-ui.svelte';
</script>

<main
  class="not-found-layout"
  id="notFoundScreen"
  hidden={state.screen !== 'not-found'}
  aria-labelledby="notFoundTitle"
>
  <div class="not-found-watermark" aria-hidden="true">404</div>
  <div class="not-found-content">
    <div class="not-found-mascot"><MascotIcon variant="scare" size={72} /></div>
    <h1 class="not-found-title" id="notFoundTitle">Комнаты с таким кодом нет</h1>
    <p class="not-found-copy">
      Код <span class="not-found-code"
        ><span class="not-found-code-dot" aria-hidden="true"></span><span id="missingRoomCode"
          >{startUi.missingRoomCode}</span
        ></span
      > не привязан к активной комнате. Возможно, она уже завершилась, или в коде опечатка.
    </p>
    <div class="not-found-actions">
      <a class="not-found-home" href="/" data-sveltekit-reload>
        <Home {...iconMd} aria-hidden="true" />
        На стартовый экран
      </a>
    </div>
  </div>
</main>

<style>
  :global(.not-found-mascot) {
    display: inline-flex;
    margin-bottom: 22px;
  }
  :global(.not-found-code) {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 4px 10px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    background: var(--vr-surface-3);
    font-family: var(--font-mono);
    font-size: 14.5px;
    letter-spacing: 0.04em;
    color: var(--vr-text-2);
    vertical-align: middle;
    overflow-wrap: anywhere;
  }
  :global(.not-found-code-dot) {
    width: 6px;
    height: 6px;
    flex: 0 0 auto;
    border-radius: 50%;
    background: var(--vr-danger);
  }
</style>
