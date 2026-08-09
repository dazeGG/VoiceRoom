<script lang="ts">
  import { Copy, Ellipsis, Reply } from '@lucide/svelte';
  import { iconSm } from '$lib/shared/ui/icons';
  import ReactionPicker from './ReactionPicker.svelte';
  import type { ReactionStore } from './reaction-store.svelte';

  let {
    reactionStore,
    messageId,
    userId,
    canReply = false,
    onReply,
    onCopy,
    onMore
  } = $props<{
    reactionStore?: ReactionStore;
    messageId: string;
    userId?: string;
    canReply?: boolean;
    onReply?: () => void;
    onCopy: () => void;
    onMore: (event: MouseEvent) => void;
  }>();

  const hasReactions = $derived(Boolean(reactionStore && userId));
</script>

<div class="chat-msg-actions" role="toolbar" aria-label="Действия с сообщением">
  {#if reactionStore && userId}
    <ReactionPicker store={reactionStore} {messageId} {userId} />
  {/if}
  {#if hasReactions}<span class="chat-msg-actions-divider" role="separator" aria-orientation="vertical"></span>{/if}
  {#if canReply}
    <button type="button" aria-label="Ответить" title="Ответить" onclick={onReply}><Reply {...iconSm} aria-hidden="true" /></button>
  {/if}
  <button type="button" aria-label="Копировать текст" title="Копировать текст" onclick={onCopy}><Copy {...iconSm} aria-hidden="true" /></button>
  <button type="button" aria-label="Больше действий" title="Больше действий" onclick={onMore}><Ellipsis {...iconSm} aria-hidden="true" /></button>
</div>
