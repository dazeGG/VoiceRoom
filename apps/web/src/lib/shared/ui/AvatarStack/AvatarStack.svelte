<script lang="ts">
  import type { AvatarStackProps } from './types';

  let {
    items,
    maxAvatars = 3,
    size = 24,
    ariaLabel = 'Участники',
    class: className = '',
    empty
  }: AvatarStackProps = $props();

  const visibleItems = $derived.by(() => {
    if (!Number.isFinite(Number(maxAvatars)) || maxAvatars == null || maxAvatars <= 0) return items;
    return items.slice(0, Math.max(0, Math.floor(maxAvatars)));
  });
  const rest = $derived(Math.max(0, items.length - visibleItems.length));
  const fontSize = $derived(Math.max(10, Math.round(size * 0.42)));
</script>

{#if items.length > 0}
  <span
    class="avatar-stack {className}"
    style:--avatar-stack-size={`${size}px`}
    style:--avatar-stack-font={`${fontSize}px`}
    aria-label={`${ariaLabel}: ${items.map((item) => item.label).join(', ')}`}
  >
    {#each visibleItems as item (item.id)}
      <span
        class="avatar-stack-item"
        title={item.label}
        role="img"
        aria-label={item.label}
        style:--avatar-bg={item.background}
        style:--avatar-fg={item.foreground || '#fff'}
        style:--avatar-shadow={item.shadow || 'none'}
      >{item.initials}</span>
    {/each}
    {#if rest > 0}
      <span class="avatar-stack-rest" aria-label={`Ещё ${rest}`}>+{rest}</span>
    {/if}
  </span>
{:else if empty}
  {@render empty()}
{/if}

<style>
  .avatar-stack {
    display: inline-flex;
    align-items: center;
    min-width: 0;
    isolation: isolate;
  }

  .avatar-stack-item,
  .avatar-stack-rest {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--avatar-stack-size, 24px);
    height: var(--avatar-stack-size, 24px);
    margin-left: calc(var(--avatar-stack-size, 24px) * -0.28);
    border: 2px solid var(--avatar-stack-ring, #15130f);
    border-radius: 999px;
    font-family: var(--font-sans, sans-serif);
    font-size: var(--avatar-stack-font, 10px);
    font-weight: 900;
    line-height: 1;
    letter-spacing: -0.04em;
  }

  .avatar-stack-item:first-child,
  .avatar-stack-rest:first-child {
    margin-left: 0;
  }

  .avatar-stack-item {
    background: var(--avatar-bg, oklch(54% 0.22 276));
    color: var(--avatar-fg, #fff);
    box-shadow: var(--avatar-shadow, none);
  }

  .avatar-stack-rest {
    background: #27241d;
    color: #e8e1d2;
    box-shadow: 0 8px 18px rgb(0 0 0 / 0.22);
  }
</style>
