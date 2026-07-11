<script lang="ts">
  import { getAvatarColor } from '$lib/visual/tokens';
  import type { AvatarProps } from './types';

  let {
    name,
    src = null,
    colorKey = '',
    size = 36,
    shape = 'circle',
    background = null,
    online = null,
    showDot = false,
    dnd = false,
    ring = 'var(--paper-deep)',
    class: className = ''
  }: AvatarProps = $props();

  const fontSize = $derived(Math.round(size * 0.39));
  const dotSize = $derived(Math.max(10, Math.round(size * 0.3)));
  const dotColor = $derived(dnd ? 'var(--coral)' : online ? 'var(--green)' : 'var(--warm-faint)');
  const initial = $derived.by(() => {
    const trimmed = name.trim();
    return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
  });
  let imageFailed = $state(false);

  $effect(() => {
    src;
    imageFailed = false;
  });
</script>

<span
  class="ui-avatar {className}"
  class:ui-avatar--squircle={shape === 'squircle'}
  style:width={`${size}px`}
  style:height={`${size}px`}
  style:font-size={`${fontSize}px`}
  style:background={background || getAvatarColor(colorKey).background}
  aria-hidden="true"
>
  {#if src && !imageFailed}
    <img src={src} alt="" onerror={() => (imageFailed = true)} />
  {:else}
    {initial}
  {/if}
  {#if showDot}
    <span
      class="ui-avatar-dot"
      class:ui-avatar-dot--dnd={dnd}
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
    font-family: var(--font-ui);
    font-weight: 800;
    letter-spacing: -0.02em;
  }

  .ui-avatar--squircle {
    border-radius: 31%;
  }

  .ui-avatar > img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: inherit;
  }

  .ui-avatar-dot {
    position: absolute;
    right: -1px;
    bottom: -1px;
    border-radius: 50%;
    border: 2px solid;
  }

  .ui-avatar-dot--dnd::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 20%;
    width: 60%;
    height: 2px;
    border-radius: 2px;
    background: #fff;
    transform: translateY(-50%);
  }
</style>
