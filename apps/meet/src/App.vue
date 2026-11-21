<script setup lang="ts">
import { Select } from '@voiceroom/ui-kit/components';
import { AudioLines } from '@lucide/vue';
import { t } from '@voiceroom/ui-kit/i18n';
import { APP_LOCALES, isAppLocale } from '@voiceroom/shared/localization';
import { locale, setMeetLocale } from '@/i18n';

const languageNames = { ru: 'Русский', en: 'English', fr: 'Français' };

const languages = APP_LOCALES.map((value) => ({ value, label: languageNames[value], lang: value }));

function changeLanguage(value: string): void {
  if (isAppLocale(value)) setMeetLocale(value);
}
</script>

<template>
  <div class="meet-shell">
    <header class="meet-shell__header">
      <RouterLink class="meet-shell__brand" to="/">
        <span class="meet-shell__mark"><AudioLines aria-hidden="true" /></span>
        <span>VoiceRoom <strong>Meet</strong></span>
      </RouterLink>
      <Select
        native
        variant="ghost"
        size="sm"
        class="meet-shell__language"
        :model-value="locale"
        :options="languages"
        :label="t('meet.language')"
        @value-change="changeLanguage"
      />
    </header>
    <RouterView v-slot="{ Component, route }">
      <component :is="Component" :key="route.path" />
    </RouterView>
  </div>
</template>
