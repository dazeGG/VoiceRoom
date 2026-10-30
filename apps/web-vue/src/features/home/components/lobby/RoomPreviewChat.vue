<script setup lang="ts">
// The lobby preview renders the same chat the room rail does: the only
// difference is that this viewer has not joined voice, so they post as their
// account instead of through a room peer session.
import type { AuthUser } from '@/api/auth';
import RoomChatPanel from '@/features/room/components/RoomChatPanel.vue';
import { displayNameOf } from '@/shared/utils/display-name';

const props = withDefaults(
  defineProps<{
    roomId: string;
    user: AuthUser;
    /** Scroll the preview chat to this message, e.g. when opened from a mention. */
    aroundMessageId?: string | undefined;
    /** The viewer owns the room and may delete anyone's message. */
    canModerate?: boolean;
    participantCount?: number;
  }>(),
  { aroundMessageId: undefined, canModerate: false, participantCount: 0 }
);

const emit = defineEmits<{ close: []; selectParticipants: []; toast: [message: string] }>();

function resolveDisplayName(): string {
  return displayNameOf(props.user);
}
</script>

<template>
  <RoomChatPanel
    :room-id="roomId"
    :peer-id="`auth-${user.id}`"
    :resolve-display-name="resolveDisplayName"
    root-class="room-preview__chat"
    aria-label="Чат комнаты"
    :around-message-id="aroundMessageId"
    :can-moderate="canModerate"
    :participant-count="participantCount"
    @select-participants="emit('selectParticipants')"
    @collapse="emit('close')"
    @toast="(message: string) => emit('toast', message)"
  />
</template>
