<script setup lang="ts">
// Binds the presentational ProfileCard to the account's social graph and the
// shared open/close store. The lobby mounts it, inside the context that
// provides that graph; without one every person is a stranger.
import { computed, ref } from 'vue';
import { useProfileCardUiStore } from '@/entities/profile-card/profile-card-ui.store';
import { useSessionStore } from '@/features/auth/session.store';
import { useRoomSocial } from '@/features/room/social';
import { ProfileCard, type ProfileCardRelationship } from '@/shared/components/profile-card';
import { ContextMenu } from '@/shared/ui';

const emit = defineEmits<{ toast: [message: string] }>();

const social = useRoomSocial();
const session = useSessionStore();
const cardUi = useProfileCardUiStore();
const { profileCardUi } = cardUi;

const busy = ref(false);

const person = computed(() => profileCardUi.person);
const relationship = computed<ProfileCardRelationship>(() => {
  const current = person.value;
  if (current?.userId && current.userId === session.user?.id) return 'self';
  return current?.userId ? social.relationship(current.userId) : 'unavailable';
});
const friendsSince = computed(() => {
  const userId = person.value?.userId;
  return userId ? (social.friends().find((entry) => entry.user.id === userId)?.friendsSince ?? null) : null;
});

// Every action closes the card first: the result shows up in the list or the
// DM view behind it, and leaving a stale card open would contradict it.
async function run(action: () => Promise<void>, failure: string): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  cardUi.closeProfileCard(false);
  try {
    await action();
  } catch (error) {
    emit('toast', error instanceof Error && error.message ? error.message : failure);
  } finally {
    busy.value = false;
  }
}

function message(): void {
  const userId = person.value?.userId;
  if (!userId) return;
  void run(async () => {
    social.showFriends();
    await social.openDm(userId);
  }, 'Не удалось открыть личные сообщения');
}

function addFriend(): void {
  const userId = person.value?.userId;
  if (!userId) return;
  void run(async () => {
    const result = await social.addFriend(userId);
    emit('toast', result.status === 'accepted' ? 'Теперь вы друзья' : 'Заявка в друзья отправлена');
  }, 'Не удалось отправить заявку в друзья');
}

function acceptRequest(): void {
  const userId = person.value?.userId;
  if (!userId) return;
  void run(async () => {
    await social.acceptRequest(userId);
    emit('toast', 'Заявка принята');
  }, 'Не удалось принять заявку');
}

function dropFriend(): void {
  const userId = person.value?.userId;
  if (!userId) return;
  const name = person.value?.name ?? 'Пользователь';
  void run(async () => {
    await social.removeFriend(userId);
    emit('toast', `${name} удалён из друзей`);
  }, 'Не удалось удалить друга');
}
</script>

<template>
  <ContextMenu
    v-if="person"
    :open="profileCardUi.open"
    :x="profileCardUi.x"
    :y="profileCardUi.y"
    v-bind="{ ariaLabel: `Профиль ${person.name}` }"
    :restore-focus="profileCardUi.restoreFocus"
    role="dialog"
    :padded="false"
    @close="cardUi.closeProfileCard(false)"
  >
    <ProfileCard
      :person="person"
      :relationship="relationship"
      :friends-since="friendsSince"
      :busy="busy"
      :on-message="message"
      :on-add-friend="addFriend"
      :on-accept-request="acceptRequest"
      :on-remove-friend="dropFriend"
    />
  </ContextMenu>
</template>
