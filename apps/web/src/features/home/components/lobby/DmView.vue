<script setup lang="ts">
import { User } from '@lucide/vue';
import { computed, onMounted, ref } from 'vue';
import type { AuthUser } from '@/api/auth';
import AttachmentDropOverlay from '@/shared/chat/AttachmentDropOverlay.vue';
import { getAttachmentComposeStore } from '@/shared/chat/attachment-compose-stores';
import { AttachmentDrop } from '@/shared/chat/attachment-drop';
import EmojiText from '@/shared/chat/EmojiText.vue';
import { DEFAULT_FREQUENT_REACTIONS, loadFrequentReactions } from '@/shared/chat/frequent-reactions';
import { effectivePresenceStatus, presenceStatusLabel } from '@/shared/presence';
import { AccountBadge, Avatar } from '@/shared/ui';
import { iconMd } from '@/shared/ui/icons';
import { displayNameOf } from '@/shared/utils/display-name';
import { useLobby } from '../../model/lobby-context';
import { useToastsStore } from '../../model/toasts.store';
import DmConversation from './dm/DmConversation.vue';
import DmProfilePanel from './dm/DmProfilePanel.vue';

const lobby = useLobby();
const { pushToast } = useToastsStore();

const { self } = defineProps<{ self: AuthUser }>();

const quickReactions = ref<string[]>([...DEFAULT_FREQUENT_REACTIONS]);

const peerId = computed(() => lobby.selectedFriendId ?? '');
const peer = computed(() => lobby.thread.peer);
const online = computed(() => lobby.friends.find((entry) => entry.user.id === peerId.value)?.online ?? false);
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
    role="region"
    aria-label="Личные сообщения"
    @dragenter="drop.enter"
    @dragover="drop.over"
    @dragleave="drop.leave"
    @drop="drop.drop"
  >
    <AttachmentDropOverlay v-if="drop.active" />
    <div class="dm-view__col">
      <button v-if="peer" class="dm-view__head" type="button" @click="lobby.toggleProfile">
        <Avatar
          :name="displayNameOf(peer)"
          :src="peer.avatarUrl"
          :color-key="peer.avatarColorKey"
          :background="peer.avatarAccent || undefined"
          :size="38"
          :online="presence === 'online'"
          :afk="presence === 'away'"
          :dnd="presence === 'dnd'"
          show-dot
          ring="var(--vr-bg)"
        />
        <div class="dm-view__head-text">
          <div class="dm-view__head-name">
            <EmojiText :text="displayNameOf(peer)" /><AccountBadge :user-id="peer.id" />
          </div>
          <div :class="['dm-view__head-status', `dm-view__head-status--${presence}`]">
            {{ presenceStatusLabel(presence).toLowerCase() }}
          </div>
        </div>
        <span class="dm-view__head-icon">
          <User v-bind="iconMd" aria-hidden="true" />
        </span>
      </button>

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
