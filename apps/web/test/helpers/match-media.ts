// jsdom has no matchMedia. Components that read a media query get one that
// answers `matches` for the queries listed (none by default).

import { vi } from 'vitest';

export function stubMatchMedia(matching: string[] = []): void {
  vi.stubGlobal('matchMedia', (media: string) => ({
    matches: matching.includes(media),
    media,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false
  }));
}
