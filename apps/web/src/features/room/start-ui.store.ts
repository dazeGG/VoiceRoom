import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useStartUiStore = defineStore('start-ui', () => {
  const nameInput = ref('');
  const savedNameStatus = ref('Имя не сохранено');
  const savedNameState = ref<'empty' | 'saved' | 'dirty'>('empty');
  const createRoomLoading = ref(false);
  const roomCode = ref('');
  const missingRoomCode = ref('room');
  const soundButtonVisible = ref(false);
  return {
    nameInput,
    savedNameStatus,
    savedNameState,
    createRoomLoading,
    roomCode,
    missingRoomCode,
    soundButtonVisible
  };
});

export function getNameStatusView(
  currentName: string,
  savedName: string
): { text: string; state: 'empty' | 'saved' | 'dirty' } {
  if (savedName && currentName === savedName) {
    return { text: `Сохранено: ${savedName}`, state: 'saved' };
  }
  if (savedName && currentName && currentName !== savedName) {
    return { text: 'Новое имя еще не сохранено', state: 'dirty' };
  }
  return { text: 'Имя не сохранено', state: 'empty' };
}
