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