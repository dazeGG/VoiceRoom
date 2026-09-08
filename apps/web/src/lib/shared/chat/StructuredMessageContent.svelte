<script lang="ts">
  // A mention names a person, so it behaves like one: given a handler it is a
  // button that opens that person's card, the same card their avatar or name in
  // the message header opens. Without a handler — a preview, a quoted reply —
  // it stays plain text rather than offering an action that leads nowhere.
  import type { RoomMessageContentV1 } from '@voice-room/shared/room-message-content';

  let {
    content,
    fallback = '',
    onmention
  }: {
    content?: RoomMessageContentV1 | null;
    fallback?: string;
    onmention?: (userId: string, label: string, event: MouseEvent) => void;
  } = $props();

  function mentionLabel(label: string): string {
    return label.startsWith('@') ? label : `@${label}`;
  }
</script>

{#if content?.version === 1 && Array.isArray(content.segments)}
  <span class="structured-message">
    {#each content.segments as segment}{#if segment.type === 'text'}{segment.text}{:else if segment.type === 'link'}<a href={segment.href} target="_blank" rel="noopener noreferrer">{segment.label}</a>{:else if segment.type === 'mention'}{#if onmention && segment.userId}<button class="structured-message__mention" type="button" data-user-id={segment.userId} aria-label={`Открыть профиль ${mentionLabel(segment.label)}`} onclick={(event) => onmention(segment.userId, segment.label, event)}>{mentionLabel(segment.label)}</button>{:else}<span class="structured-message__mention" data-user-id={segment.userId}>{mentionLabel(segment.label)}</span>{/if}{/if}{/each}
  </span>
{:else}
  <span>{fallback}</span>
{/if}

<style>
  .structured-message { white-space: pre-wrap; overflow-wrap: anywhere; }

  .structured-message__mention {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--accent);
    font: inherit;
    font-weight: 600;
  }

  button.structured-message__mention { cursor: pointer; }

  button.structured-message__mention:hover,
  button.structured-message__mention:focus-visible {
    border-radius: 4px;
    background: color-mix(in oklch, var(--accent), transparent 84%);
    outline: none;
  }
</style>
