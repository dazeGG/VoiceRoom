<script setup lang="ts">
import { t } from '@/shared/i18n';
import { House } from '@lucide/vue';
import { useStartUiStore } from '@voice-room/call/engine/core/start-ui.store';
import { APP_HOME } from '@/shared/app-home';
import { MascotIcon } from '@voice-room/ui/components';
import { iconMd } from '@voice-room/ui/icon-defaults';
import { useCallPageStore } from '@voice-room/call/engine/core/call-page.store';

const startUi = useStartUiStore();
const page = useCallPageStore();
</script>

<template>
  <main id="notFoundScreen" class="not-found" :hidden="page.screen !== 'not-found'" aria-labelledby="notFoundTitle">
    <div class="not-found__watermark" aria-hidden="true">404</div>
    <div class="not-found__content">
      <div class="not-found__mascot"><MascotIcon variant="scare" :size="72" /></div>
      <h1 id="notFoundTitle" class="not-found__title">{{ t('Комнаты с таким кодом нет') }}</h1>
      <p class="not-found__copy">
        {{ t('Код') }}
        <span class="not-found__code"
          ><span class="not-found__code-dot" aria-hidden="true"></span
          ><span id="missingRoomCode">{{ startUi.missingRoomCode }}</span></span
        >
        {{ t('не привязан к активной комнате. Возможно, она уже завершилась, или в коде опечатка.') }}
      </p>
      <div class="not-found__actions">
        <!-- A full page load, as data-sveltekit-reload was. -->
        <a class="not-found__home" :href="APP_HOME">
          <House v-bind="iconMd" aria-hidden="true" /> {{ t('На стартовый экран') }}
        </a>
      </div>
    </div>
  </main>
</template>
