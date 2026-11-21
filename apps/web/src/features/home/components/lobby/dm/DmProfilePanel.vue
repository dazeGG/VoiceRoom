<script setup lang="ts">
import { IconButton, Avatar, Button } from '@voice-room/ui/components';
import { t } from '@/shared/i18n';
import { Bell, BellOff, UserMinus, X } from '@lucide/vue';
import { computed, ref } from 'vue';
import type { PublicUser } from '@/api/friends';
import EmojiText from '@/shared/chat/EmojiText.vue';
import { useNotificationPreferencesStore } from '@/shared/notifications/preferences.store';
import type { PresenceStatus } from '@/shared/presence';
import { iconMd } from '@voice-room/ui/icon-defaults';
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
      <IconButton class="dm-profile__close" :label="t('Закрыть')" :size="32" @click="lobby.closeProfile">
        <X aria-hidden="true" />
      </IconButton>
    </div>
    <div class="dm-profile__body">
      <Avatar
        :name="displayNameOf(peer)"
        :src="peer.avatarUrl"
        :color-key="peer.avatarColorKey"
        :background="peer.avatarAccent || undefined"
        :size="80"
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
          <div class="dm-profile__stat-label">{{ t('сообщений') }}</div>
        </div>
        <div class="dm-profile__stat">
          <div class="dm-profile__stat-num">{{ online ? t('в сети') : '—' }}</div>
          <div class="dm-profile__stat-label">{{ t('статус') }}</div>
        </div>
      </div>

      <Button variant="ghost" size="sm" class="dm-profile__action" :disabled="muteSaving" @click="toggleMute">
        <BellOff v-if="muted" v-bind="iconMd" aria-hidden="true" />
        <Bell v-else v-bind="iconMd" aria-hidden="true" />
        <span>{{ muted ? t('Уведомления выключены') : t('Выключить уведомления') }}</span>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        class="dm-profile__action dm-profile__action--danger"
        @click="void lobby.removeFriend(peer.id)"
      >
        <template #icon><UserMinus v-bind="iconMd" aria-hidden="true" /></template>
        <span>{{ t('Удалить из друзей') }}</span>
      </Button>
    </div>
  </div>
</template>
