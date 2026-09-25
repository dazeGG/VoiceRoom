// Shown instead of sending someone straight to `/` after «Покинуть звонок»:
// a guest is offered an account, and a phone, where `/` is desktop-only, stays
// on the room page with a way back into the call. `isStatic` is captured before
// leaving, because the room client forgets the room on leave.
export const leaveScreenUi = $state<{ open: boolean; roomId: string; isStatic: boolean; guest: boolean }>({
  open: false,
  roomId: '',
  isStatic: false,
  guest: false
});

export function openLeaveScreen({
  roomId,
  isStatic,
  guest
}: {
  roomId: string;
  isStatic: boolean;
  guest: boolean;
}): void {
  leaveScreenUi.roomId = roomId;
  leaveScreenUi.isStatic = isStatic;
  leaveScreenUi.guest = guest;
  leaveScreenUi.open = true;
}
