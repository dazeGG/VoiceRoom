<script setup lang="ts">
import { badgeOf } from '@/shared/badges';
import { t } from '@/shared/i18n';
import { ChevronLeft, User } from '@lucide/vue';
import { computed, onMounted, ref } from 'vue';
import type { AuthUser } from '@/api/auth';
import AttachmentDropOverlay from '@/shared/chat/AttachmentDropOverlay.vue';
import { getAttachmentComposeStore } from '@/shared/chat/attachment-compose-stores';
import { AttachmentDrop } from '@/shared/chat/attachment-drop';
import EmojiText from '@/shared/chat/EmojiText.vue';
import { DEFAULT_FREQUENT_REACTIONS, loadFrequentReactions } from '@/shared/chat/frequent-reactions';
import { effectivePresenceStatus, presenceStatusLabel } from '@/shared/presence';
import { AccountBadge, Avatar, IconButton, Pressable } from '@voiceroom/ui-kit/components';
import { useCallEntry } from '@/features/friend-call/use-call-entry';
import CallEntryIcon from '@/features/friend-call/CallEntryIcon.vue';
import { displayNameOf } from '@/shared/utils/display-name';
import { useLobby } from '../../model/lobby-context';
import { useToastsStore } from '../../model/toasts.store';
import DmConversation from './dm/DmConversation.vue';
import DmProfilePanel from './dm/DmProfilePanel.vue';

const lobby = useLobby();
const { pushToast } = useToastsStore();

const { self, portrait } = defineProps<{ self: AuthUser; portrait?: boolean }>();
const emit = defineEmits<{ back: [] }>();

const quickReactions = ref<string[]>([...DEFAULT_FREQUENT_REACTIONS]);

const peerId = computed(() => lobby.selectedFriendId ?? '');
const peer = computed(() => lobby.thread.peer);
const online = computed(() => lobby.friends.find((entry) => entry.user.id === peerId.value)?.online ?? false);
const call = useCallEntry(
  () => peer.value?.id,
  () => online.value
);
const presence = computed(() =>
  effectivePresenceStatus(online.value, peer.value?.presenceStatus, peer.value?.doNotDisturb)
);
// One compose store per conversation, kept across switches so a half-written
// message's attachments are still there on return.
const media = computed(() => (peerId.value ? getAttachmentComposeStore('dm', peerId.value) : null));

onMounted(() => {
  void loadFrequentReactions('chat', self.id).then((emoji) => {
    if (emoji.length > 0) quickReactions.value = emoji;
  });
});

const drop = new AttachmentDrop({
  media: () => media.value,
  onError: (message) => pushToast(message, { variant: 'error' })
});
</script>

<template>
  <div
    class="dm-view"
    :class="{ 'dm-view--portrait': portrait }"
    role="region"
    :aria-label="t('Личные сообщения')"
    @dragenter="drop.enter"
    @dragover="drop.over"
    @dragleave="drop.leave"
    @drop="drop.drop"
  >
    <AttachmentDropOverlay v-if="drop.active" />
    <div class="dm-view__col">
      <div v-if="peer" class="dm-view__header">
        <IconButton v-if="portrait" :label="t('Назад')" :size="44" @click="emit('back')">
          <ChevronLeft aria-hidden="true" />
        </IconButton>
        <Pressable class="dm-view__head" @click="lobby.toggleProfile">
          <Avatar
            :name="displayNameOf(peer)"
            :src="peer.avatarUrl"
            :color-key="peer.avatarColorKey"
            :background="peer.avatarAccent || undefined"
            :size="40"
            :online="presence === 'online'"
            :afk="presence === 'away'"
            :dnd="presence === 'dnd'"
            show-dot
            ring="var(--vr-bg)"
          />
          <div class="dm-view__head-text">
            <div class="dm-view__head-name">
              <EmojiText :text="displayNameOf(peer)" /><AccountBadge :badge="badgeOf(peer.id)" />
            </div>
            <div
              :class="[
                'dm-view__head-status',
                `dm-view__head-status--${call.visible && call.peerInCall ? 'in-call' : presence}`
              ]"
            >
              {{ call.visible && call.peerInCall ? t('в звонке') : presenceStatusLabel(presence).toLowerCase() }}
            </div>
          </div>
        </Pressable>
        <IconButton
          v-if="call.visible"
          :label="call.label"
          :tooltip-description="call.description"
          :variant="call.accent ? 'soft' : 'default'"
          :size="portrait ? 44 : 40"
          :disabled="call.disabled"
          @click="void call.open()"
        >
          <CallEntryIcon :mode="call.mode" />
        </IconButton>
        <IconButton
          :label="t('Профиль')"
          :aria-pressed="lobby.thread.profileOpen"
          :size="portrait ? 44 : 40"
          @click="lobby.toggleProfile"
        >
          <User aria-hidden="true" />
        </IconButton>
      </div>

      <DmConversation
        v-if="peerId"
        :key="peerId"
        :peer-id="peerId"
        :self="self"
        :peer="peer"
        :presence="presence"
        :media="media"
        :quick-reactions="quickReactions"
      />
    </div>

    <DmProfilePanel
      v-if="lobby.thread.profileOpen && peer"
      :peer="peer"
      :presence="presence"
      :online="online"
      :message-count="lobby.thread.messages.length"
    />
  </div>
</template>
