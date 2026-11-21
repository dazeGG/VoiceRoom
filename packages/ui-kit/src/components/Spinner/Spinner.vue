<script setup lang="ts">
import { t } from '@voiceroom/ui-kit/i18n';
import type { SpinnerProps } from './types';

withDefaults(defineProps<SpinnerProps>(), { size: 16 });
</script>

<template>
  <span :class="['ui-spinner', `ui-spinner--size-${size}`]" role="status" :aria-label="label ?? t('Загрузка…')"></span>
</template>
