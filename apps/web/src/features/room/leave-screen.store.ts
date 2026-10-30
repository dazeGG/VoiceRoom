// Shown instead of sending someone straight to `/` after «Покинуть звонок»:
// a guest is offered an account, and a phone, where `/` is desktop-only, stays
// on the room page with a way back into the call. `isStatic` is captured before
// leaving, because the room client forgets the room on leave.

import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useLeaveScreenStore = defineStore('leave-screen', () => {
  const open = ref(false);
  const roomId = ref('');
  const isStatic = ref(false);
  const guest = ref(false);

  function openLeaveScreen(input: { roomId: string; isStatic: boolean; guest: boolean }): void {
    roomId.value = input.roomId;
    isStatic.value = input.isStatic;
    guest.value = input.guest;
    open.value = true;
  }

  return { open, roomId, isStatic, guest, openLeaveScreen };
});
