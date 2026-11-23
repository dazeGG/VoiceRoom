<script setup lang="ts">
import { Select } from '@voiceroom/ui-kit/components';
import { APP_LOCALES, normalizeLocale } from '@voiceroom/shared/localization';
import { Languages } from '@lucide/vue';
import { iconMd } from '@voiceroom/ui-kit/icon-defaults';
import { t, useLocaleStore } from './index';

withDefaults(defineProps<{ compact?: boolean }>(), { compact: false });

const locale = useLocaleStore();
const names = { ru: 'Русский', en: 'English', fr: 'Français' };

const options = APP_LOCALES.map((value) => ({ value, label: names[value] }));

function select(value: string): void {
  const selected = normalizeLocale(value);
  if (selected) void locale.select(selected);
}
</script>

<template>
  <div
    class="language-control"
    :class="{ 'language-control--compact': compact }"
    :title="`${t('Язык')}: ${names[locale.current]}`"
  >
    <span class="language-control__label">
      <Languages class="language-control__icon" v-bind="iconMd" aria-hidden="true" />
      <span class="language-control__caption">{{ t('Язык') }}</span>
    </span>
    <span class="language-control__picker">
      <Select
        class="language-control__select"
        :native="compact"
        :icon-only="compact"
        :size="compact ? 'md' : 'lg'"
        :model-value="locale.current"
        :options="options"
        :label="t('Язык')"
        @value-change="select"
      />
    </span>
    <span v-if="locale.saveFailed" class="language-control__error" role="alert">{{
      t('Не удалось сохранить язык')
    }}</span>
  </div>
</template>
