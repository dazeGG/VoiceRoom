import { defineStore } from 'pinia';
import { ref } from 'vue';

export const DOCK_AUTOHIDE_STORAGE_KEY = 'voiceroom.dockAutoHide';

function readStoredDockAutoHide(): boolean {
  try {
    return localStorage.getItem(DOCK_AUTOHIDE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export const useAppearanceStore = defineStore('appearance', () => {
  const dockAutoHide = ref(false);

  function initAppearance(): void {
    dockAutoHide.value = readStoredDockAutoHide();
  }

  function setDockAutoHide(enabled: boolean): void {
    dockAutoHide.value = enabled;
    try {
      localStorage.setItem(DOCK_AUTOHIDE_STORAGE_KEY, String(enabled));
    } catch {
      // The choice still applies for this session.
    }
  }

  return { dockAutoHide, initAppearance, setDockAutoHide };
});
