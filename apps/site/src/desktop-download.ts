// The download page's picker: the desktop builds, which one suits the visitor's
// computer, and what the latest release says about each. The page works without
// a script (every button leads to the releases page); scripts/download.ts
// sharpens it with this module.

import type { DesktopRelease } from '@voice-room/shared/contracts/ops';
import { isRecord } from '@voice-room/shared/guards';
import { RELEASES_URL } from './site.ts';

/** A platform the desktop app is built for; each has one asset in a release. */
export type DesktopBuildId = keyof DesktopRelease['assets'];

export interface DesktopBuild {
  id: DesktopBuildId;
  /** The tab: the system, then the processor or versions under it. */
  os: string;
  cpu: string;
  /** The download button's label. */
  cta: string;
  ext: string;
  /** What the build needs, shown before the release is known. */
  req: string;
}

/** In tab order; the first is chosen when nothing is known about the computer. */
export const DESKTOP_BUILDS: readonly DesktopBuild[] = [
  {
    id: 'win-x64',
    os: 'Windows',
    cpu: '10 и 11, 64-bit',
    cta: 'Скачать для Windows',
    ext: '.exe',
    req: 'Windows 10 и 11'
  },
  {
    id: 'mac-arm64',
    os: 'macOS',
    cpu: 'Apple Silicon',
    cta: 'Скачать для Mac на M-процессоре',
    ext: '.dmg',
    req: 'Mac на M-процессорах'
  },
  { id: 'mac-x64', os: 'macOS', cpu: 'Intel', cta: 'Скачать для Mac на Intel', ext: '.dmg', req: 'Mac на Intel' }
];

/** Before the release is known: the file type and what the build needs. */
export function staticMeta(build: DesktopBuild): string {
  return `${build.ext} · ${build.req}`;
}

export interface BuildGuess {
  id: DesktopBuildId;
  /** False when the build is only the likelier one (a Mac whose processor the browser hides). */
  sure: boolean;
}

/**
 * The build for this computer from the browser's user agent and, where the
 * browser tells it (`navigator.userAgentData` architecture), the processor.
 * Null on a phone, on Linux and on anything else without a build.
 */
export function guessBuild(userAgent: string, architecture = ''): BuildGuess | null {
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) return null;
  if (/Windows|Win64|Win32/i.test(userAgent)) return { id: 'win-x64', sure: true };
  if (/Mac OS X|Macintosh/i.test(userAgent)) {
    if (architecture === 'arm') return { id: 'mac-arm64', sure: true };
    if (architecture === 'x86') return { id: 'mac-x64', sure: true };
    return { id: 'mac-arm64', sure: false };
  }
  return null;
}

export interface BuildLink {
  href: string;
  meta: string;
}

/** One build's link from the release's asset for it; null when the asset is malformed. */
function linkFor(id: DesktopBuildId, asset: unknown, version: string): BuildLink | null {
  const build = DESKTOP_BUILDS.find((candidate) => candidate.id === id);
  if (!build) return null;
  if (asset === null) return { href: RELEASES_URL, meta: `${staticMeta(build)} · v${version}` };
  if (!isRecord(asset) || typeof asset.url !== 'string' || !/^https:\/\//.test(asset.url)) return null;
  if (typeof asset.size !== 'number') return null;
  const megabytes = Math.max(1, Math.round(asset.size / (1024 * 1024)));
  return { href: asset.url, meta: `${build.ext} · ~${megabytes} МБ · v${version}` };
}

/**
 * Each build's direct download from an `/api/desktop/latest` answer. A build
 * the release has no file for keeps the releases page; an answer of another
 * shape gives null, and the page stays as built.
 */
export function releaseLinks(answer: unknown): Record<DesktopBuildId, BuildLink> | null {
  if (!isRecord(answer) || answer.ok !== true || typeof answer.version !== 'string') return null;
  const { assets, version } = answer;
  if (!isRecord(assets)) return null;
  const windows = linkFor('win-x64', assets['win-x64'], version);
  const appleSilicon = linkFor('mac-arm64', assets['mac-arm64'], version);
  const intel = linkFor('mac-x64', assets['mac-x64'], version);
  if (!windows || !appleSilicon || !intel) return null;
  return { 'win-x64': windows, 'mac-arm64': appleSilicon, 'mac-x64': intel };
}
