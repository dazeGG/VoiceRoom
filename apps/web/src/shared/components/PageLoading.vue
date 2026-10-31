<script setup lang="ts">
// Shown while a page's code downloads (lazy-page.ts), in the same card the
// session check shows, so the wait reads as one.
import { MascotIcon } from '@/shared/ui';
</script>

<template>
  <div class="app-shell">
    <main class="auth-loader" aria-label="Загрузка страницы" aria-busy="true">
      <div class="auth-loader__card">
        <span class="auth-loader__orb"><MascotIcon variant="look" :size="52" /></span>
        <p class="auth-loader__kicker">Загружаем</p>
        <h1 class="auth-loader__title">Открываем VoiceRoom</h1>
      </div>
    </main>
  </div>
</template>
