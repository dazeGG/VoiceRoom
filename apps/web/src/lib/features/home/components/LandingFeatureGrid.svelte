<script lang="ts">
  import { Clapperboard, Gamepad2, Link } from '@lucide/svelte';

  let { items }: { items: { title: string; desc: string }[] } = $props();

  const icons = [Clapperboard, Gamepad2, Link];
</script>

<div class="landing-features">
  {#each items as item, i (item.title)}
    {@const Icon = icons[i] ?? Link}
    <div class="landing-feature">
      <span class="landing-feature-title"><Icon size={16} aria-hidden="true" />{item.title}</span>
      <span class="landing-feature-desc">{item.desc}</span>
    </div>
  {/each}
</div>

<style>
  .landing-features {
    align-self: stretch;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 24px;
    margin-top: 40px;
    padding-top: 28px;
    border-top: 1px solid var(--vr-line);
  }
  .landing-feature {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .landing-feature-title {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--vr-text);
    font-size: 14px;
    font-weight: 600;
  }
  .landing-feature-title :global(svg) {
    color: var(--vr-accent);
  }
  .landing-feature-desc {
    color: var(--vr-text-2);
    font-size: 13px;
    line-height: 1.5;
  }
</style>
