<script setup lang="ts">
import { Avatar, Badge, IconButton } from '@voiceroom/ui-kit/components';
import { Users } from '@lucide/vue';
import { computed } from 'vue';
import type { AuthUser } from '@/api/auth';
import { useFriendCallStore } from '@/features/friend-call/friend-call.store';
import { formatNumber, t } from '@/shared/i18n';
import { useNotificationPreferencesStore } from '@/shared/notifications/preferences.store';
import { effectivePresenceStatus } from '@/shared/presence';
import { displayNameOf } from '@/shared/utils/display-name';
import type { ActiveVoice } from '../../model/active-voice';
import { useLobby } from '../../model/lobby-context';
import VoiceCallWidget from './VoiceCallWidget.vue';

defineProps<{ user: AuthUser; activeVoice: ActiveVoice | null }>();
const emit = defineEmits<{ openPeople: [] }>();
const lobby = useLobby();
const calls = useFriendCallStore();
const preferences = useNotificationPreferencesStore();
const chats = computed(() =>
  lobby.conversations.map(({ peer, unreadCount, muted, isFriend }) => ({
    peer,
    unreadCount,
    muted: preferences.notificationPreferences.loaded ? preferences.isPeerNotificationsMuted(peer.id) : muted,
    missedCount: calls.missedForPeer(peer.id)?.count ?? 0,
    presence: effectivePresenceStatus(isFriend && lobby.isFriendOnline(peer.id), peer.presenceStatus, peer.doNotDisturb)
  }))
);
</script>

<template>
  <div class="sidebar-rail">
    <div class="sidebar-rail__brand"><span class="sidebar__brand-mark"></span></div>
    <IconButton
      :label="t('Друзья')"
      :aria-description="
        lobby.incomingRequestCount > 0
          ? t('Входящие заявки: {count}', { count: formatNumber(lobby.incomingRequestCount) })
          : undefined
      "
      :size="40"
      :aria-current="lobby.mode === 'friends' && lobby.view === 'people' ? 'page' : undefined"
      @click="emit('openPeople')"
    >
      <Users aria-hidden="true" />
      <Badge v-if="lobby.incomingRequestCount > 0" class="sidebar-rail__badge" variant="dot" ring />
    </IconButton>
    <div class="sidebar-rail__chats">
      <IconButton
        v-for="{ peer, unreadCount, muted, missedCount, presence } in chats"
        :key="peer.id"
        :label="displayNameOf(peer)"
        :size="40"
        :aria-current="
          lobby.mode === 'friends' && lobby.view === 'dm' && lobby.selectedFriendId === peer.id ? 'true' : undefined
        "
        @click="lobby.openDm(peer.id)"
      >
        <Avatar
          :name="displayNameOf(peer)"
          :src="peer.avatarUrl"
          :color-key="peer.avatarColorKey"
          :background="peer.avatarAccent"
          :online="presence === 'online'"
          :afk="presence === 'away'"
          :dnd="presence === 'dnd'"
          :size="32"
          show-dot
          ring="var(--vr-surface)"
        />
        <Badge
          v-if="missedCount > 0 || unreadCount > 0"
          class="sidebar-rail__badge"
          :tone="missedCount > 0 ? 'danger' : muted ? 'muted' : 'accent'"
          :count="missedCount || unreadCount"
          size="sm"
          ring
        />
      </IconButton>
    </div>
    <VoiceCallWidget v-if="activeVoice" :voice="activeVoice" compact />
    <div class="sidebar-rail__account">
      <Avatar
        :name="displayNameOf(user)"
        :src="user.avatarUrl"
        :color-key="user.avatarColorKey"
        :background="user.avatarAccent"
        :size="32"
      />
    </div>
  </div>
</template>
