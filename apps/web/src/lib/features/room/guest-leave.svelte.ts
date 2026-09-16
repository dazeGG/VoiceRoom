// Shown to a guest who pressed «Выйти» instead of sending them straight home:
// the moment they leave is the natural one to offer an account. `isStatic` is
// captured before leaving, because the room client forgets the room on leave.
export const guestLeaveUi = $state<{ open: boolean; roomId: string; isStatic: boolean }>({
  open: false,
  roomId: '',
  isStatic: false
});

export function openGuestLeave(roomId: string, isStatic: boolean): void {
  guestLeaveUi.roomId = roomId;
  guestLeaveUi.isStatic = isStatic;
  guestLeaveUi.open = true;
}
