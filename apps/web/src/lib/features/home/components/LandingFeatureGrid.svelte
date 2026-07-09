<script lang="ts">
  let { items }: { items: { title: string; desc: string }[] } = $props();
</script>

{#snippet iconFlash()}
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="13 2 3 14 11 14 11 22 21 10 13 10 13 2" /></svg>
{/snippet}
{#snippet iconSave()}
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
{/snippet}
{#snippet iconLink()}
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" /></svg>
{/snippet}
{#snippet iconScreen()}
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
{/snippet}

<div class="landing-features">
  {#each items as item, i}
    {@const icon = [iconFlash, iconSave, iconLink, iconScreen][i] ?? iconFlash}
    <div class="landing-feature">
      <div class="landing-feature-head">
        <span class="landing-feature-icon">{@render icon()}</span>
        <span class="landing-feature-num">{String(i + 1).padStart(2, '0')}</span>
      </div>
      <p class="landing-feature-title">{item.title}</p>
      <p class="landing-feature-desc">{item.desc}</p>
    </div>
  {/each}
</div>
