<script lang="ts">
  // The frame of a public legal page: a way back to the app, the document
  // title with its effective date, the other documents, and the text.
  import type { Snippet } from 'svelte';
  import { ArrowLeft } from '@lucide/svelte';
  import { resolve } from '$app/paths';
  import { LEGAL, LEGAL_DOCUMENTS, type LegalDocument } from './legal-info';
  import '$lib/shared/styles/typography.css';
  import '$lib/shared/styles/app.css';

  let { current, children }: { current: LegalDocument; children: Snippet } = $props();

  const title = $derived(LEGAL_DOCUMENTS.find((document) => document.id === current)?.title ?? '');
</script>

<svelte:head>
  <title>{title} · {LEGAL.service}</title>
  <meta name="theme-color" content="#131416" />
</svelte:head>

<div class="legal-page">
  <header class="legal-header">
    <a class="legal-back" href={resolve('/')}><ArrowLeft size={16} aria-hidden="true" />{LEGAL.service}</a>
    <nav class="legal-nav" aria-label="Документы">
      {#each LEGAL_DOCUMENTS as document (document.id)}
        <a href={resolve(document.href)} aria-current={document.id === current ? 'page' : undefined}>{document.title}</a
        >
      {/each}
    </nav>
  </header>

  <main class="legal-main">
    <h1 class="legal-title">{title}</h1>
    <p class="legal-date">Редакция от {LEGAL.effectiveDate}</p>
    <article class="legal-text">
      {@render children()}
    </article>
  </main>
</div>

<style>
  .legal-page {
    min-height: 100dvh;
    background: var(--vr-bg);
    color: var(--vr-text);
    font-family: var(--font-ui);
  }

  .legal-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px 24px;
    max-width: 860px;
    margin: 0 auto;
    padding: 20px 16px;
  }

  .legal-back {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--vr-text);
    font-weight: 600;
    text-decoration: none;
  }

  .legal-nav {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    font-size: 13px;
  }

  .legal-nav a {
    color: var(--vr-text-3);
    text-decoration: none;
  }

  .legal-nav a:hover,
  .legal-nav a[aria-current='page'] {
    color: var(--vr-text);
  }

  .legal-main {
    max-width: 860px;
    margin: 0 auto;
    padding: 8px 16px 64px;
  }

  .legal-title {
    margin: 0 0 6px;
    font-size: clamp(24px, 5vw, 34px);
    line-height: 1.15;
    letter-spacing: -0.02em;
  }

  .legal-date {
    margin: 0 0 28px;
    color: var(--vr-text-3);
    font-size: 13px;
  }

  .legal-text {
    color: var(--vr-text-2);
    font-size: 15px;
    line-height: 1.6;
  }

  .legal-text :global(h2) {
    margin: 32px 0 10px;
    color: var(--vr-text);
    font-size: 18px;
    line-height: 1.3;
  }

  .legal-text :global(p),
  .legal-text :global(ul),
  .legal-text :global(ol) {
    margin: 0 0 12px;
  }

  .legal-text :global(ul),
  .legal-text :global(ol) {
    padding-left: 22px;
  }

  .legal-text :global(li) {
    margin-bottom: 6px;
  }

  .legal-text :global(a) {
    color: var(--vr-accent);
  }

  .legal-text :global(strong) {
    color: var(--vr-text);
  }
</style>
