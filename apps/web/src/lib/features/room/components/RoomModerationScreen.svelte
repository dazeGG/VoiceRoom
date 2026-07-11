<script lang="ts">
  import { state } from '../client/core/state.svelte';

  const banned = $derived(state.moderationReason === 'banned');
</script>

<main class="not-found-layout" hidden={state.screen !== 'moderation'} aria-labelledby="moderationTitle">
  <div class="not-found-watermark" aria-hidden="true">!</div>
  <div class="not-found-content">
    <h1 class="not-found-title" id="moderationTitle">
      {banned ? 'Вы заблокированы в этой комнате' : 'Вас исключили из комнаты'}
    </h1>
    <p class="not-found-copy">
      {banned
        ? 'Владелец комнаты закрыл для вас доступ.'
        : 'Соединение остановлено владельцем комнаты. Вы можете вернуться на главный экран.'}
    </p>
    <div class="not-found-actions">
      <a class="not-found-home" href="/" data-sveltekit-reload>На главный экран</a>
    </div>
  </div>
</main>
