<script setup lang="ts">
import { showRoomRoute } from '@/features/room/client/room/room';
import { usePageStore } from '@/stores/page.store';

const page = usePageStore();

function retry(): void {
  void showRoomRoute();
}
</script>

<template>
  <main
    id="entryErrorScreen"
    class="not-found"
    :hidden="page.screen !== 'entry-error'"
    aria-labelledby="entryErrorTitle"
  >
    <div class="not-found__watermark" aria-hidden="true">!</div>
    <div class="not-found__content">
      <h1 id="entryErrorTitle" class="not-found__title">Не удалось проверить вход</h1>
      <p class="not-found__copy">
        Мы не смогли проверить аккаунт или подготовить гостевой вход. Попробуйте ещё раз — комната останется открытой.
      </p>
      <div class="not-found__actions">
        <button id="entryRetryButton" class="not-found__home" type="button" @click="retry">Повторить проверку</button>
        <!-- A full page load, as data-sveltekit-reload was. -->
        <a class="not-found__home" href="/">На стартовый экран</a>
      </div>
    </div>
  </main>
</template>
