<script lang="ts">
  import { avatarBackground, initial } from '../../model/lobby-format';

  let {
    name,
    colorKey = '',
    size = 36,
    online = null,
    showDot = false,
    ring = '#0a0907'
  } = $props<{
    name: string;
    colorKey?: string;
    size?: number;
    online?: boolean | null;
    showDot?: boolean;
    ring?: string;
  }>();

  const fontSize = $derived(Math.round(size * 0.39));
  const dotSize = $derived(Math.max(10, Math.round(size * 0.3)));
  const dotColor = $derived(online ? '#4fae74' : '#6f6a5c');
</script>

<span
  class="lobby-avatar"
  style={`width:${size}px;height:${size}px;font-size:${fontSize}px;background:${avatarBackground(colorKey)}`}
  aria-hidden="true"
>
  {initial(name)}
  {#if showDot}
    <span
      class="lobby-avatar-dot"
      style={`width:${dotSize}px;height:${dotSize}px;background:${dotColor};border-color:${ring}`}
    ></span>
  {/if}
</span>
