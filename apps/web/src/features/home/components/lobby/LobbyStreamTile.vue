<script setup lang="ts">
import { t } from '@/shared/i18n';
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
    name: props.peer.name?.trim() || t('Гость')
  })
);
</script>

<template>
  <!-- Nothing is watched before joining: the tile only says so, and a click enters
       the room, where the stream can be opened. -->
  <button
    class="stream-tile stream-tile--preview lobby-stream-tile"
    type="button"
    :aria-label="t('Войти и смотреть стрим {p0}', { p0: peer.name })"
    @click="$emit('enter')"
  >
    <span class="stream-tile__preview"
      ><span class="lobby-stream-tile__note">{{ t('Стрим откроется после входа') }}</span></span
    >
    <span class="stream-tile__copy">
      <span class="stream-tile__plate">
        <span
          class="stream-tile__mini-avatar"
          :style="{ '--avatar-bg': avatar.background, '--avatar-fg': avatar.foreground }"
          aria-hidden="true"
          >{{ avatar.initials }}</span
        >{{ t('Стрим') }}
      </span>
    </span>
  </button>
</template>
