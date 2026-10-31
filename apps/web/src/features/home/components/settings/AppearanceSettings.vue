<script setup lang="ts">
// The colour theme: a card per theme with a small preview painted in that
// theme's own colours; picking one applies it to the whole app at once.
import { Check } from '@lucide/vue';
import { THEMES, useThemeStore } from '@/shared/theme/theme.store';
import { iconSm } from '@/shared/ui/icons';

const theme = useThemeStore();
</script>

<template>
  <div class="settings__appearance">
    <span class="settings__section-title">Тема</span>
    <div class="settings__themes" role="radiogroup" aria-label="Цветовая тема">
      <!-- The theme class on the card repaints the --vr-* tokens inside it (Svelte: data-theme). -->
      <button
        v-for="option in THEMES"
        :key="option.id"
        class="settings__theme"
        :class="[`theme--${option.id}`, { 'settings__theme--selected': theme.themeState.current === option.id }]"
        type="button"
        role="radio"
        :aria-checked="theme.themeState.current === option.id"
        @click="theme.setTheme(option.id)"
      >
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
        <span class="settings__theme-label">
          {{ option.label }}
          <Check v-if="theme.themeState.current === option.id" v-bind="iconSm" aria-hidden="true" />
        </span>
      </button>
    </div>
  </div>
</template>
