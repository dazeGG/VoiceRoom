import type { DesktopAsset, DesktopRelease } from '$lib/api/desktop';

export const QUARANTINE_CMD = 'sudo xattr -rd com.apple.quarantine /Applications/Voice\\ Room.app';
export const RELEASES_URL = 'https://github.com/dazeGG/VoiceRoomDesktop/releases/latest';

export interface DesktopBuild {
  id: string;
  label: string;
  ext: string;
  req: string;
  mac: boolean;
}

export const DESKTOP_BUILDS: DesktopBuild[] = [
  { id: 'mac-arm64', label: 'macOS · Apple Silicon', ext: '.dmg', req: 'macOS 12+', mac: true },
  { id: 'mac-x64', label: 'macOS · Intel', ext: '.dmg', req: 'macOS 12+', mac: true },
  { id: 'win-x64', label: 'Windows · 64-bit', ext: '.exe', req: 'Windows 10/11', mac: false }
];

export function detectDesktopBuildId(): string {
  try {
    const ua = `${navigator.userAgent || ''} ${navigator.platform || ''}`;
    if (/Win/i.test(ua)) return 'win-x64';
  } catch {
    // Default to Apple Silicon below.
  }
  return 'mac-arm64';
}

export function formatDesktopReleaseMeta(
  build: DesktopBuild,
  asset: DesktopAsset | null | undefined,
  release: DesktopRelease | null,
  releaseLoading: boolean,
  releaseError: boolean
): string {
  if (releaseLoading) return 'Получаем последний релиз…';
  if (releaseError) return 'Не удалось получить релиз — откройте страницу загрузок.';
  const size = asset ? `~${Math.round(asset.size / (1024 * 1024))} МБ` : '';
  const version = release ? `v${release.version}` : '';
  return [build.ext, size, build.req, version].filter(Boolean).join(' · ');
}

export function desktopDownloadLabel(state: 'idle' | 'loading' | 'done'): string {
  if (state === 'loading') return 'Загрузка…';
  if (state === 'done') return 'Загрузка началась';
  return 'Скачать приложение';
}
