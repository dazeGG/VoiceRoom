<script setup lang="ts">
import { computed } from 'vue';
import type { RoomPeer } from '@/api/rooms';
import { getAvatarPresentation } from '@/shared/ui/avatar-presentation';

const props = defineProps<{ peer: RoomPeer }>();

defineEmits<{ enter: [] }>();

const avatar = computed(() =>
  getAvatarPresentation({
    avatarAccent: props.peer.avatarAccent || undefined,
    avatarColorKey: props.peer.avatarColorKey,
    avatarUrl: props.peer.avatarUrl || undefined,
    isLocal: false,
    name: props.peer.name?.trim() || 'Гость'
  })
);
</script>

<template>
  <!-- Nothing is watched before joining: the tile only says so, and a click enters
       the room, where the stream can be opened. -->
  <button
    class="stream-tile stream-tile--preview lobby-stream-tile"
    type="button"
    :aria-label="`Войти и смотреть стрим ${peer.name}`"
    @click="$emit('enter')"
  >
    <span class="stream-tile__preview"><span class="lobby-stream-tile__note">Стрим откроется после входа</span></span>
    <span class="stream-tile__copy">
      <span class="stream-tile__plate">
        <span
          class="stream-tile__mini-avatar"
          :style="{ '--avatar-bg': avatar.background, '--avatar-fg': avatar.foreground }"
          aria-hidden="true"
          >{{ avatar.initials }}</span
        >Стрим
      </span>
    </span>
  </button>
</template>
