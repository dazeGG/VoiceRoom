<script lang="ts">
  import { Bookmark, Link, Monitor, Zap } from '@lucide/svelte';
  import { iconMd } from '$lib/shared/ui/icons';

  let { items }: { items: { title: string; desc: string }[] } = $props();

  const icons = [Zap, Bookmark, Link, Monitor];
</script>

<div class="landing-features">
  {#each items as item, i}
    {@const Icon = icons[i] ?? Zap}
    <div class="landing-feature">
      <div class="landing-feature-head">
        <span class="landing-feature-icon"><Icon {...iconMd} aria-hidden="true" /></span>
        <span class="landing-feature-num">{String(i + 1).padStart(2, '0')}</span>
      </div>
      <p class="landing-feature-title">{item.title}</p>
      <p class="landing-feature-desc">{item.desc}</p>
    </div>
  {/each}
</div>

<style>
  :global(.landing-feature) {
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 16px;
    padding: 18px 18px 20px;
    background: var(--panel);
    transition:
      background 0.15s ease,
      border-color 0.15s ease;
  }
  :where(.landing-feature):hover {
    background: var(--panel-strong);
    border-color: rgba(255, 255, 255, 0.14);
  }
  :global(.landing-feature-head) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
  }
  :global(.landing-feature-icon) {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    border-radius: 11px;
    background: var(--control);
    border: 1px solid rgba(255, 255, 255, 0.09);
    color: var(--accent);
  }
  :global(.landing-feature-num) {
    font-family: var(--font-ui);
    font-size: 11.5px;
    letter-spacing: 0.1em;
    color: var(--warm-faint, var(--warm-faint));
  }
  :global(.landing-feature-title) {
    margin: 0;
    font-size: 14.5px;
    font-weight: 700;
    letter-spacing: -0.01em;
    line-height: 1.25;
    color: var(--warm-ink, var(--warm-100));
  }
  :global(.landing-feature-desc) {
    margin: 7px 0 0;
    font-size: 13px;
    line-height: 1.5;
    color: var(--warm-muted-dim, var(--warm-muted-dim));
  }
</style>
