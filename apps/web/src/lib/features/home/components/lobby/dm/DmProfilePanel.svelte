<script lang="ts">
  import EmojiText from '$lib/shared/chat/EmojiText.svelte';
  import { Bell, BellOff, UserMinus, X } from '@lucide/svelte';
  import type { PublicUser } from '$lib/api/friends';
  import { useLobby } from '$lib/features/home/model/lobby-context';
  import { isPeerNotificationsMuted, updatePeerNotificationsMuted } from '$lib/shared/notifications/preferences.svelte';
  import type { PresenceStatus } from '$lib/shared/presence';
  import { Avatar } from '$lib/shared/ui';
  import { iconMd, iconSm } from '$lib/shared/ui/icons';
  import { friendName } from '../../../model/lobby-format';

  let {
    peer,
    presence,
    online,
    messageCount
  }: { peer: PublicUser; presence: PresenceStatus; online: boolean; messageCount: number } = $props();

  const lobby = useLobby();
  let muteSaving = $state(false);
  const muted = $derived(isPeerNotificationsMuted(peer.id));

  async function toggleMute(): Promise<void> {
    if (muteSaving) return;
    muteSaving = true;
    try {
      await updatePeerNotificationsMuted(peer.id, !muted);
    } finally {
      muteSaving = false;
    }
  }
</script>

<div class="lobby-profile-panel lobby-scroll">
  <div class="lobby-profile-cover" style:--profile-cover-accent={peer.avatarAccent || undefined}>
    <button class="lobby-profile-close" type="button" aria-label="Закрыть" onclick={lobby.closeProfile}>
      <X {...iconSm} aria-hidden="true" />
    </button>
  </div>
  <div class="lobby-profile-body">
    <Avatar
      name={friendName(peer)}
      src={peer.avatarUrl}
      colorKey={peer.avatarColorKey}
      background={peer.avatarAccent || undefined}
      size={76}
      online={presence === 'online'}
      afk={presence === 'away'}
      dnd={presence === 'dnd'}
      showDot
      ring="var(--paper-deep)"
    />
    <div class="lobby-profile-panel-name"><EmojiText text={friendName(peer)} /></div>
    <div class="lobby-profile-panel-handle">@{peer.login}</div>

    <div class="lobby-profile-stats">
      <div class="lobby-profile-stat">
        <div class="lobby-profile-stat-num">{messageCount}</div>
        <div class="lobby-profile-stat-label">сообщений</div>
      </div>
      <div class="lobby-profile-stat">
        <div class="lobby-profile-stat-num">{online ? 'в сети' : '—'}</div>
        <div class="lobby-profile-stat-label">статус</div>
      </div>
    </div>

    <button
      class="lobby-profile-action"
      class:is-muted={muted}
      type="button"
      onclick={toggleMute}
      disabled={muteSaving}
      data-notification-mute="dm"
    >
      {#if muted}<BellOff {...iconMd} aria-hidden="true" />{:else}<Bell {...iconMd} aria-hidden="true" />{/if}
      <span>{muted ? 'Уведомления выключены' : 'Выключить уведомления'}</span>
    </button>
    <button
      class="lobby-profile-action lobby-profile-action--danger"
      type="button"
      onclick={() => void lobby.removeFriend(peer.id)}
    >
      <UserMinus {...iconMd} aria-hidden="true" />
      <span>Удалить из друзей</span>
    </button>
  </div>
</div>

<style>
  :global(.lobby-profile-cover) {
    position: relative;
    height: var(--lobby-dm-head-height);
    background: var(--profile-cover-accent, var(--panel-strong));
  }
  :global(.lobby-profile-close) {
    position: absolute;
    top: 50%;
    right: 12px;
    width: 34px;
    height: 34px;
    transform: translateY(-50%);
    border-radius: 9px;
    border: none;
    background: color-mix(in oklch, var(--warm-950), transparent 36%);
    color: var(--warm-ink);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition:
      background 0.15s ease,
      color 0.15s ease;
  }
  :where(.lobby-profile-close):hover {
    background: var(--warm-950);
    color: var(--accent);
  }
  :global(.lobby-profile-body) {
    padding: 0 20px 24px;
    margin-top: -24px;
  }
  :global(.lobby-profile-panel-name) {
    font-size: 20px;
    font-weight: 800;
    color: var(--warm-ink);
    letter-spacing: -0.02em;
    margin-top: 12px;
  }
  :global(.lobby-profile-panel-handle) {
    font-family: var(--font-mono);
    font-size: 12.5px;
    color: var(--warm-muted);
    margin-top: 2px;
  }
  :global(.lobby-profile-stats) {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-top: 18px;
  }
  :global(.lobby-profile-stat) {
    background: var(--panel-strong);
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 13px;
    padding: 13px 14px;
  }
  :global(.lobby-profile-stat-num) {
    font-size: 20px;
    font-weight: 800;
    color: var(--warm-ink);
    letter-spacing: -0.02em;
  }
  :global(.lobby-profile-stat-label) {
    font-size: 11px;
    color: var(--warm-muted);
    margin-top: 2px;
  }
  :global(.lobby-profile-action) {
    width: 100%;
    margin-top: 14px;
    min-height: 46px;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 10px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: var(--control);
    color: var(--warm-ink-dim);
    border-radius: 12px;
    padding: 0 14px;
    font-family: var(--font-ui);
    font-size: 13.5px;
    font-weight: 650;
    text-align: left;
    cursor: pointer;
    transition:
      background 0.15s ease,
      border-color 0.15s ease,
      color 0.15s ease;
  }
  :global(.lobby-profile-action svg) {
    flex: none;
    color: var(--accent);
  }
  :where(.lobby-profile-action):hover {
    border-color: rgba(255, 255, 255, 0.16);
    background: var(--control-hover);
    color: var(--warm-ink);
  }
  :global(.lobby-profile-action.is-muted svg) {
    color: var(--warm-muted);
  }
  :where(.lobby-profile-action):disabled {
    cursor: default;
    opacity: 0.55;
  }
  :global(.lobby-profile-action--danger) {
    margin-top: 10px;
    border-color: color-mix(in oklch, var(--coral), transparent 58%);
    background: color-mix(in oklch, var(--coral) 9%, transparent);
    color: var(--coral);
  }
  :global(.lobby-profile-action--danger svg) {
    color: currentColor;
  }
  :where(.lobby-profile-action--danger):hover {
    border-color: color-mix(in oklch, var(--coral), transparent 42%);
    background: color-mix(in oklch, var(--coral) 17%, transparent);
    color: var(--coral);
  }
</style>
