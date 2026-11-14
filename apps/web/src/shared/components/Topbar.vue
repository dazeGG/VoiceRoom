<script setup lang="ts">
import { t } from '@/shared/i18n';
import { RouterLink } from 'vue-router';
import { APP_HOME } from '@/shared/app-home';
import BetaMark from './BetaMark.vue';
import LanguageControl from '@/shared/i18n/LanguageControl.vue';

withDefaults(defineProps<{ label?: string; reload?: boolean; showLanguage?: boolean }>(), {
  label: '',
  reload: false,
  showLanguage: false
});
</script>

<template>
  <header class="topbar">
    <!-- `reload` is a full page load (the Svelte data-sveltekit-reload); otherwise the router navigates. -->
    <a v-if="reload" class="topbar__brand" :href="APP_HOME" :aria-label="label || t('На главную VoiceRoom')">
      <span class="topbar__brand-mark" aria-hidden="true"></span>
      <span>VoiceRoom</span>
      <BetaMark />
    </a>
    <RouterLink v-else class="topbar__brand" :to="APP_HOME" :aria-label="label || t('На главную VoiceRoom')">
      <span class="topbar__brand-mark" aria-hidden="true"></span>
      <span>VoiceRoom</span>
      <BetaMark />
    </RouterLink>
    <slot />
    <LanguageControl v-if="showLanguage" compact />
  </header>
</template>
