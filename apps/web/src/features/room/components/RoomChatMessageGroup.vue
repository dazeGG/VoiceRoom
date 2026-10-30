<script setup lang="ts">
// One author's run of messages in the room chat: the avatar and name (which
// open the author's profile), then each message as a MessageBubble.
import { computed } from 'vue';
import type { ChatMessage } from '@/api/rooms';
import { useSessionStore } from '@/features/auth/session.store';
import EmojiText from '@/shared/chat/EmojiText.vue';
import MessageBubble from '@/shared/chat/MessageBubble.vue';
import type { MessageMenuState } from '@/shared/chat/message-menu-state';
import type { ReactionStore } from '@/shared/chat/reaction-store';
import StructuredMessageContent from '@/shared/chat/StructuredMessageContent.vue';
import ChatText from '@/shared/components/ChatText.vue';
import { AccountBadge, Avatar } from '@/shared/ui';
import { clockTime } from '@/shared/utils/date-format';
import { mentionsUser, type ChatGroup } from '../room-chat-view';

const props = defineProps<{
  group: ChatGroup;
  canOpenProfile: boolean;
  menu: MessageMenuState<ChatMessage>;
  reactions: ReactionStore;
  /** Saves the edited text; rejects when the server refuses, and the editor stays open. */
  onSaveEdit: (messageId: string, text: string) => Promise<void>;
  onMention: (userId: string, label: string, event: MouseEvent) => void;
}>();

const emit = defineEmits<{
  openProfile: [event: MouseEvent];
  authorMenu: [event: MouseEvent];
  jump: [messageId: string];
  copy: [message: ChatMessage];
}>();

const session = useSessionStore();
const profileLabel = computed(() => (props.group.self ? 'Ваш профиль' : `Профиль ${props.group.name}`));
</script>

<template>
  <div class="room-chat-group">
    <button
      v-if="canOpenProfile"
      class="room-chat-group__avatar-button room-chat-group__trigger"
      type="button"
      aria-haspopup="dialog"
      :aria-label="profileLabel"
      :title="profileLabel"
      @click="emit('openProfile', $event)"
      @contextmenu="emit('authorMenu', $event)"
    >
      <Avatar
        class="room-chat-group__avatar"
        :name="group.name"
        :src="group.avatarUrl"
        :background="group.avatarBackground"
        :foreground="group.avatarForeground"
        :size="32"
      />
    </button>
    <Avatar
      v-else
      class="room-chat-group__avatar"
      :name="group.name"
      :src="group.avatarUrl"
      :background="group.avatarBackground"
      :foreground="group.avatarForeground"
      :size="32"
    />
    <div class="room-chat-group__main">
      <div class="room-chat-group__meta">
        <button
          v-if="canOpenProfile"
          class="room-chat-group__author room-chat-group__trigger"
          type="button"
          aria-haspopup="dialog"
          :aria-label="profileLabel"
          @click="emit('openProfile', $event)"
          @contextmenu="emit('authorMenu', $event)"
        >
          <EmojiText :text="group.name" /><AccountBadge :user-id="group.authorUserId" />
        </button>
        <span v-else class="room-chat-group__author">
          <EmojiText :text="group.name" /><AccountBadge :user-id="group.authorUserId" />
        </span>
        <time class="room-chat-group__time" :datetime="new Date(group.messages[0].createdAt).toISOString()">{{
          clockTime(group.createdAt)
        }}</time>
      </div>
      <MessageBubble
        v-for="message in group.messages"
        :key="message.id"
        :message="message"
        :text="message.text"
        variant="chat-msg"
        :maxlength="500"
        :first="message.id === group.messages[0].id"
        :editing="menu.editingId === message.id"
        :menu-open="menu.opened?.message.id === message.id"
        :mentions-me="mentionsUser(message, session.user?.id)"
        :reactions="reactions"
        :user-id="session.user?.id"
        :on-save-edit="(text: string) => onSaveEdit(message.id, text)"
        @menu="(event: MouseEvent) => menu.open(message, event)"
        @jump="(messageId: string) => emit('jump', messageId)"
        @reply="menu.replyTo(message)"
        @copy="emit('copy', message)"
        @close-edit="menu.stopEditing()"
      >
        <template #content>
          <span class="room-chat-group__content"
            ><StructuredMessageContent
              v-if="message.content"
              :content="message.content"
              :fallback="message.text"
              :onmention="onMention"
            /><ChatText v-else :text="message.text" /><span v-if="message.editedAt" class="room-chat-group__edited"
              >(изменено)</span
            ></span
          >
        </template>
      </MessageBubble>
    </div>
  </div>
</template>
