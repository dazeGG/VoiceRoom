<script setup lang="ts">
import { APP_LOCALES, normalizeLocale } from '@voice-room/shared/localization';
import { ChevronDown, Languages } from '@lucide/vue';
import { iconMd, iconSm } from '@/shared/ui/icons';
import { t, useLocaleStore } from './index';

withDefaults(defineProps<{ compact?: boolean }>(), { compact: false });

const locale = useLocaleStore();
const names = { ru: 'Русский', en: 'English', fr: 'Français' };

function select(event: Event): void {
  const selected = event.target instanceof HTMLSelectElement ? normalizeLocale(event.target.value) : null;
  if (selected) void locale.select(selected);
}
</script>

<template>
  <label
    class="language-control"
    :class="{ 'language-control--compact': compact }"
    :title="`${t('Язык')}: ${names[locale.current]}`"
  >
    <span class="language-control__label">
      <Languages class="language-control__icon" v-bind="iconMd" aria-hidden="true" />
      <span class="language-control__caption">{{ t('Язык') }}</span>
    </span>
    <span class="language-control__picker">
      <select
        class="language-control__select select__trigger"
        :value="locale.current"
        :aria-label="t('Язык')"
        @change="select"
      >
        <option v-for="language in APP_LOCALES" :key="language" :value="language">{{ names[language] }}</option>
      </select>
      <ChevronDown class="language-control__chevron" v-bind="iconSm" aria-hidden="true" />
    </span>
    <span v-if="locale.saveFailed" class="language-control__error" role="alert">{{
      t('Не удалось сохранить язык')
    }}</span>
  </label>
</template>
