// One "update available" notice for the web app and the desktop shell.
//
// The web app learns of a new deploy from the build's version check; the
// desktop shell reports its own downloaded release through its bridge. A
// shell restart also loads the newest web app, so when both are pending the
// one action is the restart. Nothing applies by itself during a call.

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { bindDesktopUpdate, installDesktopUpdate, type DesktopUpdateState } from '@/platform/desktop-update';

export type PendingUpdate = 'none' | 'web' | 'app';

export function pendingUpdate(webUpdated: boolean, shell: DesktopUpdateState | null): PendingUpdate {
  if (shell?.status === 'ready') return 'app';
  return webUpdated ? 'web' : 'none';
}

export const useAppUpdateStore = defineStore('app-update', () => {
  const shell = ref<DesktopUpdateState | null>(null);
  const applying = ref(false);
  const webUpdated = ref(false);
  let reload: () => void = () => window.location.reload();

  const pending = computed<PendingUpdate>(() => pendingUpdate(webUpdated.value, shell.value));

  /** `webUpdated` says whether a new deploy was seen; `reload` replaces the page reload. */
  function configure(options: { webUpdated?: boolean; reload?: () => void }): void {
    if (options.webUpdated !== undefined) webUpdated.value = options.webUpdated;
    if (options.reload) reload = options.reload;
  }

  /** Follows the desktop shell's update, if there is a shell. */
  function bind(): () => void {
    return bindDesktopUpdate((state) => {
      shell.value = state;
    });
  }

  async function apply(): Promise<void> {
    if (applying.value) return;
    const current = pending.value;
    if (current === 'none') return;
    applying.value = true;
    if (current === 'app' && (await installDesktopUpdate())) return;
    // A web update, or a shell that could not restart: a reload still brings the new web app.
    reload();
  }

  return { shell, applying, webUpdated, pending, configure, bind, apply };
});
