<script setup lang="ts">
import { IconButton } from '@voiceroom/ui-kit/components';
import { t } from '@/shared/i18n';
import { ChevronLeft } from '@lucide/vue';
import { computed } from 'vue';
import type { OwnedRoom } from '@/api/auth';
import { RoomMenu } from '@/shared/components/room-menu';
import { useLobby } from '../../model/lobby-context';
import { roomDisplayName } from '../../model/rooms';

const lobby = useLobby();

const props = withDefaults(
  defineProps<{
    room: OwnedRoom;
    presentUserIds?: Set<string>;
    // A prop, not an emit: the room menu shows its settings item only when a handler is given.
    onOpenSettings?: (() => void) | undefined;
  }>(),
  { presentUserIds: () => new Set<string>(), onOpenSettings: undefined }
);

defineEmits<{ back: []; roomsChanged: []; toast: [message: string] }>();

const name = computed(() => roomDisplayName(props.room));
</script>

<template>
  <div class="room-view-header">
    <IconButton :label="t('Назад')" :size="40" variant="filled" tooltip-side="bottom" @click="$emit('back')">
      <ChevronLeft aria-hidden="true" />
    </IconButton>

    <RoomMenu
      :room-id="room.roomId"
      :name="name"
      :avatar-url="room.avatarUrl"
      :avatar-size="36"
      trigger-class="room-view-header__trigger"
      title-class="room-view-header__name"
      chevron-class="room-view-header__chevron"
      :relationship="room.relationship"
      :friends="lobby.friends"
      :present-user-ids="presentUserIds"
      :on-open-settings="onOpenSettings"
      @rooms-changed="$emit('roomsChanged')"
      @toast="(message: string) => $emit('toast', message)"
    />
  </div>
</template>
