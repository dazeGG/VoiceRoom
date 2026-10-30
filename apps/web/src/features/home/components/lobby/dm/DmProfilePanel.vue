<script setup lang="ts">
import { Bell, BellOff, UserMinus, X } from '@lucide/vue';
import { computed, ref } from 'vue';
import type { PublicUser } from '@/api/friends';
import EmojiText from '@/shared/chat/EmojiText.vue';
import { useNotificationPreferencesStore } from '@/shared/notifications/preferences.store';
import type { PresenceStatus } from '@/shared/presence';
import { Avatar } from '@/shared/ui';
import { iconMd, iconSm } from '@/shared/ui/icons';
import { displayNameOf } from '@/shared/utils/display-name';
import { useLobby } from '../../../model/lobby-context';

const { peer } = defineProps<{
  peer: PublicUser;
  presence: PresenceStatus;
  online: boolean;
  messageCount: number;
}>();

const lobby = useLobby();
const preferences = useNotificationPreferencesStore();
const muteSaving = ref(false);
const muted = computed(() => preferences.isPeerNotificationsMuted(peer.id));

async function toggleMute(): Promise<void> {
  if (muteSaving.value) return;
  muteSaving.value = true;
  try {
    await preferences.updatePeerNotificationsMuted(peer.id, !muted.value);
  } finally {
    muteSaving.value = false;
  }
}
</script>

<template>
  <div class="dm-profile">
    <div class="dm-profile__cover" :style="{ '--profile-cover-accent': peer.avatarAccent || undefined }">
      <button class="dm-profile__close" type="button" aria-label="Закрыть" @click="lobby.closeProfile">
        <X v-bind="iconSm" aria-hidden="true" />
      </button>
    </div>
    <div class="dm-profile__body">
      <Avatar
        :name="displayNameOf(peer)"
        :src="peer.avatarUrl"
        :color-key="peer.avatarColorKey"
        :background="peer.avatarAccent || undefined"
        :size="76"
        :online="presence === 'online'"
        :afk="presence === 'away'"
        :dnd="presence === 'dnd'"
        show-dot
        ring="var(--vr-bg)"
      />
      <div class="dm-profile__name"><EmojiText :text="displayNameOf(peer)" /></div>
      <div class="dm-profile__handle">@{{ peer.login }}</div>

      <div class="dm-profile__stats">
        <div class="dm-profile__stat">
          <div class="dm-profile__stat-num">{{ messageCount }}</div>
          <div class="dm-profile__stat-label">сообщений</div>
        </div>
        <div class="dm-profile__stat">
          <div class="dm-profile__stat-num">{{ online ? 'в сети' : '—' }}</div>
          <div class="dm-profile__stat-label">статус</div>
        </div>
      </div>

      <button class="dm-profile__action" type="button" :disabled="muteSaving" @click="toggleMute">
        <BellOff v-if="muted" v-bind="iconMd" aria-hidden="true" />
        <Bell v-else v-bind="iconMd" aria-hidden="true" />
        <span>{{ muted ? 'Уведомления выключены' : 'Выключить уведомления' }}</span>
      </button>
      <button
        class="dm-profile__action dm-profile__action--danger"
        type="button"
        @click="void lobby.removeFriend(peer.id)"
      >
        <UserMinus v-bind="iconMd" aria-hidden="true" />
        <span>Удалить из друзей</span>
      </button>
    </div>
  </div>
</template>
