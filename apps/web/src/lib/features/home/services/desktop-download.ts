import { fetchDesktopRelease, type DesktopRelease } from '$lib/api/desktop';
import { RELEASES_URL, detectDesktopBuildId } from '../model/desktop-builds';

const RELEASE_DOWNLOAD_PREFIX = `${new URL(RELEASES_URL).pathname.replace(/\/releases\/latest$/, '')}/releases/download/`;

export function isDesktopReleaseAssetUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' && url.pathname.startsWith(RELEASE_DOWNLOAD_PREFIX);
  } catch {
    return false;
  }
}

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
  // An installer the user will run: follow only GitHub's release-download path
  // of the desktop repository, whatever the API answered.
  if (asset && isDesktopReleaseAssetUrl(asset.url)) {
    triggerDesktopDownload(asset.url);
  } else {
    window.open(RELEASES_URL, '_blank', 'noopener');
  }
}

/**
 * A download action for this device's build. The release is requested as soon
 * as the action is created, so a later click usually starts the download inside
 * the same gesture instead of after a request the browser may treat as a popup.
 */
export function createDesktopDownload(): () => Promise<void> {
  let release: DesktopRelease | null = null;
  const pending = fetchDesktopRelease()
    .then((latest) => (release = latest))
    .catch(() => null);
  return async () => {
    startDesktopBuildDownload(release ?? (await pending), detectDesktopBuildId());
  };
}
