// Whether anyone can see the app right now. A browser tab answers through the
// Page Visibility API. The desktop app keeps its page "visible" during a call
// even in the tray (background throttling is off then), so the shell reports
// its window state instead (desktop-system.ts). Remote video is paused while the
// app is not visible: nobody would see it, yet it would still be decoded.

type VisibilityListener = (visible: boolean) => void;

let desktopWindowVisible = true;
let lastVisible: boolean | null = null;
let documentListening = false;
const listeners = new Set<VisibilityListener>();

export function isAppVisible(): boolean {
  if (!desktopWindowVisible) return false;
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

function notify(): void {
  const visible = isAppVisible();
  if (visible === lastVisible) return;
  lastVisible = visible;
  for (const listener of listeners) listener(visible);
}

export function setDesktopWindowVisible(visible: boolean): void {
  if (desktopWindowVisible === visible) return;
  desktopWindowVisible = visible;
  notify();
}

export function onAppVisibilityChange(listener: VisibilityListener): () => void {
  listeners.add(listener);
  lastVisible ??= isAppVisible();
  if (!documentListening && typeof document !== 'undefined') {
    documentListening = true;
    document.addEventListener('visibilitychange', notify);
  }
  return () => {
    listeners.delete(listener);
  };
}
