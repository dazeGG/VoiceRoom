<script setup lang="ts">
// A page whose code did not download after the retries (lazy-page.ts). A full
// load is the way out: it fetches the current build, as the router does for a
// route that fails to load.
function reload(): void {
  window.location.reload();
}
</script>

<template>
  <div class="app-shell">
    <main class="auth-session-error" aria-label="Страница не загрузилась" aria-live="polite">
      <div class="auth-session-error__card">
        <p class="auth-session-error__kicker">Страница не загрузилась</p>
        <h1 class="auth-session-error__title">Не удалось загрузить VoiceRoom</h1>
        <p class="auth-session-error__text">Проверьте подключение к интернету и обновите страницу.</p>
        <button type="button" @click="reload">Обновить</button>
      </div>
    </main>
  </div>
</template>
