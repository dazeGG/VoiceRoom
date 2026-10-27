<script setup lang="ts">
import { BellOff, ChevronDown } from '@lucide/vue';
import type { RoomRelationship } from '@voice-room/shared/contracts/rooms';
import { computed } from 'vue';
import type { Friend } from '@/api/friends';
import { useNotificationPreferencesStore } from '@/shared/notifications/preferences.store';
import { Avatar, Ellipsis, Popover } from '@/shared/ui';
import { iconSm } from '@/shared/ui/icons';
import type { PopoverPlacement } from '@/shared/ui';
import RoomMenuContent from './RoomMenuContent.vue';

const props = withDefaults(
  defineProps<{
    roomId: string;
    name: string;
    avatarUrl?: string | null | undefined;
    avatarSize?: number | undefined;
    triggerClass?: string | undefined;
    titleClass?: string | undefined;
    chevronClass?: string | undefined;
    heading?: boolean | undefined;
    headingClass?: string | undefined;
    placement?: PopoverPlacement | undefined;
    keepContentMounted?: boolean | undefined;
    relationship?: RoomRelationship | undefined;
    friends?: Friend[] | undefined;
    presentUserIds?: Set<string> | undefined;
    // A prop, not an emit: RoomMenuContent shows the settings item only when someone listens.
    onOpenSettings?: (() => void) | undefined;
    showNotificationControls?: boolean | undefined;
  }>(),
  {
    avatarUrl: null,
    avatarSize: 38,
    triggerClass: '',
    titleClass: '',
    chevronClass: '',
    heading: false,
    headingClass: '',
    placement: 'bottom-start',
    keepContentMounted: false,
    relationship: 'owner',
    friends: undefined,
    presentUserIds: () => new Set<string>(),
    onOpenSettings: undefined,
    showNotificationControls: true
  }
);

defineEmits<{ toast: [message: string]; roomsChanged: [] }>();

defineSlots<{ inviteContent?(state: { close: () => void }): unknown }>();

const preferences = useNotificationPreferencesStore();

const roomMuted = computed(() => props.showNotificationControls && preferences.isRoomNotificationsMuted(props.roomId));
</script>

<template>
  <Popover
    :placement="placement"
    role="menu"
    aria-label="Меню комнаты"
    panel-class="room-menu__popover"
    :keep-content-mounted="keepContentMounted"
  >
    <template #trigger="{ open, toggle, panelId }">
      <div v-if="heading" :class="headingClass" role="heading" aria-level="1">
        <button
          :class="['room-menu__trigger', triggerClass]"
          type="button"
          aria-haspopup="menu"
          :aria-expanded="open"
          :aria-controls="panelId"
          @click="toggle"
        >
          <Avatar :name="name" :src="avatarUrl" shape="squircle" background="var(--vr-surface-3)" :size="avatarSize" />
          <Ellipsis :text="name" :title="roomId" :class="['room-menu__title', titleClass]" />
          <span
            v-if="roomMuted"
            class="room-menu__notifications-muted"
            role="img"
            aria-label="Уведомления отключены"
            title="Уведомления отключены"
          >
            <BellOff v-bind="iconSm" aria-hidden="true" />
          </span>
          <span :class="['room-menu__chevron', chevronClass]" aria-hidden="true">
            <ChevronDown v-bind="iconSm" aria-hidden="true" />
          </span>
        </button>
      </div>
      <button
        v-else
        :class="['room-menu__trigger', triggerClass]"
        type="button"
        aria-haspopup="menu"
        :aria-expanded="open"
        :aria-controls="panelId"
        @click="toggle"
      >
        <Avatar :name="name" :src="avatarUrl" shape="squircle" background="var(--vr-surface-3)" :size="avatarSize" />
        <Ellipsis :text="name" :title="roomId" :class="['room-menu__title', titleClass]" />
        <span
          v-if="roomMuted"
          class="room-menu__notifications-muted"
          role="img"
          aria-label="Уведомления отключены"
          title="Уведомления отключены"
        >
          <BellOff v-bind="iconSm" aria-hidden="true" />
        </span>
        <span :class="['room-menu__chevron', chevronClass]" aria-hidden="true">
          <ChevronDown v-bind="iconSm" aria-hidden="true" />
        </span>
      </button>
    </template>

    <template #content="{ close }">
      <RoomMenuContent
        :room-id="roomId"
        :name="name"
        :avatar-url="avatarUrl"
        :relationship="relationship"
        :friends="friends"
        :present-user-ids="presentUserIds"
        :can-close="(targetRoomId: string) => targetRoomId === roomId"
        :on-open-settings="onOpenSettings"
        :show-notification-controls="showNotificationControls"
        @close="close"
        @toast="$emit('toast', $event)"
        @rooms-changed="$emit('roomsChanged')"
      >
        <template v-if="$slots.inviteContent" #inviteContent="slotProps">
          <slot name="inviteContent" v-bind="slotProps" />
        </template>
      </RoomMenuContent>
    </template>
  </Popover>
</template>
