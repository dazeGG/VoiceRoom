<script setup lang="ts">
// Friend picker behind "Пригласить". Inviting no longer requires being in the
// room, so this works the same from the lobby and from inside the room.
import { computed, ref } from 'vue';
import type { Friend } from '@/api/friends';
import { ringRoomFriend } from '@/api/rooms';
import EmojiText from '@/shared/chat/EmojiText.vue';
import { effectivePresenceStatus } from '@/shared/presence';
import { Avatar } from '@/shared/ui';

const props = withDefaults(
  defineProps<{
    friends: Friend[];
    roomId: string;
    /** Account ids already present in the room; those entries render disabled. */
    presentUserIds?: Set<string>;
  }>(),
  { presentUserIds: () => new Set<string>() }
);

const emit = defineEmits<{ close: []; toast: [message: string] }>();

const ringingUserId = ref('');

// Online first — you are trying to pull someone into a live room, so people
// who can answer right now belong at the top; then alphabetical.
const friends = computed(() =>
  [...props.friends].sort(
    (a, b) =>
      Number(b.online) - Number(a.online) ||
      (a.user.displayName || a.user.login).localeCompare(b.user.displayName || b.user.login, 'ru')
  )
);

function nameOf(friend: Friend): string {
  return friend.user.displayName || friend.user.login;
}

function presenceOf(friend: Friend) {
  return effectivePresenceStatus(friend.online, friend.user.presenceStatus, friend.user.doNotDisturb);
}

async function invite(userId: string, name: string): Promise<void> {
  if (ringingUserId.value) return;
  ringingUserId.value = userId;
  try {
    await ringRoomFriend(props.roomId, userId);
    emit('toast', `${name} приглашён в комнату`);
    emit('close');
  } catch (error) {
    emit('toast', error instanceof Error && error.message ? error.message : 'Не удалось позвать друга');
  } finally {
    ringingUserId.value = '';
  }
}
</script>

<template>
  <div class="room-invite-list">
    <p v-if="friends.length === 0" class="room-invite-list__empty">Добавьте друзей, чтобы позвать их</p>
    <template v-else>
      <button
        v-for="friend in friends"
        :key="friend.user.id"
        class="room-invite-list__friend"
        type="button"
        role="menuitem"
        :disabled="Boolean(ringingUserId) || presentUserIds.has(friend.user.id)"
        :title="presentUserIds.has(friend.user.id) ? 'Уже в комнате' : undefined"
        @click="void invite(friend.user.id, nameOf(friend))"
      >
        <Avatar
          :name="nameOf(friend)"
          :src="friend.user.avatarUrl"
          :background="friend.user.avatarAccent || undefined"
          :color-key="friend.user.avatarColorKey"
          :size="26"
          :online="presenceOf(friend) === 'online'"
          :afk="presenceOf(friend) === 'away'"
          :dnd="presenceOf(friend) === 'dnd'"
          show-dot
        />
        <span class="room-invite-list__friend-name"><EmojiText :text="nameOf(friend)" /></span>
        <small v-if="presentUserIds.has(friend.user.id)" class="room-invite-list__friend-note">В комнате</small>
      </button>
    </template>
  </div>
</template>
