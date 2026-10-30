<script setup lang="ts">
import HomePage from '@/features/home/HomePage.vue';
import { usePageHead } from './use-page-head';

usePageHead('Регистрация · VoiceRoom');
</script>

<template>
  <HomePage initial-auth-mode="register" />
</template>
