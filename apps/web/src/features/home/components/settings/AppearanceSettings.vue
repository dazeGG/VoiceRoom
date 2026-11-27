<script setup lang="ts">
import { Card, RadioGroup, RadioGroupItem, SettingRow, SettingsGroup, Switch } from '@voiceroom/ui-kit/components';
// The colour theme: a card per theme with a small preview painted in that
// theme's own colours; picking one applies it to the whole app at once.
import { t } from '@/shared/i18n';
import { useAppearanceStore } from '@/shared/appearance/appearance.store';
import { isThemeId, THEMES, useThemeStore } from '@/shared/theme/theme.store';
import LanguageControl from '@/shared/i18n/LanguageControl.vue';

const theme = useThemeStore();
const appearance = useAppearanceStore();
function setTheme(value: string | null): void {
  if (isThemeId(value)) theme.setTheme(value);
}
</script>

<template>
  <div class="settings__appearance">
    <Card><LanguageControl /></Card>
    <SettingsGroup :heading="t('Тема')">
      <RadioGroup
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
          >
            <template #preview>
              <span :class="['settings__theme-preview', `theme--${option.id}`]" aria-hidden="true">
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
    <SettingsGroup :heading="t('Звонок')">
      <SettingRow
        :label="t('Скрывать панель звонка')"
        :description="t('Панель управления появляется, когда вы наводите курсор на звонок')"
      >
        <template #control>
          <Switch
            :model-value="appearance.dockAutoHide"
            v-bind="{ ariaLabel: t('Скрывать панель звонка') }"
            @update:model-value="appearance.setDockAutoHide"
          />
        </template>
      </SettingRow>
    </SettingsGroup>
  </div>
</template>
