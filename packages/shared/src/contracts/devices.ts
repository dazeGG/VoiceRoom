// /api/push/devices: a phone's push token. The Android app registers the
// token its push SDK gives it, with the session cookie, on every launch and
// after every sign-in; the token belongs to that session and goes away with it.

import { Type, type Static } from 'typebox';

/** Push services a token can come from. FCM and HMS join this list when the app ships outside RuStore. */
export const DEVICE_PUSH_PROVIDERS = ['rustore'] as const;
export const DevicePushProvider = Type.Enum(DEVICE_PUSH_PROVIDERS);
export type DevicePushProvider = Static<typeof DevicePushProvider>;

/** Far above a RuStore token's length, and small enough to leave room for the rest of a 4096-byte push. */
export const DEVICE_TOKEN_MAX_LENGTH = 1024;

/**
 * A push SDK's token is one word of printable ASCII, so its 1024 characters
 * are 1024 bytes: within the database index's row limit and a push's 4096
 * bytes. The API refuses any other token as `invalid_device_token`.
 */
export const DEVICE_TOKEN_PATTERN = /^[\x21-\x7E]{1,1024}$/;

/** The body of both POST (register) and DELETE (remove) /api/push/devices. */
export const DeviceTokenBody = Type.Object({
  provider: DevicePushProvider,
  token: Type.String({ minLength: 1, maxLength: DEVICE_TOKEN_MAX_LENGTH })
});
export type DeviceTokenBody = Static<typeof DeviceTokenBody>;
