// Whether anyone can see the app right now. A browser tab answers through the
// Page Visibility API. The desktop app keeps its page "visible" during a call
// even in the tray (background throttling is off then), so the shell reports
// its window state instead (desktop-system.ts), including coverage by a game.

import type { AppWindowState } from '@voiceroom/shared/contracts/realtime';

type VisibilityListener = (visible: boolean) => void;

let desktopWindowVisible = true;
let desktopWindowCovered = false;
let lastVisible: boolean | null = null;
let documentListening = false;
const listeners = new Set<VisibilityListener>();

export function appWindowState(): AppWindowState {
  if (!desktopWindowVisible) return 'hidden';
  if (desktopWindowCovered) return 'covered';
  return typeof document !== 'undefined' && document.visibilityState === 'hidden' ? 'hidden' : 'visible';
}

export function isAppVisible(): boolean {
  return appWindowState() === 'visible';
}

function notify(): void {
  if (listeners.size === 0) return;
  const visible = isAppVisible();
  if (visible === lastVisible) return;
  lastVisible = visible;
  for (const listener of listeners) listener(visible);
}

export function setDesktopWindowVisible(visible: boolean, covered = false): void {
  if (desktopWindowVisible === visible && desktopWindowCovered === covered) return;
  desktopWindowVisible = visible;
  desktopWindowCovered = covered;
  notify();
}

export function onAppVisibilityChange(listener: VisibilityListener): () => void {
  if (listeners.size === 0) lastVisible = isAppVisible();
  listeners.add(listener);
  if (!documentListening && typeof document !== 'undefined') {
    documentListening = true;
    document.addEventListener('visibilitychange', notify);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && documentListening) {
      document.removeEventListener('visibilitychange', notify);
      documentListening = false;
      lastVisible = null;
    }
  };
}
