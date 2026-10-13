<script lang="ts">
  // Links to the public legal pages. Inside a dialog they open in a new tab so
  // the half-filled form stays where it was.
  import { resolve } from '$app/paths';
  import { LEGAL_DOCUMENTS } from '$lib/shared/legal-documents';

  let { newTab = false, compact = false }: { newTab?: boolean; compact?: boolean } = $props();
</script>

<nav class="legal-links" class:legal-links--compact={compact} aria-label="Правовая информация">
  {#each LEGAL_DOCUMENTS as document (document.id)}
    <a
      class="legal-link"
      href={resolve(document.href)}
      target={newTab ? '_blank' : undefined}
      rel={newTab ? 'noopener' : undefined}>{document.title}</a
    >
  {/each}
</nav>

<style>
  .legal-links {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px 18px;
    font-family: var(--font-ui);
    font-size: 12.5px;
  }

  .legal-links--compact {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    padding: 6px 10px;
    font-size: 12px;
  }

  .legal-link {
    color: var(--vr-text-3);
    text-decoration: none;
  }

  .legal-link:hover,
  .legal-link:focus-visible {
    color: var(--vr-text-2);
    text-decoration: underline;
  }
</style>
