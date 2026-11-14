<script setup lang="ts">
import { APP_LOCALES, normalizeLocale } from '@voice-room/shared/localization';
import { t, useLocaleStore } from './index';

const locale = useLocaleStore();
const names = { ru: 'Русский', en: 'English', fr: 'Français' };

function select(event: Event): void {
  const selected = event.target instanceof HTMLSelectElement ? normalizeLocale(event.target.value) : null;
  if (selected) void locale.select(selected);
}
</script>

<template>
  <label class="language-control">
    <span class="language-control__label">{{ t('Язык') }}</span>
    <select class="language-control__select" :value="locale.current" :aria-label="t('Язык')" @change="select">
      <option v-for="language in APP_LOCALES" :key="language" :value="language">{{ names[language] }}</option>
    </select>
    <span v-if="locale.saveFailed" class="language-control__error" role="alert">{{
      t('Не удалось сохранить язык')
    }}</span>
  </label>
</template>
