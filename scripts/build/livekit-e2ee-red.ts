// Lets an E2EE room send RED audio when the app asks for it.
//
// livekit-client turns RED off for every track of an encrypted room (`disableRed: this.isE2EEEnabled || ...`),
// because the SFU cannot strip encrypted RED for a subscriber that does not take it. Without RED a 1:1 call loses
// about ten times more audio at 6 % packet loss (lab, 2026-11-26). The app knows its peer: a call publishes with
// `red: true` only while the peer's key agreement says it takes RED. This patch makes the SDK honour that explicit
// choice under E2EE and keeps its default (RED off) for anything that does not ask.
//
// The patch must match the installed SDK exactly once; any other SDK source fails the build, so an upgrade has to
// review it (`.omc/research/e2ee-1to1/REPORT.md`, section "P0 lab checks").
import type { Plugin } from 'vite';

const STOCK = 'disableRed: this.isE2EEEnabled || !((_b = opts.red) !== null && _b !== void 0 ? _b : true)';
const PATCHED = 'disableRed: !((_b = opts.red) !== null && _b !== void 0 ? _b : !this.isE2EEEnabled)';
const SDK_MODULE = /[\\/]livekit-client[\\/]dist[\\/]livekit-client\.esm\.mjs$/;

export function patchLiveKitRedUnderE2ee(source: string): string {
  const matches = source.split(STOCK).length - 1;
  if (matches !== 1) {
    throw new Error(
      `livekit-client: expected one E2EE RED opt-out to patch, found ${matches}; review scripts/build/livekit-e2ee-red.ts for this SDK version`
    );
  }
  return source.replace(STOCK, PATCHED);
}

/** The patched source of the SDK module, or null for any other module. */
export function transformLiveKitModule(code: string, id: string): string | null {
  return SDK_MODULE.test(id.split('?', 1)[0] ?? '') ? patchLiveKitRedUnderE2ee(code) : null;
}

/** For both the build and the dev server's dependency pre-bundling (`optimizeDeps.rolldownOptions.plugins`). */
export function liveKitE2eeRedPlugin(): Plugin {
  return {
    name: 'voiceroom-livekit-e2ee-red',
    transform(code, id) {
      const patched = transformLiveKitModule(code, id);
      return patched === null ? null : { code: patched, map: null };
    }
  };
}
