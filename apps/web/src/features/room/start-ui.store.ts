import { t } from '@/shared/i18n';
import { useLocalizedText } from '@/shared/i18n/localized-text';
import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useStartUiStore = defineStore('start-ui', () => {
  const nameInput = ref('');
  const savedNameStatus = useLocalizedText();
  savedNameStatus.value = () => t('Имя не сохранено');
  const savedNameState = ref<'empty' | 'saved' | 'dirty'>('empty');
  const createRoomLoading = ref(false);
  const roomCode = ref('');
  const missingRoomCode = ref('room');
  const soundButtonVisible = ref(false);
  return {
    nameInput,
    savedNameStatus,
    setSavedNameStatus: (source: () => string): void => {
      savedNameStatus.value = source;
    },
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
    return { text: t('Сохранено: {p0}', { p0: savedName }), state: 'saved' };
  }
  if (savedName && currentName && currentName !== savedName) {
    return { text: t('Новое имя еще не сохранено'), state: 'dirty' };
  }
  return { text: t('Имя не сохранено'), state: 'empty' };
}
