'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createGeoLocator } = require('../src/lib/geoip');

function createLogger() {
  const entries = [];
  return {
    entries,
    warn: (...args) => entries.push(['warn', ...args]),
    error: (...args) => entries.push(['error', ...args])
  };
}

test('the locator labels city and country, prefers Russian names and never throws', async () => {
  const lookups = [];
  const reader = {
    get(address) {
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
    databasePath: __filename,
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
    databasePath: path.join(__dirname, 'no-such-database.mmdb'),
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
    databasePath: __filename,
    logger: brokenLogger,
    openReader: async () => {
      throw new Error('not a MaxMind database');
    }
  });
  assert.equal(await broken.locate('203.0.113.7'), '');
  assert.equal(await broken.warm(), false);
  assert.equal(brokenLogger.entries.filter(([level]) => level === 'error').length, 1);
});
