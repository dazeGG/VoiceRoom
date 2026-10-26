// GET /api/client/policy: what the server asks of native apps. The Android app
// sends "User-Agent: VoiceRoom-Android/<x.y.z>" (client-version.ts) and reads
// this on a cold start. An app below `android.minVersion` gets HTTP 426 with
// code `client_outdated` on every other /api/* request, and its WebSocket
// closes with 4426 'Client outdated' before `ready`. This route itself is never
// refused, so an outdated app can still learn why.

import { Type, type Static } from 'typebox';
import { Nullable } from './http.ts';

export const ClientPolicy = Type.Object({
  contractVersion: Type.Literal(1),
  android: Type.Object({
    /** The oldest app version (`x.y.z`) the server still serves; null when there is no bound. */
    minVersion: Nullable(Type.String())
  })
});
export type ClientPolicy = Static<typeof ClientPolicy>;
