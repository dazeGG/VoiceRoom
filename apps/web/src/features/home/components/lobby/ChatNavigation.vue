<script setup lang="ts">
import { Badge, Button, Callout, EmptyState, IconButton, NavList, NavListItem } from '@voiceroom/ui-kit/components';
import { MessageSquare, SquarePen, Users } from '@lucide/vue';
import { computed } from 'vue';
import type { ConversationSummary } from '@voiceroom/shared/contracts/messages';
import { formatNumber, t } from '@/shared/i18n';
import { useNotificationPreferencesStore } from '@/shared/notifications/preferences.store';
import { effectivePresenceStatus } from '@/shared/presence';
import { friendMenuTarget, type FriendMenuTarget } from '../../model/friend-menu';
import { useLobby } from '../../model/lobby-context';
import type { ActiveVoice } from '../../model/active-voice';
import ChatRow from './ChatRow.vue';

const { activeVoice = null } = defineProps<{ activeVoice?: ActiveVoice | null }>();
const emit = defineEmits<{ openPeople: []; newChat: [] }>();
const menu = defineModel<FriendMenuTarget | null>({ required: true });
const lobby = useLobby();
const preferences = useNotificationPreferencesStore();
const onlineCount = computed(() => lobby.friends.filter((friend) => friend.online).length);

function muted(chat: ConversationSummary): boolean {
  return preferences.notificationPreferences.loaded ? preferences.isPeerNotificationsMuted(chat.peer.id) : chat.muted;
}

function openMenu(event: MouseEvent | KeyboardEvent, chat: ConversationSummary): void {
  const entry = friendMenuTarget(
    event,
    { user: chat.peer, online: chat.isFriend && lobby.isFriendOnline(chat.peer.id) },
    {
      muted: muted(chat),
      isFriend: chat.isFriend,
      canCall: chat.canCall ?? chat.isFriend
    }
  );
  if (entry) menu.value = entry;
}
</script>

<template>
  <NavList :label="t('Друзья')">
    <NavListItem
      :label="t('Друзья')"
      :current="lobby.mode === 'friends' && lobby.view === 'people'"
      @click="emit('openPeople')"
    >
      <template #icon><Users /></template>
      <template #trailing>
        <span class="chat-navigation__online">{{ t('{count} в сети', { count: formatNumber(onlineCount) }) }}</span>
        <Badge
          v-if="lobby.incomingRequestCount > 0"
          :count="lobby.incomingRequestCount"
          :label="t('Входящие заявки: {count}', { count: formatNumber(lobby.incomingRequestCount) })"
        />
      </template>
    </NavListItem>
  </NavList>
  <section
    class="chat-navigation"
    :aria-label="t('Чаты')"
    :aria-busy="!lobby.conversationsLoaded && !lobby.conversationsFailed"
  >
    <div class="chat-navigation__heading">
      <h2>{{ t('Чаты') }}</h2>
      <IconButton :label="t('Новый чат')" :size="24" @click="emit('newChat')">
        <SquarePen aria-hidden="true" />
      </IconButton>
    </div>
    <Callout v-if="lobby.conversationsFailed" tone="warning" :text="t('Не удалось загрузить чаты')" />
    <EmptyState
      v-else-if="lobby.conversationsLoaded && !lobby.conversations.length"
      :title="t('Пока нет чатов')"
      :text="t('Напишите другу или найдите человека по логину.')"
    >
      <template #icon><MessageSquare /></template>
      <template #action
        ><Button variant="soft" size="sm" @click="emit('newChat')">{{ t('Новый чат') }}</Button></template
      >
    </EmptyState>
    <ChatRow
      v-for="chat in lobby.conversations"
      :key="chat.peer.id"
      :conversation="chat"
      :presence="
        effectivePresenceStatus(
          chat.isFriend && lobby.isFriendOnline(chat.peer.id),
          chat.peer.presenceStatus,
          chat.peer.doNotDisturb
        )
      "
      :muted="muted(chat)"
      :manual-unread="lobby.manualUnread.includes(chat.peer.id)"
      :selected="lobby.mode === 'friends' && lobby.view === 'dm' && lobby.selectedFriendId === chat.peer.id"
      :in-call="activeVoice?.friendCall?.peerId === chat.peer.id && activeVoice.friendCall.status !== 'waiting'"
      @open="lobby.openDm(chat.peer.id)"
      @menu="openMenu($event, chat)"
    />
  </section>
</template>
