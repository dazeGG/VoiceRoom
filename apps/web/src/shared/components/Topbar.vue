<script setup lang="ts">
import { RouterLink } from 'vue-router';
import BetaMark from './BetaMark.vue';

withDefaults(defineProps<{ label?: string; reload?: boolean }>(), { label: 'На главную VoiceRoom', reload: false });
</script>

<template>
  <header class="topbar">
    <!-- `reload` is a full page load (the Svelte data-sveltekit-reload); otherwise the router navigates. -->
    <a v-if="reload" class="topbar__brand" href="/" :aria-label="label">
      <span class="topbar__brand-mark" aria-hidden="true"></span>
      <span>VoiceRoom</span>
      <BetaMark />
    </a>
    <RouterLink v-else class="topbar__brand" to="/" :aria-label="label">
      <span class="topbar__brand-mark" aria-hidden="true"></span>
      <span>VoiceRoom</span>
      <BetaMark />
    </RouterLink>
    <slot />
  </header>
</template>
