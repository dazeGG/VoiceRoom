// Shared, reactive in-room UI state bridging the Svelte shell components
// (top bar «Чат» toggle ↔ the chat rail). Kept separate from the vanilla room
// client, which owns voice/presence/DOM.
export const roomUi = $state<{ chatOpen: boolean; unreadChat: number }>({
  chatOpen: false,
  unreadChat: 0
});

export function markChatRead(): void {
  roomUi.unreadChat = 0;
}

export function incrementUnreadChat(): void {
  if (roomUi.chatOpen) return;
  roomUi.unreadChat += 1;
}

export function openChat(): void {
  roomUi.chatOpen = true;
  markChatRead();
}

export function toggleChat(): void {
  if (roomUi.chatOpen) {
    roomUi.chatOpen = false;
    return;
  }
  openChat();
}

export function closeChat(): void {
  roomUi.chatOpen = false;
}
