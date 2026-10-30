<script setup lang="ts">
// Links to the public legal pages. Inside a dialog they open in a new tab so
// the half-filled form stays where it was.
import { RouterLink } from 'vue-router';
import { LEGAL_DOCUMENTS } from '@/shared/legal-documents';

withDefaults(defineProps<{ newTab?: boolean; compact?: boolean }>(), { newTab: false, compact: false });
</script>

<template>
  <nav :class="['legal-links', { 'legal-links--compact': compact }]" aria-label="Правовая информация">
    <RouterLink
      v-for="legalDocument in LEGAL_DOCUMENTS"
      :key="legalDocument.id"
      class="legal-links__link"
      :to="legalDocument.href"
      :target="newTab ? '_blank' : undefined"
      :rel="newTab ? 'noopener' : undefined"
      >{{ legalDocument.title }}</RouterLink
    >
  </nav>
</template>
