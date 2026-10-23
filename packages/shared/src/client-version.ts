// The VoiceRoom Android app names itself and its version in its user agent,
// "VoiceRoom-Android/<x.y.z>", and the server refuses an app below the minimum
// version it is set to. account-security.ts writes the same pattern for
// clientKind; a shared test pins both to the same user agents.

import { compareReleaseVersions, normalizeReleaseVersion } from './account-security.ts';

/** The product token the Android app puts in its user agent, before "/<x.y.z>". */
export const ANDROID_APP_PRODUCT = 'VoiceRoom-Android';

const ANDROID_APP_PATTERN = /VoiceRoom-Android\/(\S*)/i;

export function isAndroidAppUserAgent(userAgent: string | null | undefined): boolean {
  return parseAndroidAppVersion(userAgent) !== null;
}

/**
 * The app's `x.y.z`; an empty string when the app sent a version that is not
 * plain `x.y.z` (a suffix, a missing part); null when it is not the app.
 */
export function parseAndroidAppVersion(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  const match = ANDROID_APP_PATTERN.exec(userAgent);
  return match ? normalizeReleaseVersion(match[1]) : null;
}

/**
 * True when `version` is below `minVersion`, or is not a version at all while
 * a minimum is set. An empty or malformed minimum sets no bound.
 */
export function isVersionBelow(version: string | null | undefined, minVersion: string): boolean {
  if (!normalizeReleaseVersion(minVersion)) return false;
  const order = compareReleaseVersions(version, minVersion);
  return order === null || order < 0;
}

/** Only the Android app is ever outdated; a browser, the desktop app or no user agent never is. */
export function isClientOutdated(userAgent: string | null | undefined, minVersion: string): boolean {
  const version = parseAndroidAppVersion(userAgent);
  return version !== null && isVersionBelow(version, minVersion);
}
