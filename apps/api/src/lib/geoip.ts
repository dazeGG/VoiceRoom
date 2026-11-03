import fs from 'node:fs';
import net from 'node:net';
import { LOG_EVENTS } from './log-events.ts';
import { createLogger } from './logger.ts';
import { isRecord } from '@voice-room/shared/guards';
import { fieldOf } from '../platform/record.ts';
import type { Logger } from '../platform/types.ts';

const LOCATION_LABEL_MAX_LENGTH = 120;

type Names = Record<string, unknown>;
type GeoReader = { get(address: string): unknown };

export type GeoLocator = Readonly<{ enabled: boolean; locate(ip: unknown): Promise<string>; warm(): Promise<boolean> }>;

function normalizeAddress(value: unknown): string {
  const address = (typeof value === 'string' ? value : '').trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
  return net.isIP(address) ? address : '';
}

function namesOf(place: unknown): Names {
  const names = fieldOf(place, 'names');
  return isRecord(names) ? names : {};
}

// DB-IP Lite names cities in English only and sometimes appends the district
// in parentheses ("Moscow (Tsentralnyy administrativnyy okrug)").
function placeName(place: unknown, language: string): string {
  const names = namesOf(place);
  const name = names[language] || names.en || '';
  return typeof name === 'string' ? name.replace(/\s*\([^)]*\)\s*$/, '').trim() : '';
}

// One language per label: Russian only when the city itself has a Russian
// name, so a lookup never produces "Moscow, Россия".
function formatLocation(input: unknown): string {
  if (!isRecord(input)) return '';
  const { city, country } = input;
  const language = !city || namesOf(city).ru ? 'ru' : 'en';
  return [placeName(city, language), placeName(country, language)]
    .filter(Boolean)
    .join(', ')
    .slice(0, LOCATION_LABEL_MAX_LENGTH);
}

// City/country label for the signed-in devices list, looked up locally in a
// MaxMind-format database (DB-IP City Lite in production). The address is only
// read here: it is never stored or sent anywhere. Without a database every
// lookup answers '' and the list simply shows no location.
//
// The monthly refresh renames a new file over the old one, so each lookup
// compares the file's modified time and the first one after a change opens it.
// A file that goes missing or does not open leaves the reader already in use.
function createGeoLocator({
  databasePath = '',
  logger = createLogger({ name: 'api' }),
  openReader
}: {
  databasePath?: string;
  logger?: Pick<Logger, 'info' | 'warn' | 'error'>;
  openReader?: (path: string) => Promise<GeoReader>;
} = {}): GeoLocator {
  let reader: GeoReader | null = null;
  // The modified time last acted on: null for a missing file, undefined before the first look.
  let seenVersion: number | null | undefined;
  let refreshing: Promise<void> | null = null;

  async function refresh(): Promise<void> {
    const version = await fs.promises.stat(databasePath).then(
      (stats) => stats.mtimeMs,
      () => null
    );
    if (version === seenVersion) return;
    seenVersion = version;
    if (version === null) {
      logger.warn(
        { evt: LOG_EVENTS.GEOIP_UNAVAILABLE, databasePath, reason: 'missing' },
        reader
          ? 'GeoIP database not found; keeping the one already open'
          : 'GeoIP database not found; device locations are disabled'
      );
      return;
    }
    const open = openReader || ((path: string) => import('maxmind').then((maxmind) => maxmind.open(path)));
    try {
      const replaced = reader !== null;
      reader = await open(databasePath);
      if (replaced) logger.info({ evt: LOG_EVENTS.GEOIP_RELOADED, databasePath }, 'reloaded the GeoIP database');
    } catch (error: unknown) {
      logger.error(
        { evt: LOG_EVENTS.GEOIP_UNAVAILABLE, databasePath, reason: 'open_failed', err: error },
        'failed to open the GeoIP database'
      );
    }
  }

  async function loadReader(): Promise<GeoReader | null> {
    if (!databasePath) return null;
    refreshing ||= refresh().finally(() => {
      refreshing = null;
    });
    await refreshing;
    return reader;
  }

  async function locate(ip: unknown): Promise<string> {
    const address = normalizeAddress(ip);
    if (!address) return '';
    const reader = await loadReader();
    if (!reader) return '';
    try {
      return formatLocation(reader.get(address));
    } catch {
      return '';
    }
  }

  return Object.freeze({
    enabled: Boolean(databasePath),
    locate,
    warm: () => loadReader().then(Boolean)
  });
}

export { createGeoLocator };
