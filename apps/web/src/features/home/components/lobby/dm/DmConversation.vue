<script setup lang="ts">
// One open thread: its messages and its compose field. The DM view mounts it
// per peer, so opening another thread starts from a clean slate — no editing,
// reply or menu carried over, the thread's own draft and reactions loaded.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { AuthUser } from '@/api/auth';
import type { DirectMessage } from '@/api/dm';
import type { PublicUser } from '@/api/friends';
import { getAppRealtime } from '@/api/realtime';
import { useProfileCardUiStore } from '@/entities/profile-card/profile-card-ui.store';
import { downloadAttachment } from '@/shared/chat/attachment-actions';
import type { AttachmentComposeStore } from '@/shared/chat/attachment-compose';
import EmojiText from '@/shared/chat/EmojiText.vue';
import MessageBubble from '@/shared/chat/MessageBubble.vue';
import MessageContextMenu from '@/shared/chat/MessageContextMenu.vue';
import { MessageMenuState } from '@/shared/chat/message-menu-state';
import OutgoingMessages from '@/shared/chat/OutgoingMessages.vue';
import { createReactionStore } from '@/shared/chat/reaction-store';
import ReportMessageDialog from '@/shared/chat/ReportMessageDialog.vue';
import { formatTypingLabel } from '@/shared/chat/typing';
import { copyMessageImage, copyMessageText, useChatScroll } from '@/shared/chat/use-chat-scroll';
import ChatText from '@/shared/components/ChatText.vue';
import type { ProfileCardPerson } from '@/shared/components/profile-card';
import type { PresenceStatus } from '@/shared/presence';
import { AccountBadge, Avatar } from '@/shared/ui';
import { formatChatDayLabel, isSameDay } from '@/shared/utils/chat-date';
import { clockTime } from '@/shared/utils/date-format';
import { displayNameOf } from '@/shared/utils/display-name';
import { useLobby } from '../../../model/lobby-context';
import type { OutgoingDirectMessage } from '../../../model/lobby.store';
import { useToastsStore } from '../../../model/toasts.store';
import DmComposer from './DmComposer.vue';
import DmInviteCard from './DmInviteCard.vue';

const { peerId, self, peer, presence, media, quickReactions } = defineProps<{
  peerId: string;
  self: AuthUser;
  peer: PublicUser | null;
  presence: PresenceStatus;
  media: AttachmentComposeStore | null;
  quickReactions: string[];
}>();

interface Group {
  key: string;
  fromMe: boolean;
  dayLabel: string | null;
  bubbles: [DirectMessage, ...DirectMessage[]];
}

const lobby = useLobby();
const { pushToast } = useToastsStore();
const { openProfileCardFor } = useProfileCardUiStore();
// The view is mounted per peer, like the reaction store below.
const outbox = lobby.outboxFor(peerId);
const selfId = computed(() => self.id);
const selfName = computed(() => displayNameOf(self));
const peerName = computed(() => (peer ? displayNameOf(peer) : ''));

const scroll = useChatScroll();
const inviteResponding = ref('');

const reactions = createReactionStore();
reactions.setConversation({ type: 'dm', id: peerId });

const peerTypingActivity = computed(() => (peer ? lobby.dmTyping.activityOf(peer.id) : null));
const typingLabel = computed(() =>
  peer && peerTypingActivity.value
    ? formatTypingLabel([{ name: peerName.value, activity: peerTypingActivity.value }])
    : ''
);

// Group consecutive messages by sender, inserting a day separator when the
// calendar day changes.
const groups = computed<Group[]>(() => {
  const result: Group[] = [];
  let prev: DirectMessage | null = null;
  for (const message of lobby.thread.messages) {
    const fromMe = message.senderId === selfId.value;
    const newDay = !prev || !isSameDay(prev.createdAt, message.createdAt);
    const lastGroup = result.at(-1);
    if (lastGroup && prev && !newDay && prev.senderId === message.senderId) {
      lastGroup.bubbles.push(message);
    } else {
      result.push({
        key: message.id,
        fromMe,
        dayLabel: newDay ? formatChatDayLabel(message.createdAt) : null,
        bubbles: [message]
      });
    }
    prev = message;
  }
  return result;
});

let stopReactions = (): void => {};
let stopReader = (): void => {};

onMounted(() => {
  stopReactions = getAppRealtime().subscribe((event) => {
    if (event.type !== 'reaction.updated' || event.payload.conversation.type !== 'dm') return;
    if (event.payload.conversation.id !== peerId) return;
    reactions.applyServer(event.payload.messageId, event.payload.summary);
  });
  // Read receipts follow the conversation on screen: unmounting stops them.
  stopReader = lobby.thread.attachReader(peerId);
});

onBeforeUnmount(() => {
  stopReactions();
  stopReader();
});

// Invitations carry no reactions.
const menu = new MessageMenuState<DirectMessage>({
  reactions,
  messages: () => lobby.thread.messages.filter((message) => !message.invite)
});
onBeforeUnmount(() => menu.dispose());

const composer = ref<{ focus(): void } | null>(null);
watch(composer, (handle) => (menu.composer = handle), { immediate: true });

// The scrolling body and the thread tell the scroll helper when their height
// changes, so a reader at the newest message stays on it.
const scrollElement = ref<HTMLElement | null>(null);
const threadElement = ref<HTMLElement | null>(null);

watch(
  scrollElement,
  (element, _previous, onCleanup) => {
    if (element) onCleanup(scroll.body(element));
  },
  { flush: 'post' }
);

watch(
  threadElement,
  (element, _previous, onCleanup) => {
    if (element) onCleanup(scroll.keepsNewestInView(element));
  },
  { flush: 'post' }
);

// A new attachment grows the composer; a reader at the bottom stays there.
watch(
  () => media?.drafts.length ?? 0,
  (count) => scroll.followComposer(count),
  { immediate: true }
);

// Prepending older history keeps the same newest id, so it must not trigger
// this latest-message autoscroll and disturb the preserved anchor.
// A message just sent shows at the foot of the thread: the view goes there.
let outgoingCount = 0;
watch(
  () => outbox.items.length,
  (count) => {
    const grew = count > outgoingCount;
    outgoingCount = count;
    if (!grew) return;
    void scroll.settle();
  },
  { immediate: true }
);

let lastAutoScrolledMessage: string | null = null;
watch(
  () => lobby.thread.messages.at(-1)?.id ?? '',
  (newestId) => {
    if (newestId === lastAutoScrolledMessage) return;
    lastAutoScrolledMessage = newestId;
    void scroll.settle();
  },
  { immediate: true }
);

const loadOlder = (element: HTMLElement): void => void lobby.loadOlderThread(element);

function jumpToMessage(messageId: string): void {
  scroll.jumpTo(messageId, () => pushToast('Сообщение не загружено — прокрутите историю выше'));
}

function openProfile(event: MouseEvent, fromMe: boolean): void {
  const person: ProfileCardPerson | null = fromMe
    ? {
        userId: selfId.value,
        name: selfName.value,
        login: self.login,
        avatarUrl: self.avatarUrl,
        avatarColorKey: self.avatarColorKey,
        avatarAccent: self.avatarAccent,
        presence: 'online'
      }
    : peer && {
        userId: peer.id,
        name: peerName.value,
        login: peer.login,
        avatarUrl: peer.avatarUrl,
        avatarColorKey: peer.avatarColorKey,
        avatarAccent: peer.avatarAccent,
        presence
      };
  if (!person) return;
  event.preventDefault();
  event.stopPropagation();
  const anchor = event.currentTarget;
  queueMicrotask(() => openProfileCardFor(person, anchor));
}

function editLastOwnMessage(): boolean {
  return menu.editLast(
    lobby.thread.messages.findLast((message) => message.senderId === selfId.value && !message.invite)
  );
}

async function deleteMessage(messageId: string): Promise<void> {
  try {
    await lobby.deleteMessage(messageId);
    reactions.markDeleted(messageId);
    pushToast('Сообщение удалено');
  } catch (cause) {
    pushToast(cause instanceof Error && cause.message ? cause.message : 'Не удалось удалить сообщение', {
      variant: 'error'
    });
  }
}

// Invitations are interactive cards with their own buttons; a context menu on
// top of them would offer actions that do not apply.
function openMessageMenu(message: DirectMessage, event: MouseEvent): void {
  if (!message.invite) menu.open(message, event);
}

async function respondToInvite(message: DirectMessage, action: 'accept' | 'decline'): Promise<void> {
  if (inviteResponding.value) return;
  inviteResponding.value = message.id;
  try {
    await lobby.respondRoomInvitation(message, action);
  } catch {
    pushToast('Не удалось ответить на приглашение');
  } finally {
    inviteResponding.value = '';
  }
}

// The context menu acts on the message it was opened on.
const menuMessage = computed(() => menu.opened?.message ?? null);
const menuImage = computed(() => menu.opened?.image ?? null);
const menuFromMe = computed(() => menuMessage.value?.senderId === selfId.value);

function onMenuMessage(action: (message: DirectMessage) => void): () => void {
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
</script>

<template>
  <div ref="scrollElement" class="dm-conversation__scroll" @scroll="scroll.onScroll(loadOlder)">
    <div v-if="lobby.thread.loading" class="dm-conversation__loading" role="status">Загружаем переписку…</div>
    <div v-if="lobby.thread.historyError && groups.length === 0" class="dm-conversation__empty">
      {{ lobby.thread.historyError }}
    </div>
    <div
      v-else-if="groups.length === 0 && !lobby.thread.loading && !outbox.items.length"
      class="dm-conversation__empty"
    >
      Здесь пока пусто. Напишите первым!
    </div>
    <div v-else ref="threadElement" class="dm-conversation__thread">
      <div v-if="lobby.thread.historyError" class="dm-conversation__empty">{{ lobby.thread.historyError }}</div>
      <button
        v-if="lobby.thread.loadingOlder || lobby.thread.hasMoreBefore"
        type="button"
        class="dm-conversation__empty"
        :disabled="lobby.thread.loadingOlder"
        @click="void lobby.loadOlderThread(scroll.element)"
      >
        {{ lobby.thread.loadingOlder ? 'Загружаем…' : 'Показать предыдущие' }}
      </button>
      <template v-for="group in groups" :key="group.key">
        <div v-if="group.dayLabel" class="dm-conversation__day-divider">
          <span class="dm-conversation__day-label">{{ group.dayLabel }}</span>
        </div>
        <div class="dm-group">
          <button
            class="dm-group__avatar-button dm-group__trigger"
            type="button"
            aria-haspopup="dialog"
            :aria-label="group.fromMe ? 'Ваш профиль' : `Профиль ${peerName}`"
            @click="openProfile($event, group.fromMe)"
          >
            <Avatar
              class="dm-group__avatar"
              :name="group.fromMe ? selfName : peerName"
              :src="group.fromMe ? self.avatarUrl : peer?.avatarUrl"
              :color-key="group.fromMe ? self.avatarColorKey : peer?.avatarColorKey"
              :background="(group.fromMe ? self.avatarAccent : peer?.avatarAccent) || undefined"
              :size="32"
            />
          </button>
          <div class="dm-group__main">
            <div class="dm-group__meta">
              <button
                class="dm-group__author dm-group__trigger"
                type="button"
                aria-haspopup="dialog"
                :aria-label="group.fromMe ? 'Ваш профиль' : `Профиль ${peerName}`"
                @click="openProfile($event, group.fromMe)"
              >
                <EmojiText :text="group.fromMe ? selfName : peerName" /><AccountBadge
                  :user-id="group.fromMe ? selfId : peerId"
                />
              </button>
              <time class="dm-group__time" :datetime="new Date(group.bubbles[0].createdAt).toISOString()">{{
                clockTime(group.bubbles[0].createdAt)
              }}</time>
            </div>
            <MessageBubble
              v-for="bubble in group.bubbles"
              :key="bubble.id"
              :message="bubble"
              :text="bubble.body"
              variant="dm-msg"
              :maxlength="2000"
              :first="bubble.id === group.bubbles[0].id"
              :editing="menu.editingId === bubble.id"
              :menu-open="menu.opened?.message.id === bubble.id"
              :reactions="reactions"
              :user-id="selfId"
              :on-save-edit="
                async (text: string) => {
                  await lobby.editMessage(bubble.id, text);
                }
              "
              @menu="(event: MouseEvent) => openMessageMenu(bubble, event)"
              @jump="jumpToMessage"
              @reply="menu.replyTo(bubble)"
              @copy="void copyMessageText(bubble.body, pushToast)"
              @close-edit="menu.stopEditing()"
            >
              <template v-if="bubble.invite" #card>
                <DmInviteCard
                  :invite="bubble.invite"
                  :from-me="group.fromMe"
                  :busy="inviteResponding === bubble.id"
                  @respond="(action: 'accept' | 'decline') => void respondToInvite(bubble, action)"
                />
              </template>
              <template #content>
                <span v-if="bubble.body.trim()" class="dm-group__content"
                  ><ChatText :text="bubble.body" /><span v-if="bubble.editedAt" class="dm-group__edited"
                    >(изменено)</span
                  ></span
                >
              </template>
            </MessageBubble>
          </div>
        </div>
      </template>
      <OutgoingMessages
        :items="outbox.items"
        :text-of="(outgoing: OutgoingDirectMessage) => outgoing.text"
        :attachments-of="(outgoing: OutgoingDirectMessage) => outgoing.attachmentIds.length"
        @retry="(localId: string) => outbox.retry(localId)"
        @discard="(localId: string) => outbox.discard(localId)"
      />
    </div>
  </div>

  <DmComposer
    ref="composer"
    v-model:reply-target="menu.replyTarget"
    :peer-id="peerId"
    :self-id="selfId"
    :peer-name="peerName"
    :media="media"
    :typing-label="typingLabel"
    :on-edit-last="editLastOwnMessage"
    @jump="jumpToMessage"
  />

  <MessageContextMenu
    v-if="menu.opened"
    open
    :x="menu.opened.x"
    :y="menu.opened.y"
    :quick-reactions="quickReactions"
    :active-reactions="menu.activeReactions"
    :can-react="Boolean(selfId)"
    :can-edit="menuFromMe"
    :can-delete="menuFromMe"
    :on-copy-image="onMenuImage((image) => void copyMessageImage(image, pushToast))"
    :on-download-image="onMenuImage((image) => downloadAttachment(image))"
    :on-react="(emoji: string) => onMenuMessage((message) => void reactions.toggle(message.id, emoji))()"
    :on-open-reaction-picker="() => onMenuMessage((message) => scroll.openReactionPicker(message.id))()"
    :on-reply="onMenuMessage((message) => menu.replyTo(message))"
    :on-copy="onMenuMessage((message) => void copyMessageText(message.body, pushToast))"
    :on-edit="onMenuMessage((message) => menu.edit(message.id))"
    :on-delete="onMenuMessage((message) => void deleteMessage(message.id))"
    :on-report="menuFromMe ? undefined : onMenuMessage((message) => menu.report(message.id))"
    @close="menu.close()"
  />

  <ReportMessageDialog
    v-if="menu.reportedId"
    :target="{ kind: 'direct_message', messageId: menu.reportedId }"
    @close="menu.closeReport()"
    @reported="(message: string) => pushToast(message)"
  />
</template>
