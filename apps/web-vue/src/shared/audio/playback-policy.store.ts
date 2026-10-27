import { defineStore } from 'pinia';
import { ref } from 'vue';

export const usePlaybackPolicyStore = defineStore('playback-policy', () => {
  const doNotDisturb = ref(false);

  function setDoNotDisturbPlaybackSuppressed(suppressed: boolean): void {
    doNotDisturb.value = Boolean(suppressed);
  }

  function isDoNotDisturbPlaybackSuppressed(): boolean {
    return doNotDisturb.value;
  }

  return { doNotDisturb, setDoNotDisturbPlaybackSuppressed, isDoNotDisturbPlaybackSuppressed };
});
