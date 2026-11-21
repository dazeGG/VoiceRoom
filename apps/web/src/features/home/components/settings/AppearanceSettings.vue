<script setup lang="ts">
import { Card, RadioGroup, RadioGroupItem, SettingsGroup } from '@voice-room/ui/components';
// The colour theme: a card per theme with a small preview painted in that
// theme's own colours; picking one applies it to the whole app at once.
import { t } from '@/shared/i18n';
import { isThemeId, THEMES, useThemeStore } from '@/shared/theme/theme.store';
import LanguageControl from '@/shared/i18n/LanguageControl.vue';

const theme = useThemeStore();
function setTheme(value: string | null): void {
  if (isThemeId(value)) theme.setTheme(value);
}
</script>

<template>
  <div class="settings__appearance">
    <Card><LanguageControl /></Card>
    <SettingsGroup :heading="t('Тема')">
      <RadioGroup
        class="settings__themes"
        variant="card"
        :aria-label="t('Цветовая тема')"
        :model-value="theme.themeState.current"
        @update:model-value="setTheme"
      >
        <template #item>
          <RadioGroupItem
            v-for="option in THEMES"
            :key="option.id"
            :option="{ value: option.id, label: option.label }"
            variant="card"
            :class="`theme--${option.id}`"
          >
            <template #preview>
              <span class="settings__theme-preview" aria-hidden="true">
                <span class="settings__theme-side">
                  <span class="settings__theme-mark"></span>
                  <span class="settings__theme-line"></span>
                  <span class="settings__theme-line settings__theme-line--short"></span>
                </span>
                <span class="settings__theme-main">
                  <span class="settings__theme-line settings__theme-line--wide"></span>
                  <span class="settings__theme-button"></span>
                </span>
              </span>
            </template>
          </RadioGroupItem>
        </template>
      </RadioGroup>
    </SettingsGroup>
  </div>
</template>
