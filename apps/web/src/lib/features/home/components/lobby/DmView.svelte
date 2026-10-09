<script lang="ts">
  import EmojiText from '$lib/shared/chat/EmojiText.svelte';
  import { User } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import type { AuthUser } from '$lib/api/auth';
  import AttachmentDropOverlay from '$lib/shared/chat/AttachmentDropOverlay.svelte';
  import { getAttachmentComposeStore } from '$lib/shared/chat/attachment-compose.svelte';
  import { AttachmentDrop } from '$lib/shared/chat/attachment-drop.svelte';
  import { DEFAULT_FREQUENT_REACTIONS, loadFrequentReactions } from '$lib/shared/chat/frequent-reactions';
  import { effectivePresenceStatus, presenceStatusLabel } from '$lib/shared/presence';
  import { Avatar } from '$lib/shared/ui';
  import { iconMd } from '$lib/shared/ui/icons';
  import { useLobby } from '$lib/features/home/model/lobby-context';
  import { friendName } from '../../model/lobby-format';
  import { pushToast } from '../../model/toasts.svelte';
  import DmConversation from './dm/DmConversation.svelte';
  import DmProfilePanel from './dm/DmProfilePanel.svelte';

  const lobby = useLobby();

  let { self }: { self: AuthUser } = $props();

  let quickReactions = $state<string[]>([...DEFAULT_FREQUENT_REACTIONS]);
  let sending = $state(false);

  const peerId = $derived(lobby.selectedFriendId ?? '');
  const peer = $derived(lobby.thread.peer);
  const online = $derived(lobby.friends.find((entry) => entry.user.id === peerId)?.online ?? false);
  const presence = $derived(effectivePresenceStatus(online, peer?.presenceStatus, peer?.doNotDisturb));
  // One compose store per conversation, kept across switches so a half-written
  // message's attachments are still there on return.
  const media = $derived(peerId ? getAttachmentComposeStore('dm', peerId) : null);

  onMount(() => {
    void loadFrequentReactions('chat', self.id).then((emoji) => {
      if (emoji.length > 0) quickReactions = emoji;
    });
  });

  const drop = new AttachmentDrop({
    media: () => media,
    busy: () => sending,
    onError: (message) => pushToast(message, { variant: 'error' })
  });
</script>

<div
  class="lobby-dm"
  role="region"
  aria-label="Личные сообщения"
  ondragenter={drop.enter}
  ondragover={drop.over}
  ondragleave={drop.leave}
  ondrop={drop.drop}
>
  {#if drop.active}<AttachmentDropOverlay />{/if}
  <div class="lobby-dm-col">
    {#if peer}
      <button class="lobby-dm-head" type="button" onclick={lobby.toggleProfile}>
        <Avatar
          name={friendName(peer)}
          src={peer.avatarUrl}
          colorKey={peer.avatarColorKey}
          background={peer.avatarAccent || undefined}
          size={38}
          online={presence === 'online'}
          afk={presence === 'away'}
          dnd={presence === 'dnd'}
          showDot
          ring="var(--vr-bg)"
        />
        <div class="lobby-dm-head-text">
          <div class="lobby-dm-head-name"><EmojiText text={friendName(peer)} /></div>
          <div class="lobby-dm-head-status" data-presence={presence}>{presenceStatusLabel(presence).toLowerCase()}</div>
        </div>
        <span class="lobby-dm-head-icon">
          <User {...iconMd} aria-hidden="true" />
        </span>
      </button>
    {/if}

    {#if peerId}
      {#key peerId}
        <DmConversation bind:sending {peerId} {self} {peer} {presence} {media} {quickReactions} />
      {/key}
    {/if}
  </div>

  {#if lobby.thread.profileOpen && peer}
    <DmProfilePanel {peer} {presence} {online} messageCount={lobby.thread.messages.length} />
  {/if}
</div>

<style>
  :global(.lobby-dm) {
    --lobby-dm-head-height: 65px;
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
  }
  :global(.lobby-dm-col) {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  :global(.lobby-dm-head) {
    flex: none;
    min-height: var(--lobby-dm-head-height);
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 13px 24px;
    border: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    cursor: pointer;
    transition: background 0.14s ease;
    background: transparent;
    width: 100%;
    text-align: left;
    color: inherit;
  }
  :where(.lobby-dm-head):hover {
    background: var(--vr-surface-3);
  }
  :global(.lobby-dm-head-text) {
    flex: 1;
    min-width: 0;
  }
  :global(.lobby-dm-head-icon) {
    flex: none;
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--vr-text-3);
  }
  :global(.lobby-dm-head-name) {
    font-size: 15.5px;
    font-weight: 700;
    color: var(--vr-text);
    letter-spacing: -0.01em;
  }
</style>
