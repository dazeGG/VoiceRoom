import type { DesktopRelease } from '$lib/api/desktop';
import { RELEASES_URL } from '../model/desktop-builds';

export function triggerDesktopDownload(url: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * Downloads one desktop build from the latest release, or opens the releases
 * page when the API could not return the release or has no asset for it.
 */
export function startDesktopBuildDownload(release: DesktopRelease | null, buildId: string): void {
  const asset = release?.assets[buildId] ?? null;
  if (asset) {
    triggerDesktopDownload(asset.url);
  } else {
    window.open(RELEASES_URL, '_blank', 'noopener');
  }
}
