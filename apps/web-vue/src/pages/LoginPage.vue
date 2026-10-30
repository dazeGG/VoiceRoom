<script setup lang="ts">
import HomePage from '@/features/home/HomePage.vue';
import { usePageHead } from './use-page-head';

usePageHead('Вход · VoiceRoom');
</script>

<template>
  <HomePage initial-auth-mode="login" />
</template>
