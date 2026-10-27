<script setup lang="ts">
// The one room chat. The in-room rail and the lobby preview differ only in how
// the viewer is identified and in who owns the surrounding panel chrome, so
// both render this component instead of keeping parallel implementations.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { ChatMessage } from '@/api/rooms';
import { useProfileCardUiStore } from '@/entities/profile-card/profile-card-ui.store';
import { useRoomMembershipStore } from '@/entities/room/room-membership.store';
import { useSessionStore } from '@/features/auth/session.store';
import { getDesktopBoundaryPolicy } from '@/platform/desktop-boundary';
import AttachmentDropOverlay from '@/shared/chat/AttachmentDropOverlay.vue';
import { downloadAttachment } from '@/shared/chat/attachment-actions';
import type { AttachmentComposeStore } from '@/shared/chat/attachment-compose';
import { getAttachmentComposeStore } from '@/shared/chat/attachment-compose-stores';
import { AttachmentDrop } from '@/shared/chat/attachment-drop';
import { copyMessageImage, copyMessageText } from '@/shared/chat/use-chat-scroll';
import { DEFAULT_FREQUENT_REACTIONS, loadFrequentReactions } from '@/shared/chat/frequent-reactions';
import { MessageMenuState } from '@/shared/chat/message-menu-state';
import MessageContextMenu from '@/shared/chat/MessageContextMenu.vue';
import OutgoingMessages from '@/shared/chat/OutgoingMessages.vue';
import ReportMessageDialog from '@/shared/chat/ReportMessageDialog.vue';
import { useChatDraft } from '@/shared/chat/use-chat-draft';
import { applyRoomDeleted, applyRoomNotFound, applyRoomUpdated } from '../client/room/lifecycle';
import { getParticipantById } from '../client/room/participants';
import { state as roomState } from '../client/core/room-runtime.store';
import { mentionProfilePerson, participantProfilePerson, roomMessageProfilePerson } from '../profile-card-adapter';
import { buildChatDays, type ChatGroup } from '../room-chat-view';
import { useRoomSocial } from '../social';
import { useRoomPinsStore } from '../pins.store';
import { useRoomChatSession, type OutgoingRoomMessage } from '../use-room-chat-session';
import PinnedMessagesBar from './PinnedMessagesBar.vue';
import RoomChatComposer from './RoomChatComposer.vue';
import RoomChatMessageGroup from './RoomChatMessageGroup.vue';
import RoomPanelHeader from './RoomPanelHeader.vue';

const props = withDefaults(
  defineProps<{
    roomId: string;
    peerId?: string;
    sessionToken?: string;
    resolveDisplayName: () => string;
    rootClass?: string;
    ariaLabel?: string;
    hidden?: boolean;
    activeTab?: 'chat' | 'participants';
    visible?: boolean;
    unread?: number;
    participantCount?: number;
    chatTabId?: string | undefined;
    participantsTabId?: string | undefined;
    chatPanelId?: string | undefined;
    participantsPanelId?: string | undefined;
    /** Given, a right click on an author opens the host's participant menu; without it nothing does. */
    onAuthorContextMenu?: ((peerId: string, event: MouseEvent) => void) | undefined;
    /** The room owner may delete anyone's message, not only their own. */
    canModerate?: boolean;
    /**
     * Open the history around this message and scroll to it. Passed explicitly
     * by hosts that route there themselves; the `around` query parameter is
     * still honoured for links that land on the room page directly.
     */
    aroundMessageId?: string | undefined;
  }>(),
  {
    peerId: '',
    sessionToken: '',
    rootClass: 'room-chat-rail',
    ariaLabel: 'Панель комнаты',
    hidden: false,
    activeTab: 'chat',
    visible: true,
    unread: 0,
    participantCount: 0,
    chatTabId: undefined,
    participantsTabId: undefined,
    chatPanelId: undefined,
    participantsPanelId: undefined,
    onAuthorContextMenu: undefined,
    canModerate: false,
    aroundMessageId: undefined
  }
);

const emit = defineEmits<{
  selectChat: [];
  selectParticipants: [];
  collapse: [];
  read: [];
  unreadMessage: [];
  toast: [message: string, options?: { variant?: 'error' }];
}>();

defineSlots<{ participants?(): unknown }>();

const social = useRoomSocial();
const sessionStore = useSessionStore();
const roomPins = useRoomPinsStore();
const membership = useRoomMembershipStore();
const { openProfileCardFor } = useProfileCardUiStore();

const chatVisible = computed(() => props.visible && props.activeTab === 'chat');

function toast(message: string, options?: { variant?: 'error' }): void {
  emit('toast', message, options);
}

const chat = useRoomChatSession({
  roomId: () => props.roomId,
  peerId: () => props.peerId,
  sessionToken: () => props.sessionToken,
  displayName: () => props.resolveDisplayName(),
  visible: () => chatVisible.value,
  aroundMessageId: () => props.aroundMessageId || new URL(window.location.href).searchParams.get('around') || undefined,
  onRead: () => emit('read'),
  onUnreadMessage: () => emit('unreadMessage'),
  toast,
  lifecycle: { updated: applyRoomUpdated, notFound: applyRoomNotFound, deleted: applyRoomDeleted }
});
const { timeline, scroll, reactions, outbox, isOwnMessage, typingLabel } = chat;

// On a phone the panel is the whole screen rather than a rail beside the
// stage, so it closes with a cross instead of collapsing to the right.
const mobile = ref(false);
const media = computed<AttachmentComposeStore | null>(() =>
  props.roomId ? getAttachmentComposeStore('room', props.roomId) : null
);
const quickReactions = ref<string[]>([...DEFAULT_FREQUENT_REACTIONS]);
const draft = useChatDraft({ type: 'room', id: props.roomId });
watch(
  () => sessionStore.user?.id ?? '',
  (userId) => draft.restore(userId),
  { immediate: true }
);

watch(
  () => media.value?.drafts.length ?? 0,
  (count) => scroll.followComposer(count),
  { immediate: true }
);

const attachmentDrop = new AttachmentDrop({
  media: () => media.value,
  onError: (message) => toast(message, { variant: 'error' })
});

const days = computed(() => buildChatDays(timeline.messages, isOwnMessage));

// Starting an edit clears the last send or edit error under the thread.
const menu = new MessageMenuState<ChatMessage>({
  reactions,
  messages: () => timeline.messages,
  onEdit: () => {
    timeline.error = '';
  }
});
onBeforeUnmount(() => menu.dispose());

const composer = ref<{ focus(): void } | null>(null);
watch(composer, (handle) => (menu.composer = handle), { immediate: true });

// The scrolling body and each day section tell the scroll helper when their
// height changes, so a reader at the newest message stays on it.
const bodyElement = ref<HTMLElement | null>(null);
const daySections = ref<HTMLElement[]>([]);
const sectionWatchers = new Map<HTMLElement, () => void>();

watch(
  bodyElement,
  (element, _previous, onCleanup) => {
    if (element) onCleanup(scroll.body(element));
  },
  { flush: 'post' }
);

watch(
  [bodyElement, days],
  () => {
    const present = new Set(bodyElement.value ? daySections.value : []);
    for (const [section, stop] of sectionWatchers) {
      if (present.has(section)) continue;
      stop();
      sectionWatchers.delete(section);
    }
    for (const section of present) {
      if (!sectionWatchers.has(section)) sectionWatchers.set(section, scroll.keepsNewestInView(section));
    }
  },
  { flush: 'post', immediate: true }
);

onBeforeUnmount(() => {
  for (const stop of sectionWatchers.values()) stop();
  sectionWatchers.clear();
});

// Showing the chat marks it read and parks the view on the newest message. It
// waits for the body element: parking scrolls that element.
watch(
  [chatVisible, () => props.roomId, bodyElement],
  ([isVisible, roomId, body], _previous, onCleanup) => {
    if (!isVisible || !roomId || !body) return;
    onCleanup(chat.show());
  },
  { immediate: true, flush: 'post' }
);

let stopChat = (): void => {};

onMounted(() => {
  mobile.value = !getDesktopBoundaryPolicy().desktopAllowed;
  stopChat = chat.start();

  const userId = sessionStore.user?.id;
  if (props.roomId && userId) {
    void loadFrequentReactions('chat', userId).then((emoji) => {
      if (emoji.length > 0) quickReactions.value = emoji;
    });
  }
});

onBeforeUnmount(() => stopChat());

// Left click on another author (avatar or name) shows their profile card.
// Realtime participant data enriches it when available; message identity is
// the stable fallback after that person has left the room.
// Own rows open your own card; the host renders it in self mode, without
// friend actions.
const canOpenProfile = (group: ChatGroup): boolean => !group.self || Boolean(sessionStore.user?.id);

function openUserProfile(group: ChatGroup, event: MouseEvent): void {
  if (!canOpenProfile(group)) return;
  const participant = getParticipantById(group.peerId);
  event.preventDefault();
  event.stopPropagation();
  const anchor = event.currentTarget;
  const person = participant
    ? participantProfilePerson(social, participant)
    : roomMessageProfilePerson(social, group.messages[0]);
  queueMicrotask(() => openProfileCardFor(person, anchor));
}

// A mention opens the same card the author's avatar opens, so "who is this"
// has one answer everywhere in the message.
function openMentionProfile(userId: string, label: string, event: MouseEvent): void {
  if (!userId) return;
  event.preventDefault();
  event.stopPropagation();
  const anchor = event.currentTarget;
  const person = mentionProfilePerson(social, userId, label, membership.getRoomMembership(props.roomId).members, [
    ...roomState.peers.values()
  ]);
  queueMicrotask(() => openProfileCardFor(person, anchor));
}

function openUserMenu(group: ChatGroup, event: MouseEvent): void {
  if (group.self || !props.onAuthorContextMenu) return;
  event.preventDefault();
  event.stopPropagation();
  props.onAuthorContextMenu(group.peerId, event);
}

// The context menu acts on the message it was opened on.
const menuMessage = computed(() => menu.opened?.message ?? null);
const menuImage = computed(() => menu.opened?.image ?? null);

function onMenuMessage(action: (message: ChatMessage) => void): () => void {
  return () => {
    const message = menuMessage.value;
    if (message) action(message);
  };
}

function onMenuImage(action: (image: NonNullable<typeof menuImage.value>) => void): (() => void) | undefined {
  if (!menuImage.value) return undefined;
  return () => {
    const image = menuImage.value;
    if (image) action(image);
  };
}

const canReport = computed(() =>
  Boolean(sessionStore.user?.id && menuMessage.value && !isOwnMessage(menuMessage.value))
);
</script>

<template>
  <aside
    class="room-chat-panel"
    :class="rootClass"
    :aria-label="ariaLabel"
    :hidden="hidden"
    @dragenter="attachmentDrop.enter"
    @dragover="attachmentDrop.over"
    @dragleave="attachmentDrop.leave"
    @drop="attachmentDrop.drop"
  >
    <AttachmentDropOverlay v-if="chatVisible && attachmentDrop.active" />
    <RoomPanelHeader
      :active-tab="activeTab"
      :unread="unread"
      :participant-count="participantCount"
      :mobile="mobile"
      :chat-tab-id="chatTabId"
      :participants-tab-id="participantsTabId"
      :chat-panel-id="chatPanelId"
      :participants-panel-id="participantsPanelId"
      @select-chat="emit('selectChat')"
      @select-participants="emit('selectParticipants')"
      @collapse="emit('collapse')"
    />

    <template v-if="activeTab === 'chat'">
      <PinnedMessagesBar
        :can-unpin="Boolean(sessionStore.user?.id)"
        @jump="chat.jumpTo"
        @unpin="(messageId: string) => void chat.togglePinned(messageId)"
      />
      <div
        :id="chatPanelId"
        ref="bodyElement"
        class="room-chat-panel__body"
        role="tabpanel"
        :aria-labelledby="chatTabId"
        @scroll="scroll.onScroll(chat.loadOlder)"
      >
        <p v-if="timeline.loading" class="room-chat-panel__note">Загружаем сообщения…</p>
        <template v-else-if="days.length">
          <button
            v-if="timeline.paged && (timeline.loadingOlder || timeline.hasMoreBefore)"
            class="room-chat-panel__note"
            type="button"
            :disabled="timeline.loadingOlder"
            @click="chat.loadOlder(scroll.element)"
          >
            {{ timeline.loadingOlder ? 'Загружаем…' : 'Показать предыдущие' }}
          </button>
          <section
            v-for="day in days"
            :key="day.key"
            ref="daySections"
            class="room-chat-panel__day"
            :aria-label="day.label"
          >
            <div class="room-chat-panel__day-divider" role="separator" :aria-label="day.label">
              <span class="room-chat-panel__day-label">{{ day.label }}</span>
            </div>
            <RoomChatMessageGroup
              v-for="group in day.groups"
              :key="group.key"
              :group="group"
              :can-open-profile="canOpenProfile(group)"
              :menu="menu"
              :reactions="reactions"
              :on-save-edit="(messageId: string, text: string) => chat.saveEdit(messageId, text)"
              :on-mention="openMentionProfile"
              @open-profile="(event: MouseEvent) => openUserProfile(group, event)"
              @author-menu="(event: MouseEvent) => openUserMenu(group, event)"
              @jump="chat.jumpTo"
              @copy="(message: ChatMessage) => void copyMessageText(message.text, toast)"
            />
          </section>
        </template>
        <p v-else-if="!outbox.items.length" class="room-chat-panel__note">Пока пусто. Напишите первое сообщение.</p>
        <OutgoingMessages
          :items="outbox.items"
          :text-of="(outgoing: OutgoingRoomMessage) => outgoing.text"
          :attachments-of="(outgoing: OutgoingRoomMessage) => outgoing.attachmentIds?.length ?? 0"
          @retry="(localId: string) => outbox.retry(localId)"
          @discard="(localId: string) => outbox.discard(localId)"
        />
      </div>

      <p v-if="timeline.error" class="room-chat-panel__error">{{ timeline.error }}</p>

      <RoomChatComposer
        ref="composer"
        v-model:reply-target="menu.replyTarget"
        :room-id="roomId"
        :draft="draft"
        :media="media"
        :typing-label="typingLabel"
        :on-edit-last="() => menu.editLast(chat.lastOwnMessage())"
        @send="(message: OutgoingRoomMessage) => chat.send(message)"
        @jump="chat.jumpTo"
        @toast="toast"
      />
    </template>
    <div
      v-else-if="$slots.participants"
      :id="participantsPanelId"
      class="room-chat-panel__members"
      role="tabpanel"
      :aria-labelledby="participantsTabId"
    >
      <slot name="participants" />
    </div>
  </aside>

  <MessageContextMenu
    v-if="menu.opened"
    open
    :x="menu.opened.x"
    :y="menu.opened.y"
    :quick-reactions="quickReactions"
    :active-reactions="menu.activeReactions"
    :can-react="Boolean(sessionStore.user?.id)"
    :can-pin="Boolean(sessionStore.user?.id)"
    :pinned="roomPins.isMessagePinned(menu.opened.message.id)"
    :can-edit="isOwnMessage(menu.opened.message)"
    :can-delete="isOwnMessage(menu.opened.message) || canModerate"
    :on-copy-image="onMenuImage((image) => void copyMessageImage(image, toast))"
    :on-download-image="onMenuImage((image) => downloadAttachment(image))"
    :on-react="(emoji: string) => onMenuMessage((message) => void reactions.toggle(message.id, emoji))()"
    :on-open-reaction-picker="() => onMenuMessage((message) => scroll.openReactionPicker(message.id))()"
    :on-reply="onMenuMessage((message) => menu.replyTo(message))"
    :on-copy="onMenuMessage((message) => void copyMessageText(message.text, toast))"
    :on-toggle-pin="onMenuMessage((message) => void chat.togglePinned(message.id))"
    :on-edit="onMenuMessage((message) => menu.edit(message.id))"
    :on-delete="onMenuMessage((message) => void chat.deleteMessage(message.id))"
    :on-report="canReport ? onMenuMessage((message) => menu.report(message.id)) : undefined"
    @close="menu.close()"
  />

  <ReportMessageDialog
    v-if="menu.reportedId && roomId"
    :target="{ kind: 'room_message', roomId, messageId: menu.reportedId }"
    @close="menu.closeReport()"
    @reported="(message: string) => toast(message)"
  />
</template>
