import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useGuestNameUiStore = defineStore('guest-name-ui', () => {
  const open = ref(false);
  const inputValue = ref('');
  const error = ref('');
  return { open, inputValue, error };
});
