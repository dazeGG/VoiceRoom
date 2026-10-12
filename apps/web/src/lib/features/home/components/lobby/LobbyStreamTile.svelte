<script lang="ts">
  import { getAvatarPresentation } from '$lib/features/room/client/ui/avatar-presentation';
  import type { RoomPeer } from '$lib/api/rooms';

  let { peer, onEnter }: { peer: RoomPeer; onEnter: () => void } = $props();

  const avatar = $derived(
    getAvatarPresentation({
      avatarAccent: peer.avatarAccent || undefined,
      avatarColorKey: peer.avatarColorKey,
      avatarUrl: peer.avatarUrl || undefined,
      isLocal: false,
      name: peer.name?.trim() || 'Гость'
    })
  );
</script>

<!-- Nothing is watched before joining: the tile only says so, and a click enters
     the room, where the stream can be opened. -->
<button
  class="stream-tile lobby-preview-stream"
  type="button"
  data-preview="true"
  data-screen="true"
  onclick={onEnter}
  aria-label={`Войти и смотреть стрим ${peer.name}`}
>
  <span class="stream-tile-preview"><span class="lobby-stream-note">Стрим откроется после входа</span></span>
  <span class="stream-tile-copy">
    <span class="stream-tile-plate">
      <span
        class="stream-tile-mini-avatar"
        style:background={avatar.background}
        style:color={avatar.foreground}
        aria-hidden="true">{avatar.initials}</span
      >Стрим
    </span>
  </span>
</button>

<style>
  .lobby-stream-note {
    color: var(--vr-text-3);
    font-size: 13px;
  }
</style>
