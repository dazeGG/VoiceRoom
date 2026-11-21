import { useLocalizedText } from '@voiceroom/ui/localized-text';
import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useGuestNameUiStore = defineStore('guest-name-ui', () => {
  const open = ref(false);
  const inputValue = ref('');
  const error = useLocalizedText();
  const setError = (source: () => string): void => {
    error.value = source;
  };
  return { open, inputValue, error, setError };
});
