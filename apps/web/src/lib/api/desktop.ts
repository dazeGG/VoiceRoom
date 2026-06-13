import { fetchJson } from './http';

export interface DesktopAsset {
  url: string;
  size: number;
}

export interface DesktopRelease {
  version: string;
  htmlUrl: string;
  /** Keyed by platform id: 'mac-arm64' | 'mac-x64' | 'win-x64'. */
  assets: Record<string, DesktopAsset | null>;
}

/** Latest desktop release metadata, proxied + cached by the API from GitHub. */
export function fetchDesktopRelease(): Promise<DesktopRelease> {
  return fetchJson<DesktopRelease>('/api/desktop/latest');
}
