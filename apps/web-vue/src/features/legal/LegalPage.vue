<script setup lang="ts">
// The frame of a public legal page: a way back to the app, the document
// title with its effective date, the other documents, and the text.
import { ArrowLeft } from '@lucide/vue';
import { computed, onBeforeUnmount, watchEffect } from 'vue';
import { RouterLink } from 'vue-router';
import { LEGAL, LEGAL_DOCUMENTS, type LegalDocument } from './legal-info';

const props = defineProps<{ current: LegalDocument }>();

const title = computed(() => LEGAL_DOCUMENTS.find((document) => document.id === props.current)?.title ?? '');

// Svelte: <svelte:head>. The page sets the tab title and the browser colour while it is shown.
const previousTitle = document.title;
const themeColor = document.createElement('meta');
themeColor.name = 'theme-color';
themeColor.content = '#131416';
document.head.append(themeColor);

watchEffect(() => {
  document.title = `${title.value} · ${LEGAL.service}`;
});

onBeforeUnmount(() => {
  themeColor.remove();
  document.title = previousTitle;
});
</script>

<template>
  <div class="legal-page">
    <header class="legal-page__header">
      <RouterLink class="legal-page__back" to="/"
        ><ArrowLeft :size="16" aria-hidden="true" />{{ LEGAL.service }}</RouterLink
      >
      <nav class="legal-page__nav" aria-label="Документы">
        <RouterLink
          v-for="document in LEGAL_DOCUMENTS"
          :key="document.id"
          :to="document.href"
          :aria-current="document.id === current ? 'page' : undefined"
          >{{ document.title }}</RouterLink
        >
      </nav>
    </header>

    <main class="legal-page__main">
      <h1 class="legal-page__title">{{ title }}</h1>
      <p class="legal-page__date">
        Редакция от {{ current === 'privacy' ? LEGAL.privacyEffectiveDate : LEGAL.effectiveDate }}
      </p>
      <article class="legal-page__text">
        <slot />
      </article>
    </main>
  </div>
</template>
