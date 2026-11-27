<script setup lang="ts">
import { badgeOf } from '@/shared/badges';
import { t } from '@/shared/i18n';
import { ChevronLeft, Ellipsis, User } from '@lucide/vue';
import { computed, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue';
import type { AuthUser } from '@/api/auth';
import AttachmentDropOverlay from '@/shared/chat/AttachmentDropOverlay.vue';
import { getAttachmentComposeStore } from '@/shared/chat/attachment-compose-stores';
import { AttachmentDrop } from '@/shared/chat/attachment-drop';
import EmojiText from '@/shared/chat/EmojiText.vue';
import { DEFAULT_FREQUENT_REACTIONS, loadFrequentReactions } from '@/shared/chat/frequent-reactions';
import { effectivePresenceStatus, presenceStatusLabel } from '@/shared/presence';
import { AccountBadge, Avatar, IconButton, Pressable, Splitter } from '@voiceroom/ui-kit/components';
import { useCallEntry } from '@/features/friend-call/use-call-entry';
import CallEntryIcon from '@/features/friend-call/CallEntryIcon.vue';
import FriendCallStage from '@/features/friend-call/FriendCallStage.vue';
import { callPeer, useFriendCallStore } from '@/features/friend-call/friend-call.store';
import { useFriendCallStatus } from '@/features/friend-call/use-friend-call-status';
import { displayNameOf } from '@/shared/utils/display-name';
import { useLobby } from '../../model/lobby-context';
import { useToastsStore } from '../../model/toasts.store';
import { useDmCallHeight } from '../../model/use-dm-call-height';
import { friendMenuTarget, type FriendMenuTarget } from '../../model/friend-menu';
import ChatContextMenu from './ChatContextMenu.vue';
import DmConversation from './dm/DmConversation.vue';
import DmProfilePanel from './dm/DmProfilePanel.vue';

const lobby = useLobby();
const { pushToast } = useToastsStore();

const { self, portrait } = defineProps<{ self: AuthUser; portrait?: boolean }>();
const emit = defineEmits<{ back: [] }>();
const mobileChat = defineModel<boolean>('mobileChat', { default: false });

const quickReactions = ref<string[]>([...DEFAULT_FREQUENT_REACTIONS]);

const peerId = computed(() => lobby.selectedFriendId ?? '');
const calls = useFriendCallStore();
const activeCall = computed(() => {
  if (!calls.enabled || !calls.voice) return undefined;
  const record = calls.record(calls.voice.callId);
  if (record && record.call.phase !== 'closed' && callPeer(record.call, calls.userId).id === peerId.value)
    return record;
  return undefined;
});
const declinedCall = shallowRef<typeof activeCall.value>();
watch(activeCall, (current, previous, onCleanup) => {
  declinedCall.value = undefined;
  if (current || !previous) return;
  const closed = calls.record(previous.call.id);
  if (closed?.call.endReason !== 'declined' || closed.call.endedByUserId === calls.userId) return;
  declinedCall.value = closed;
  const timeout = setTimeout(() => (declinedCall.value = undefined), 800);
  onCleanup(() => clearTimeout(timeout));
});
const stageCall = computed(() => {
  const declined = declinedCall.value;
  if (declined && callPeer(declined.call, calls.userId).id === peerId.value) return declined;
  return activeCall.value;
});
const status = useFriendCallStatus(() => stageCall.value);
const peer = computed(() => {
  const threadPeer = lobby.thread.peer;
  if (threadPeer?.id === peerId.value) return threadPeer;
  return null;
});
const headerPeer = computed(() => peer.value ?? (stageCall.value && callPeer(stageCall.value.call, calls.userId)));
const peerName = computed(() => (peer.value ? displayNameOf(peer.value) : (headerPeer.value?.displayName ?? '')));
const online = computed(() => lobby.friends.find((entry) => entry.user.id === peerId.value)?.online ?? false);
const canCompose = computed(() => lobby.thread.contact?.canMessage !== false && !lobby.thread.historyError);
const canCall = computed(
  () => lobby.thread.contact?.canCall ?? Boolean(lobby.friends.find((entry) => entry.user.id === peerId.value))
);
const stranger = computed(() => lobby.thread.contact?.isFriend === false);
const menu = shallowRef<FriendMenuTarget | null>(null);
const call = useCallEntry(
  () => headerPeer.value?.id,
  () => online.value
);
const presence = computed(() =>
  effectivePresenceStatus(online.value, peer.value?.presenceStatus, peer.value?.doNotDisturb)
);
const expandedCallId = ref('');
const expanded = computed(() => expandedCallId.value === stageCall.value?.call.id);
const mobileStage = computed(() => Boolean(portrait && stageCall.value && !mobileChat.value));
const chatVisible = computed(() => !mobileStage.value && (portrait || !expanded.value));
const singlePane = computed(() => {
  if (!chatVisible.value) return 'side';
  if (portrait || !stageCall.value) return 'main';
  return undefined;
});
const { min, max, size, commit } = useDmCallHeight(useTemplateRef<HTMLElement>('panes'));

function back(): void {
  if (activeCall.value && mobileChat.value) {
    mobileChat.value = false;
  } else {
    emit('back');
  }
}

function openCall(): void {
  if (portrait && activeCall.value) mobileChat.value = false;
  else void call.value.open();
}

function openMenu(event: MouseEvent): void {
  if (!peer.value) return;
  const muted = lobby.conversations.find((entry) => entry.peer.id === peerId.value)?.muted ?? false;
  menu.value = friendMenuTarget(
    event,
    { user: peer.value, online: online.value },
    { muted, isFriend: !stranger.value, canCall: canCall.value }
  );
}
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
    @dragenter="chatVisible && canCompose && drop.enter($event)"
    @dragover="chatVisible && canCompose && drop.over($event)"
    @dragleave="drop.leave"
    @drop="chatVisible && canCompose && drop.drop($event)"
  >
    <AttachmentDropOverlay v-if="chatVisible && canCompose && drop.active" />
    <div class="dm-view__col">
      <div v-if="headerPeer" v-show="!mobileStage" class="dm-view__header">
        <IconButton v-if="portrait" :label="t('Назад')" :size="44" @click="back">
          <ChevronLeft aria-hidden="true" />
        </IconButton>
        <Pressable class="dm-view__head" :disabled="!peer" @click="lobby.toggleProfile">
          <Avatar
            :name="peerName"
            :src="headerPeer.avatarUrl"
            :color-key="headerPeer.avatarColorKey"
            :background="headerPeer.avatarAccent || undefined"
            :size="40"
            :online="presence === 'online'"
            :afk="presence === 'away'"
            :dnd="presence === 'dnd'"
            show-dot
            ring="var(--vr-bg)"
          />
          <div class="dm-view__head-text">
            <div class="dm-view__head-name">
              <EmojiText :text="peerName" /><AccountBadge :badge="badgeOf(headerPeer.id)" />
            </div>
            <div
              :class="[
                'dm-view__head-status',
                `dm-view__head-status--${status || (call.visible && call.peerInCall) ? 'in-call' : presence}`
              ]"
              :role="status?.timed ? 'timer' : undefined"
            >
              {{
                status?.subtitle ??
                (call.visible && call.peerInCall
                  ? t('в звонке')
                  : stranger && peer
                    ? t('@{login} · не в друзьях', { login: peer.login })
                    : presenceStatusLabel(presence).toLowerCase())
              }}
            </div>
          </div>
        </Pressable>
        <IconButton
          v-if="call.visible && (canCall || call.mode !== 'start')"
          :label="call.label"
          :tooltip-description="call.description"
          :variant="call.accent ? 'soft' : 'default'"
          :size="portrait ? 44 : 40"
          :disabled="call.disabled"
          @click="openCall"
        >
          <CallEntryIcon :mode="call.mode" />
        </IconButton>
        <IconButton
          :label="t('Профиль')"
          :aria-pressed="lobby.thread.profileOpen"
          :size="portrait ? 44 : 40"
          :disabled="!peer"
          @click="lobby.toggleProfile"
        >
          <User aria-hidden="true" />
        </IconButton>
        <IconButton
          v-if="stranger && peer"
          :label="t('Ещё')"
          aria-haspopup="menu"
          :aria-expanded="Boolean(menu)"
          :size="portrait ? 44 : 40"
          @click="openMenu"
        >
          <Ellipsis aria-hidden="true" />
        </IconButton>
      </div>

      <div ref="panes" class="dm-view__panes">
        <Splitter
          direction="vertical"
          :single-pane="singlePane"
          :label="t('Высота звонка')"
          :size="size"
          :min-size="min"
          :max-size="max"
          @commit="commit($event.size)"
        >
          <template #side>
            <FriendCallStage
              v-if="stageCall && status"
              :key="stageCall.call.id"
              :call="stageCall.call"
              :status="status"
              :portrait="portrait"
              :expanded="expanded"
              @back="emit('back')"
              @messages="mobileChat = true"
              @toggle-expanded="expandedCallId = expanded ? '' : stageCall.call.id"
            />
          </template>
          <DmConversation
            v-if="peerId"
            :key="peerId"
            :peer-id="peerId"
            :self="self"
            :peer="peer"
            :presence="presence"
            :media="media"
            :quick-reactions="quickReactions"
            :visible="chatVisible"
          />
        </Splitter>
      </div>
    </div>

    <DmProfilePanel
      v-if="chatVisible && lobby.thread.profileOpen && peer"
      :peer="peer"
      :presence="presence"
      :online="online"
      :message-count="lobby.thread.messages.length"
    />
    <ChatContextMenu v-model="menu" @toast="pushToast($event)" />
  </div>
</template>
