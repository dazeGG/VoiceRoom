<script lang="ts">
  import { MonitorPlay } from '@lucide/svelte';
  import type { RoomPeer } from '$lib/api/rooms';
  import { iconMd } from '$lib/shared/ui/icons';

  let { peer, onEnter }: { peer: RoomPeer; onEnter: () => void } = $props();
</script>

<button class="stream-tile lobby-preview-stream" type="button" data-preview="true" data-screen="true" onclick={onEnter} aria-label={`Войти и смотреть стрим ${peer.name}`}>
  <span class="stream-tile-preview"><span class="stream-tile-icon"><MonitorPlay {...iconMd} aria-hidden="true" /></span></span>
  <span class="stream-tile-profile-meta">Стрим · {peer.name || 'Гость'}</span>
  <span class="stream-tile-copy"><strong>Войти и смотреть</strong></span>
</button>
