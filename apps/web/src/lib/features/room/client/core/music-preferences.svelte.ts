import {
  clampMusicVolume,
  getStoredMusicMuted,
  getStoredMusicVolume,
  storeMusicMuted,
  storeMusicVolume
} from './settings';

/**
 * The listener's own music mute and volume — one source of truth for both the
 * UI that renders them and the audio routing that applies them.
 *
 * It lives in `core` rather than in the feature store because both sides need
 * it: `services/media-playback-service` applies it as gain on every routing
 * pass, and `features/room/room-music.svelte` renders it. A copy in the feature
 * store read back out of `localStorage` by the service would be two sources
 * that only agree for as long as every setter remembers to persist first.
 *
 * Both values are client-only and never reach the server: muting the music must
 * not silence it for the rest of the room.
 */
export const musicPreferences = $state({
  muted: getStoredMusicMuted(),
  volume: getStoredMusicVolume()
});

export function setMusicPreferenceMuted(muted: boolean): boolean {
  musicPreferences.muted = storeMusicMuted(muted);
  return musicPreferences.muted;
}

export function setMusicPreferenceVolume(volume: number): number {
  musicPreferences.volume = storeMusicVolume(volume);
  return musicPreferences.volume;
}

/** Re-reads the persisted values, for a tab that was not the one writing them. */
export function reloadMusicPreferences(): void {
  musicPreferences.muted = getStoredMusicMuted();
  musicPreferences.volume = clampMusicVolume(getStoredMusicVolume());
}
