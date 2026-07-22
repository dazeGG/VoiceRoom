<script lang="ts">
  import type { RoomMessageContentV1 } from '@voice-room/shared/room-message-content';

  let { content, fallback = '' }: { content?: RoomMessageContentV1 | null; fallback?: string } = $props();
</script>

{#if content?.version === 1 && Array.isArray(content.segments)}
  <span class="structured-message">
    {#each content.segments as segment}
      {#if segment.type === 'text'}{segment.text}{:else if segment.type === 'link'}<a href={segment.href} target="_blank" rel="noopener noreferrer">{segment.label}</a>{:else if segment.type === 'mention'}<span class="structured-message__mention" data-user-id={segment.userId}>{segment.label.startsWith('@') ? segment.label : `@${segment.label}`}</span>{/if}
    {/each}
  </span>
{:else}
  <span>{fallback}</span>
{/if}

<style>
  .structured-message { white-space: pre-wrap; overflow-wrap: anywhere; }
  .structured-message__mention { color: var(--accent); font-weight: 600; }
</style>
