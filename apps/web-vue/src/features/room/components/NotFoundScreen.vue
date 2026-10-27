<script setup lang="ts">
import { House } from '@lucide/vue';
import { useStartUiStore } from '@/features/room/start-ui.store';
import { MascotIcon } from '@/shared/ui';
import { iconMd } from '@/shared/ui/icons';
import { usePageStore } from '@/stores/page.store';

const startUi = useStartUiStore();
const page = usePageStore();
</script>

<template>
  <main id="notFoundScreen" class="not-found" :hidden="page.screen !== 'not-found'" aria-labelledby="notFoundTitle">
    <div class="not-found__watermark" aria-hidden="true">404</div>
    <div class="not-found__content">
      <div class="not-found__mascot"><MascotIcon variant="scare" :size="72" /></div>
      <h1 id="notFoundTitle" class="not-found__title">Комнаты с таким кодом нет</h1>
      <p class="not-found__copy">
        Код
        <span class="not-found__code"
          ><span class="not-found__code-dot" aria-hidden="true"></span
          ><span id="missingRoomCode">{{ startUi.missingRoomCode }}</span></span
        >
        не привязан к активной комнате. Возможно, она уже завершилась, или в коде опечатка.
      </p>
      <div class="not-found__actions">
        <!-- A full page load, as data-sveltekit-reload was. -->
        <a class="not-found__home" href="/">
          <House v-bind="iconMd" aria-hidden="true" />
          На стартовый экран
        </a>
      </div>
    </div>
  </main>
</template>
