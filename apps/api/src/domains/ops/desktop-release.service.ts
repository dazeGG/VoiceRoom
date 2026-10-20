// Latest desktop build, proxied from GitHub and cached. The browser downloads
// and runs what an asset URL points at, so only GitHub's release-download path
// of the configured repository is ever passed through.

import type { Logger } from 'pino';
import { isArray, isRecord, textOf } from '@voice-room/shared/guards';
import { LOG_EVENTS } from '../../lib/log-events.ts';

export interface DesktopAsset {
  url: string;
  size: number;
}

export interface DesktopRelease {
  version: string;
  htmlUrl: string;
  assets: Record<'mac-arm64' | 'mac-x64' | 'win-x64', DesktopAsset | null>;
}

export type DesktopReleaseResult =
  { status: 'ok'; release: DesktopRelease; cacheControl: string } | { status: 'unavailable' };

export interface DesktopReleaseServiceOptions {
  repo: string;
  cacheMs: number;
  timeoutMs: number;
  githubToken?: string | undefined;
  logger: Pick<Logger, 'warn'>;
  fetch?: typeof fetch;
  now?: () => number;
}

export function isDesktopReleaseDownloadUrl(value: unknown, repo: string): value is string {
  try {
    const url = new URL(textOf(value));
    return (
      url.protocol === 'https:' &&
      url.hostname === 'github.com' &&
      url.pathname.startsWith(`/${repo}/releases/download/`)
    );
  } catch {
    return false;
  }
}

// GitHub's release JSON, read field by field.
function pickReleaseAsset(assets: Record<string, unknown>[], patterns: RegExp[], repo: string): DesktopAsset | null {
  for (const pattern of patterns) {
    const found = assets.find((asset) => pattern.test(textOf(asset.name)));
    if (found && isDesktopReleaseDownloadUrl(found.browser_download_url, repo)) {
      return { url: found.browser_download_url, size: Number(found.size) || 0 };
    }
  }
  return null;
}

export function normalizeRelease(json: unknown, repo: string): DesktopRelease {
  const release = isRecord(json) ? json : {};
  const assets = isArray(release.assets) ? release.assets.filter(isRecord) : [];
  return {
    version: textOf(release.tag_name).replace(/^v/, ''),
    htmlUrl: typeof release.html_url === 'string' ? release.html_url : '',
    assets: {
      'mac-arm64': pickReleaseAsset(assets, [/-mac-arm64\.dmg$/i], repo),
      'mac-x64': pickReleaseAsset(assets, [/-mac-x64\.dmg$/i], repo),
      // Prefer the NSIS installer; fall back to the portable build.
      'win-x64': pickReleaseAsset(assets, [/-win-x64-setup\.exe$/i, /-win-x64\.exe$/i], repo)
    }
  };
}

export function createDesktopReleaseService(options: DesktopReleaseServiceOptions) {
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let cache: { at: number; release: DesktopRelease | null } = { at: 0, release: null };
  let inFlight: Promise<DesktopRelease> | null = null;

  async function fetchLatest(): Promise<DesktopRelease> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'voice-room-web',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (options.githubToken) headers.Authorization = `Bearer ${options.githubToken}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetchImpl(`https://api.github.com/repos/${options.repo}/releases/latest`, {
        headers,
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`GitHub responded ${response.status}`);
      const json: unknown = await response.json();
      return normalizeRelease(json, options.repo);
    } finally {
      clearTimeout(timeout);
    }
  }

  async function latest(): Promise<DesktopReleaseResult> {
    const at = now();
    if (cache.release && at - cache.at < options.cacheMs) {
      return { status: 'ok', release: cache.release, cacheControl: 'public, max-age=300' };
    }
    try {
      inFlight ??= fetchLatest().finally(() => {
        inFlight = null;
      });
      const release = await inFlight;
      cache = { at, release };
      return { status: 'ok', release, cacheControl: 'public, max-age=300' };
    } catch (error) {
      // Serve stale metadata if we have any; the binaries are still valid.
      if (cache.release) return { status: 'ok', release: cache.release, cacheControl: 'public, max-age=60' };
      options.logger.warn(
        { evt: LOG_EVENTS.DESKTOP_RELEASE_FETCH_FAILED, err: error },
        'failed to fetch the desktop release manifest'
      );
      return { status: 'unavailable' };
    }
  }

  return { latest };
}

export type DesktopReleaseService = ReturnType<typeof createDesktopReleaseService>;
