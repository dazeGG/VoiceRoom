<script setup lang="ts">
import { t } from '@/shared/i18n';
import { BellOff, ChevronDown } from '@lucide/vue';
import type { RoomRelationship } from '@voice-room/shared/contracts/rooms';
import { computed } from 'vue';
import type { Friend } from '@/api/friends';
import { useNotificationPreferencesStore } from '@/shared/notifications/preferences.store';
import { Avatar, DropdownMenu, Ellipsis } from '@/shared/ui';
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
    relationship?: RoomRelationship | undefined;
    friends?: Friend[] | undefined;
    presentUserIds?: Set<string> | undefined;
    // A prop, not an emit: RoomMenuContent shows the settings item only when someone listens.
    onOpenSettings?: (() => void) | undefined;
    showNotificationControls?: boolean | undefined;
  }>(),
  {
    avatarUrl: null,
    avatarSize: 40,
    triggerClass: '',
    titleClass: '',
    chevronClass: '',
    heading: false,
    headingClass: '',
    placement: 'bottom-start',
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
  <component
    :is="heading ? 'div' : 'span'"
    :class="headingClass"
    :role="heading ? 'heading' : undefined"
    :aria-level="heading ? 1 : undefined"
  >
    <DropdownMenu
      :side="placement.startsWith('top') ? 'top' : 'bottom'"
      :align="placement.endsWith('start') ? 'start' : 'end'"
      :aria-label="t('Меню комнаты')"
    >
      <template #trigger>
        <button :class="['room-menu__trigger', triggerClass]" type="button">
          <Avatar :name="name" :src="avatarUrl" shape="squircle" background="var(--vr-surface-3)" :size="avatarSize" />
          <Ellipsis :text="name" :title="roomId" :class="['room-menu__title', titleClass]" />
          <span
            v-if="roomMuted"
            class="room-menu__notifications-muted"
            role="img"
            :aria-label="t('Уведомления отключены')"
            :title="t('Уведомления отключены')"
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
    </DropdownMenu>
  </component>
</template>
