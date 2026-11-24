import type { NativeVoicePreference } from '@voiceroom/shared/contracts/admission';
import { readStorage, removeStorage, writeStorage } from '@/shared/storage';

const STORAGE_KEY = 'voice-room:native-voice-preference';
let sessionPreference: NativeVoicePreference | undefined;
let connectionPreference: NativeVoicePreference | undefined;

export function readDesktopNativeVoicePreference(): NativeVoicePreference | undefined {
  if (typeof window === 'undefined' || !window.voiceRoomDesktopNativeVoice) return undefined;
  if (sessionPreference) return sessionPreference;
  const saved = readStorage(STORAGE_KEY);
  return saved === 'on' || saved === 'off' ? saved : 'default';
}

export function writeDesktopNativeVoicePreference(preference: NativeVoicePreference): void {
  sessionPreference = preference;
  // An active connection can opt out immediately. Enabling waits for a fresh join.
  if (preference === 'off' && connectionPreference !== undefined) connectionPreference = 'off';
  if (preference === 'default') removeStorage(STORAGE_KEY);
  else writeStorage(STORAGE_KEY, preference);
}

export function beginDesktopNativeVoiceConnection(): void {
  connectionPreference = readDesktopNativeVoicePreference();
}

export function endDesktopNativeVoiceConnection(): void {
  connectionPreference = undefined;
}

export function readDesktopNativeVoiceConnectionPreference(): NativeVoicePreference | undefined {
  return connectionPreference;
}
