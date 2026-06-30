export const startUi = $state({
  nameInput: '',
  savedNameStatus: 'Имя не сохранено',
  savedNameState: 'empty' as 'empty' | 'saved' | 'dirty',
  createRoomLoading: false,
  roomCode: '',
  missingRoomCode: 'room',
  soundButtonVisible: false
});

export function getNameStatusView(currentName: string, savedName: string): { text: string; state: 'empty' | 'saved' | 'dirty' } {
  if (savedName && currentName === savedName) {
    return { text: `Сохранено: ${savedName}`, state: 'saved' };
  }
  if (savedName && currentName && currentName !== savedName) {
    return { text: 'Новое имя еще не сохранено', state: 'dirty' };
  }
  return { text: 'Имя не сохранено', state: 'empty' };
}