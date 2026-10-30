// Helpers for tests that need a fresh copy of a module (module-level state)
// under a controlled `window` and `localStorage`.

import { createPinia, setActivePinia } from 'pinia';
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

/**
 * Loads a module as a new instance: `freshImport(() => import('@/...'))`.
 * The import stays in the test, so the module keeps its type.
 *
 * `vi.resetModules()` clears the modules Vitest transforms itself (app source,
 * `.vue` files, test helpers). `vue`, `pinia` and `vue-router` are node_modules
 * Vitest leaves to Node, so they are not reloaded: the fresh module and the
 * test share one reactivity runtime, and refs from either side work together.
 * A store from `defineStore('x')` is cached on the active Pinia by id, so a
 * re-imported store would hand back the old instance and its state; this call
 * therefore also activates a new Pinia, and stores the fresh module creates
 * start from their initial state.
 */
export async function freshImport<T>(load: () => Promise<T>): Promise<T> {
  vi.resetModules();
  setActivePinia(createPinia());
  return load();
}

/** Silences console.warn for the current test. */
export function muteWarnings(): void {
  const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  onTestFinished(() => spy.mockRestore());
}
