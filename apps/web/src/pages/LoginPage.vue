<script setup lang="ts">
import { t } from '@/shared/i18n';
import HomePage from '@/features/home/HomePage.vue';
import { usePageHead } from './use-page-head';

usePageHead(() => t('Вход · VoiceRoom'));
</script>

<template>
  <HomePage initial-auth-mode="login" />
</template>
