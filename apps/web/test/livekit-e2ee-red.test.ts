// The build patch that lets an E2EE call send RED: it applies to the installed livekit-client exactly once, keeps
// the SDK's default for everything that does not ask, and refuses an SDK it does not recognise.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { expect, test } from 'vitest';
import { transformLiveKitModule } from '../scripts/deploy-contract.ts';

// The SDK's publish request: `disableRed` as the patched module computes it.
function disableRed(patched: string, e2ee: boolean, red: boolean | undefined): boolean {
  const expression = /disableRed: ([^,\n]+),/.exec(patched)?.[1];
  if (!expression) throw new Error('no disableRed in the patched SDK');
  const result: unknown = runInNewContext(`(function (opts) { var _b; return ${expression}; }).call(self, opts)`, {
    self: { isE2EEEnabled: e2ee },
    opts: red === undefined ? {} : { red }
  });
  if (typeof result !== 'boolean') throw new Error('disableRed is not a boolean');
  return result;
}

test('the installed SDK takes the patch: E2EE sends RED only when asked, plain rooms keep RED by default', () => {
  const sdk = fileURLToPath(import.meta.resolve('livekit-client'));
  const patched = transformLiveKitModule(readFileSync(sdk, 'utf8'), sdk);
  if (patched === null) throw new Error('the SDK module was not patched');

  // An encrypted room: RED only on an explicit `red: true`, the app's choice while the peer takes it.
  expect(disableRed(patched, true, true)).toBe(false);
  expect(disableRed(patched, true, false)).toBe(true);
  expect(disableRed(patched, true, undefined)).toBe(true);
  // Any other room keeps the SDK's behaviour.
  expect(disableRed(patched, false, undefined)).toBe(false);
  expect(disableRed(patched, false, true)).toBe(false);
  expect(disableRed(patched, false, false)).toBe(true);
});

test('other modules pass through, and an SDK the patch does not recognise fails the build', () => {
  expect(transformLiveKitModule('export const x = 1;', '/app/src/main.ts')).toBeNull();
  expect(() =>
    transformLiveKitModule('export const x = 1;', '/node_modules/livekit-client/dist/livekit-client.esm.mjs')
  ).toThrow(/review scripts\/build\/livekit-e2ee-red\.ts/);
});
