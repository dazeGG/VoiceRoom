// One "update available" notice for the web app and the desktop shell.
//
// The web app learns of a new deploy from SvelteKit's version check; the
// desktop shell reports its own downloaded release through its bridge. A
// shell restart also loads the newest web app, so when both are pending the
// one action is the restart. Nothing applies by itself during a call.

import { bindDesktopUpdate, installDesktopUpdate, type DesktopUpdateState } from '$lib/platform/desktop-update';

export type PendingUpdate = 'none' | 'web' | 'app';

export function pendingUpdate(webUpdated: boolean, shell: DesktopUpdateState | null): PendingUpdate {
  if (shell?.status === 'ready') return 'app';
  return webUpdated ? 'web' : 'none';
}

export class AppUpdate {
  shell = $state<DesktopUpdateState | null>(null);
  applying = $state(false);
  readonly #webUpdated: () => boolean;
  readonly #reload: () => void;

  constructor(options: { webUpdated: () => boolean; reload?: () => void }) {
    this.#webUpdated = options.webUpdated;
    this.#reload = options.reload ?? (() => window.location.reload());
  }

  get pending(): PendingUpdate {
    return pendingUpdate(this.#webUpdated(), this.shell);
  }

  /** Follows the desktop shell's update, if there is a shell. */
  bind(): () => void {
    return bindDesktopUpdate((state) => {
      this.shell = state;
    });
  }

  async apply(): Promise<void> {
    if (this.applying) return;
    const pending = this.pending;
    if (pending === 'none') return;
    this.applying = true;
    if (pending === 'app' && (await installDesktopUpdate())) return;
    // A web update, or a shell that could not restart: a reload still brings the new web app.
    this.#reload();
  }
}
