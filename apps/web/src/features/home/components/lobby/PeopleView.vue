<script setup lang="ts">
import { Button, Card, EmptyState, Field, ListItem, SegmentControl, TextField } from '@voiceroom/ui-kit/components';
import { Search } from '@lucide/vue';
import { computed, reactive, ref, shallowRef } from 'vue';
import type { AuthUser } from '@/api/auth';
import type { Friend } from '@/api/friends';
import EmojiText from '@/shared/chat/EmojiText.vue';
import { getLocale, t } from '@/shared/i18n';
import { iconSm } from '@voiceroom/ui-kit/icon-defaults';
import { displayNameOf } from '@/shared/utils/display-name';
import { useLobby } from '../../model/lobby-context';
import type { PeopleTab } from '../../model/lobby.store';
import { friendMenuTarget, type FriendMenuTarget } from '../../model/friend-menu';
import AddFriendDialog from './AddFriendDialog.vue';
import FriendContextMenu from './FriendContextMenu.vue';
import PeopleFriendRow from './PeopleFriendRow.vue';

const lobby = useLobby();
const { user } = defineProps<{ user: AuthUser }>();
const emit = defineEmits<{ toast: [message: string] }>();

const query = ref('');
const adding = ref(false);
const busy = reactive(new Set<string>());
const menu = shallowRef<FriendMenuTarget | null>(null);

const incoming = computed(() => lobby.requests.incoming);
const outgoing = computed(() => lobby.requests.outgoing);
const online = computed(() => lobby.friends.filter((friend) => friend.online));
const tabs = computed<{ value: PeopleTab; label: string; count: number; dot?: boolean }[]>(() => [
  { value: 'online', label: t('В сети'), count: online.value.length },
  { value: 'all', label: t('Все'), count: lobby.friends.length },
  { value: 'requests', label: t('Заявки'), count: lobby.incomingRequestCount, dot: lobby.incomingRequestCount > 0 }
]);
const visibleFriends = computed(() => {
  const term = query.value.trim().replace(/^@/, '').toLocaleLowerCase();
  const list = lobby.peopleTab === 'online' ? online.value : lobby.friends;
  return list.filter(({ user }) =>
    [user.login, user.displayName].some((value) => value.toLocaleLowerCase().includes(term))
  );
});

function openMenu(event: MouseEvent, friend: Friend): void {
  menu.value = friendMenuTarget(event, friend);
}

async function run(id: string, action: () => Promise<void>, ok: string): Promise<void> {
  if (busy.has(id)) return;
  busy.add(id);
  try {
    await action();
    emit('toast', ok);
  } catch (error) {
    emit('toast', error instanceof Error && error.message ? error.message : t('Не удалось выполнить действие'));
  } finally {
    busy.delete(id);
  }
}

function mutualLabel(count: number): string {
  if (count === 0) return t('нет общих друзей');
  const category = new Intl.PluralRules(getLocale()).select(count);
  if (category === 'one') return t('{p0} общий друг', { p0: count });
  if (getLocale() === 'ru' && category === 'few') return t('{p0} общих друга', { p0: count });
  return t('{p0} общих друзей', { p0: count });
}
</script>

<template>
  <section class="people-view" :aria-label="t('Друзья')">
    <header class="people-view__header">
      <h1>{{ t('Друзья') }}</h1>
      <SegmentControl
        kind="tabs"
        size="sm"
        v-bind="{ ariaLabel: t('Списки друзей') }"
        :options="tabs"
        :value="lobby.peopleTab"
        @change="lobby.peopleTab = $event"
      />
      <Button variant="primary" size="sm" class="people-view__add" @click="adding = true">{{
        t('Добавить друга')
      }}</Button>
    </header>

    <div class="people-view__body">
      <Field v-if="lobby.peopleTab !== 'requests'" :label="t('Поиск по друзьям')">
        <TextField v-model="query" type="search" :placeholder="t('Найти среди друзей')" autocomplete="off">
          <template #leading><Search v-bind="iconSm" aria-hidden="true" /></template>
        </TextField>
      </Field>

      <template v-if="lobby.peopleTab === 'requests'">
        <EmptyState v-if="!incoming.length && !outgoing.length" :title="t('Новых заявок нет.')" compact />
        <h2 v-if="incoming.length">{{ t('Входящие') }}</h2>
        <Card v-for="request in incoming" :key="request.id" class="people-view__request">
          <ListItem
            :avatar="{
              name: displayNameOf(request.user),
              src: request.user.avatarUrl,
              colorKey: request.user.avatarColorKey,
              background: request.user.avatarAccent
            }"
            :caption="`${t('Хочет добавить вас в друзья')} · ${mutualLabel(request.mutualFriends)}`"
          >
            <template #title><EmojiText :text="displayNameOf(request.user)" /> @{{ request.user.login }}</template>
          </ListItem>
          <div class="people-view__request-actions">
            <Button
              variant="ghost"
              size="sm"
              :disabled="busy.has(request.id)"
              @click="run(request.id, () => lobby.declineRequest(request.id), t('Заявка отклонена'))"
              >{{ t('Отклонить') }}</Button
            >
            <Button
              variant="primary"
              size="sm"
              :disabled="busy.has(request.id)"
              @click="run(request.id, () => lobby.acceptRequest(request.id), t('Заявка принята'))"
              >{{ t('Принять') }}</Button
            >
          </div>
        </Card>

        <h2 v-if="outgoing.length">{{ t('Исходящие') }}</h2>
        <Card v-for="request in outgoing" :key="request.id" class="people-view__request">
          <ListItem
            :avatar="{
              name: displayNameOf(request.user),
              src: request.user.avatarUrl,
              colorKey: request.user.avatarColorKey,
              background: request.user.avatarAccent
            }"
            :caption="`@${request.user.login} · ${t('заявка отправлена · ждём ответа')}`"
          >
            <template #title><EmojiText :text="displayNameOf(request.user)" /></template>
            <template #actions>
              <Button
                variant="ghost"
                size="sm"
                :disabled="busy.has(request.id)"
                @click="run(request.id, () => lobby.cancelRequest(request.id), t('Заявка отменена'))"
                >{{ t('Отменить') }}</Button
              >
            </template>
          </ListItem>
        </Card>
      </template>
      <template v-else>
        <EmptyState v-if="lobby.loaded && !visibleFriends.length" :title="t('Ничего не найдено')" compact />
        <ul v-if="visibleFriends.length" class="people-view__friends">
          <li v-for="friend in visibleFriends" :key="friend.user.id">
            <PeopleFriendRow
              :friend="friend"
              :menu-open="menu?.friend.user.id === friend.user.id"
              @open="lobby.openDm(friend.user.id)"
              @menu="openMenu($event, friend)"
            />
          </li>
        </ul>
      </template>
    </div>
    <AddFriendDialog v-if="adding" :login="user.login" @close="adding = false" @toast="emit('toast', $event)" />
    <FriendContextMenu v-model="menu" @toast="emit('toast', $event)" />
  </section>
</template>
