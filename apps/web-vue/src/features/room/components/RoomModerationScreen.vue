<script setup lang="ts">
import { computed } from 'vue';
import { state } from '@/features/room/client/core/room-runtime.store';
import { usePageStore } from '@/stores/page.store';

const page = usePageStore();

const banned = computed(() => state.moderationReason === 'banned');
</script>

<template>
  <main class="not-found" :hidden="page.screen !== 'moderation'" aria-labelledby="moderationTitle">
    <div class="not-found__watermark" aria-hidden="true">!</div>
    <div class="not-found__content">
      <h1 id="moderationTitle" class="not-found__title">
        {{ banned ? 'Вы заблокированы в этой комнате' : 'Вас исключили из комнаты' }}
      </h1>
      <p class="not-found__copy">
        {{
          banned
            ? 'Владелец комнаты закрыл для вас доступ.'
            : 'Соединение остановлено владельцем комнаты. Вы можете вернуться на главный экран.'
        }}
      </p>
      <div class="not-found__actions">
        <!-- A full page load, as data-sveltekit-reload was. -->
        <a class="not-found__home" href="/">На главный экран</a>
      </div>
    </div>
  </main>
</template>
