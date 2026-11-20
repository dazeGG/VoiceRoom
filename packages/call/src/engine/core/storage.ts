import { getInstalledCallPorts } from '../ports';

export const DISPLAY_NAME_STORAGE_KEY = 'voice-room:name';

export function readStorage(key: string): string | null {
  return getInstalledCallPorts()?.storage.read(key) ?? null;
}

export function writeStorage(key: string, value: string): void {
  getInstalledCallPorts()?.storage.write(key, value);
}

export function removeStorage(key: string): void {
  getInstalledCallPorts()?.storage.remove(key);
}
