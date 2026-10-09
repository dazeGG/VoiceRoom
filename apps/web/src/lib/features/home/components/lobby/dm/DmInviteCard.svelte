<script lang="ts">
  import EmojiText from '$lib/shared/chat/EmojiText.svelte';
  import { DoorOpen } from '@lucide/svelte';
  import type { DirectMessageInvite } from '$lib/api/dm';
  import { iconMd } from '$lib/shared/ui/icons';
  import { inviteAnswerable, inviteTitle } from '../../../model/dm-invite-view';

  let {
    invite,
    fromMe,
    busy,
    onRespond
  }: {
    invite: DirectMessageInvite;
    fromMe: boolean;
    /** An answer to this invitation is on its way. */
    busy: boolean;
    onRespond: (action: 'accept' | 'decline') => void;
  } = $props();
</script>

<article class="lobby-room-invitation" data-status={invite.status}>
  <span class="lobby-room-invitation-icon"><DoorOpen {...iconMd} aria-hidden="true" /></span>
  <div class="lobby-room-invitation-copy">
    <strong>{inviteTitle(invite, fromMe)}</strong>
    <span><EmojiText text={invite.roomName || invite.roomId} /></span>
  </div>
  {#if inviteAnswerable(invite, fromMe)}
    <div class="lobby-room-invitation-actions">
      <button type="button" class="lobby-room-invitation-dismiss" disabled={busy} onclick={() => onRespond('decline')}
        >Не сейчас</button
      >
      <button type="button" class="lobby-room-invitation-join" disabled={busy} onclick={() => onRespond('accept')}
        >Войти</button
      >
    </div>
  {/if}
</article>

<style>
  :global(.lobby-room-invitation) {
    display: grid;
    width: min(390px, 100%);
    grid-template-columns: 38px minmax(0, 1fr);
    gap: 10px 12px;
    border: 1px solid color-mix(in oklch, var(--vr-online), transparent 72%);
    border-radius: 14px;
    padding: 13px;
    background: color-mix(in oklch, var(--vr-bg), var(--vr-online) 5%);
  }
  :global(.lobby-room-invitation-icon) {
    display: grid;
    width: 38px;
    height: 38px;
    place-items: center;
    border-radius: 50%;
    background: color-mix(in oklch, var(--vr-online), transparent 82%);
    color: var(--vr-online);
  }
  :global(.lobby-room-invitation-copy) {
    display: grid;
    align-content: center;
    gap: 2px;
    min-width: 0;
  }
  :where(.lobby-room-invitation-copy) strong {
    color: var(--vr-text);
    font-size: 13.5px;
  }
  :where(.lobby-room-invitation-copy) span {
    overflow: hidden;
    color: var(--vr-text-2);
    font-size: 12.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :global(.lobby-room-invitation-actions) {
    display: flex;
    grid-column: 2;
    justify-content: flex-end;
    gap: 7px;
  }
  :where(.lobby-room-invitation-actions) button {
    min-height: 32px;
    border-radius: 8px;
    padding: 0 11px;
    font: inherit;
    font-size: 12px;
    font-weight: 750;
    cursor: pointer;
  }
  :global(.lobby-room-invitation-dismiss) {
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: transparent;
    color: var(--vr-text-2);
  }
  :global(.lobby-room-invitation-join) {
    border: 0;
    background: var(--vr-online);
    color: oklch(14% 0.02 130);
  }
</style>
