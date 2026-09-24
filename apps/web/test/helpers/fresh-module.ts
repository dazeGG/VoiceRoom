// Helpers for tests that need a fresh copy of a module (module-level state)
// under a controlled `window` and `localStorage`.

import { onTestFinished, vi } from 'vitest';

const stubbed = new Map<string, PropertyDescriptor | undefined>();

function restoreWindow(): void {
  for (const [key, previous] of stubbed) {
    if (previous) Object.defineProperty(window, key, previous);
    else Reflect.deleteProperty(window, key);
  }
  stubbed.clear();
}

/**
 * Puts exactly `props` on the jsdom window for the current test: props from
 * an earlier call in the same test are removed first, and everything is
 * restored when the test finishes.
 */
export function stubWindow(props: Record<string, unknown>): void {
  if (stubbed.size === 0) onTestFinished(restoreWindow);
  restoreWindow();
  onTestFinished(restoreWindow);
  for (const [key, value] of Object.entries(props)) {
    stubbed.set(key, Object.getOwnPropertyDescriptor(window, key));
    Object.defineProperty(window, key, { configurable: true, writable: true, value });
  }
}

/** Imports a root-relative module (`/src/...`) as a new instance. */
export async function freshImport<T = Record<string, unknown>>(modulePath: string): Promise<T> {
  vi.resetModules();
  return (await import(/* @vite-ignore */ modulePath)) as T;
}

/** Silences console.warn for the current test. */
export function muteWarnings(): void {
  const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  onTestFinished(() => spy.mockRestore());
}
