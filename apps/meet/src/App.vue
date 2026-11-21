<script setup lang="ts">
import { AudioLines } from '@lucide/vue';
import { t } from '@voice-room/ui/i18n';
import { APP_LOCALES, isAppLocale } from '@voice-room/shared/localization';
import { locale, setMeetLocale } from '@/i18n';

const languageNames = { ru: 'Русский', en: 'English', fr: 'Français' };

function changeLanguage(event: Event): void {
  if (event.target instanceof HTMLSelectElement && isAppLocale(event.target.value)) {
    setMeetLocale(event.target.value);
  }
}
</script>

<template>
  <div class="meet-shell">
    <header class="meet-shell__header">
      <RouterLink class="meet-shell__brand" to="/">
        <span class="meet-shell__mark"><AudioLines aria-hidden="true" /></span>
        <span>VoiceRoom <strong>Meet</strong></span>
      </RouterLink>
      <select class="meet-shell__language" :value="locale" :aria-label="t('meet.language')" @change="changeLanguage">
        <option v-for="language in APP_LOCALES" :key="language" :value="language" :lang="language">
          {{ languageNames[language] }}
        </option>
      </select>
    </header>
    <RouterView v-slot="{ Component, route }">
      <component :is="Component" :key="route.path" />
    </RouterView>
  </div>
</template>
