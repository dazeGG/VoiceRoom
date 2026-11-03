import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rename, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createGeoLocator } from '../src/lib/geoip.ts';

function createLogger() {
  const entries: unknown[][] = [];
  return {
    entries,
    info: (...args: unknown[]) => entries.push(['info', ...args]),
    warn: (...args: unknown[]) => entries.push(['warn', ...args]),
    error: (...args: unknown[]) => entries.push(['error', ...args])
  };
}

test('the locator labels city and country, prefers Russian names and never throws', async () => {
  const lookups: string[] = [];
  const reader = {
    get(address: string) {
      lookups.push(address);
      if (address === '203.0.113.7') {
        return {
          city: { names: { en: 'Moscow', ru: 'Москва' } },
          country: { names: { en: 'Russia', ru: 'Россия' } }
        };
      }
      if (address === '198.51.100.1') return { country: { names: { en: 'Germany' } } };
      // The shape DB-IP City Lite actually returns: an English-only city with a
      // district suffix, and a country that also has a Russian name.
      if (address === '198.51.100.2') {
        return {
          city: { names: { en: 'Moscow (Tsentralnyy administrativnyy okrug)' } },
          country: { names: { en: 'Russia', ru: 'Россия' } }
        };
      }
      if (address === '192.0.2.1') throw new Error('corrupt record');
      return null;
    }
  };
  let opened = 0;
  const locator = createGeoLocator({
    databasePath: import.meta.filename,
    logger: createLogger(),
    openReader: async () => {
      opened += 1;
      return reader;
    }
  });

  assert.equal(locator.enabled, true);
  assert.equal(await locator.locate('::ffff:203.0.113.7'), 'Москва, Россия');
  assert.equal(await locator.locate('198.51.100.1'), 'Germany');
  assert.equal(await locator.locate('198.51.100.2'), 'Moscow, Russia');
  assert.equal(await locator.locate('192.0.2.1'), '');
  assert.equal(await locator.locate('10.0.0.1'), '');
  assert.equal(await locator.locate('unknown'), '');
  assert.equal(opened, 1, 'the database is opened once and reused');
  assert.deepEqual(lookups, ['203.0.113.7', '198.51.100.1', '198.51.100.2', '192.0.2.1', '10.0.0.1']);
});

test('without a usable database every lookup is empty', async () => {
  const disabled = createGeoLocator({ databasePath: '' });
  assert.equal(disabled.enabled, false);
  assert.equal(await disabled.locate('203.0.113.7'), '');

  const logger = createLogger();
  const missing = createGeoLocator({
    databasePath: path.join(import.meta.dirname, 'no-such-database.mmdb'),
    logger,
    openReader: async () => {
      throw new Error('must not be opened');
    }
  });
  assert.equal(await missing.locate('203.0.113.7'), '');
  assert.equal(await missing.locate('198.51.100.1'), '');
  assert.equal(logger.entries.filter(([level]) => level === 'warn').length, 1);

  const brokenLogger = createLogger();
  const broken = createGeoLocator({
    databasePath: import.meta.filename,
    logger: brokenLogger,
    openReader: async () => {
      throw new Error('not a MaxMind database');
    }
  });
  assert.equal(await broken.locate('203.0.113.7'), '');
  assert.equal(await broken.warm(), false);
  assert.equal(brokenLogger.entries.filter(([level]) => level === 'error').length, 1);
});

function placeReader(city: string) {
  return { get: () => ({ city: { names: { ru: city } } }) };
}

test('a refreshed database replaces the one in use without a restart', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'geoip-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const databasePath = path.join(directory, 'city.mmdb');
  const refreshFile = async (monthsLater: number) => {
    // The refresh writes a temporary file and renames it over the old one.
    const temporary = `${databasePath}.tmp`;
    await writeFile(temporary, 'database');
    const modified = new Date(Date.UTC(2026, 10 + monthsLater, 3));
    await utimes(temporary, modified, modified);
    await rename(temporary, databasePath);
  };

  const opens: Array<() => ReturnType<typeof placeReader>> = [
    () => placeReader('Первый'),
    () => {
      throw new Error('not a MaxMind database');
    },
    () => placeReader('Второй')
  ];
  let opened = 0;
  const logger = createLogger();
  const locator = createGeoLocator({
    databasePath,
    logger,
    openReader: async () => {
      const next = opens[opened++];
      if (!next) throw new Error('opened more often than the file changed');
      return next();
    }
  });
  const levels = (level: string) => logger.entries.filter(([entry]) => entry === level).length;

  // No file yet, so no location, and the warning is not repeated.
  assert.equal(await locator.locate('203.0.113.7'), '');
  assert.equal(await locator.locate('203.0.113.7'), '');
  assert.equal(levels('warn'), 1);

  // The file arrives after the process started.
  await refreshFile(0);
  assert.equal(await locator.locate('203.0.113.7'), 'Первый');
  assert.equal(await locator.locate('203.0.113.7'), 'Первый');
  assert.equal(opened, 1, 'an unchanged file is not opened again');
  assert.equal(levels('info'), 0, 'the first open is not a reload');

  // A file that does not open keeps the old reader and is tried only once.
  await refreshFile(1);
  assert.equal(await locator.locate('203.0.113.7'), 'Первый');
  assert.equal(await locator.locate('203.0.113.7'), 'Первый');
  assert.equal(opened, 2);
  assert.equal(levels('error'), 1);

  // The next good file takes over.
  await refreshFile(2);
  assert.equal(await locator.locate('203.0.113.7'), 'Второй');
  assert.equal(opened, 3);
  assert.equal(levels('info'), 1);

  // A file removed by hand leaves the reader in use.
  await rm(databasePath);
  assert.equal(await locator.locate('203.0.113.7'), 'Второй');
  assert.equal(levels('warn'), 2);
});

test('lookups during a reload share one open of the file', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'geoip-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const databasePath = path.join(directory, 'city.mmdb');
  await writeFile(databasePath, 'database');

  let opened = 0;
  const locator = createGeoLocator({
    databasePath,
    logger: createLogger(),
    openReader: async () => {
      opened += 1;
      return placeReader('Город');
    }
  });

  const labels = await Promise.all([locator.locate('203.0.113.7'), locator.locate('198.51.100.1'), locator.warm()]);
  assert.deepEqual(labels, ['Город', 'Город', true]);
  assert.equal(opened, 1);
});
