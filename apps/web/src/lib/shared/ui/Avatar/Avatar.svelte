<script lang="ts">
  import { getAvatarColor } from '$lib/visual/tokens';
  import type { AvatarProps } from './types';

  let {
    name,
    colorKey = '',
    size = 36,
    online = null,
    showDot = false,
    ring = 'var(--paper-deep)',
    class: className = ''
  }: AvatarProps = $props();

  const fontSize = $derived(Math.round(size * 0.39));
  const dotSize = $derived(Math.max(10, Math.round(size * 0.3)));
  const dotColor = $derived(online ? 'var(--green)' : 'var(--warm-faint)');
  const initial = $derived.by(() => {
    const trimmed = name.trim();
    return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
  });
</script>

<span
  class="ui-avatar {className}"
  style:width={`${size}px`}
  style:height={`${size}px`}
  style:font-size={`${fontSize}px`}
  style:background={getAvatarColor(colorKey).background}
  aria-hidden="true"
>
  {initial}
  {#if showDot}
    <span
      class="ui-avatar-dot"
      style:width={`${dotSize}px`}
      style:height={`${dotSize}px`}
      style:background={dotColor}
      style:border-color={ring}
    ></span>
  {/if}
</span>

<style>
  .ui-avatar {
    position: relative;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    color: #fff;
    font-family: var(--font-sans);
    font-weight: 800;
    letter-spacing: -0.02em;
  }

  .ui-avatar-dot {
    position: absolute;
    right: -1px;
    bottom: -1px;
    border-radius: 50%;
    border: 2px solid;
  }
</style>
