// Shared, reactive in-room UI state bridging the shell components
// (top bar «Чат» toggle ↔ the chat rail). Kept separate from the vanilla room
// client, which owns voice/presence/DOM.

import { defineStore } from 'pinia';
import { ref } from 'vue';

export type RoomPanelTab = 'chat' | 'participants';

export const useRoomUiStore = defineStore('room-ui', () => {
  const activePanel = ref<RoomPanelTab>('chat');
  const chatOpen = ref(false);
  const unreadChat = ref(0);

  function markChatRead(): void {
    unreadChat.value = 0;
  }

  function incrementUnreadChat(): void {
    if (chatOpen.value && activePanel.value === 'chat') return;
    unreadChat.value += 1;
  }

  function openChat(): void {
    activePanel.value = 'chat';
    chatOpen.value = true;
    markChatRead();
  }

  function toggleChat(): void {
    if (chatOpen.value) {
      chatOpen.value = false;
      return;
    }
    openChat();
  }

  function closeChat(): void {
    chatOpen.value = false;
  }

  function selectRoomPanel(tab: RoomPanelTab): void {
    activePanel.value = tab;
    chatOpen.value = true;
    if (tab === 'chat') markChatRead();
  }

  return {
    activePanel,
    chatOpen,
    unreadChat,
    markChatRead,
    incrementUnreadChat,
    openChat,
    toggleChat,
    closeChat,
    selectRoomPanel
  };
});
