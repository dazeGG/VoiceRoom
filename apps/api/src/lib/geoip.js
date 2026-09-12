'use strict';

const fs = require('node:fs');
const net = require('node:net');

const LOCATION_LABEL_MAX_LENGTH = 120;

function normalizeAddress(value) {
  const address = String(value || '').trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
  return net.isIP(address) ? address : '';
}

function namesOf(place) {
  const names = place && typeof place === 'object' ? place.names : null;
  return names && typeof names === 'object' ? names : {};
}

// DB-IP Lite names cities in English only and sometimes appends the district
// in parentheses ("Moscow (Tsentralnyy administrativnyy okrug)").
function placeName(place, language) {
  const names = namesOf(place);
  const name = names[language] || names.en || '';
  return typeof name === 'string' ? name.replace(/\s*\([^)]*\)\s*$/, '').trim() : '';
}

// One language per label: Russian only when the city itself has a Russian
// name, so a lookup never produces "Moscow, Россия".
function formatLocation(record) {
  if (!record || typeof record !== 'object') return '';
  const language = !record.city || namesOf(record.city).ru ? 'ru' : 'en';
  return [placeName(record.city, language), placeName(record.country, language)]
    .filter(Boolean)
    .join(', ')
    .slice(0, LOCATION_LABEL_MAX_LENGTH);
}

// City/country label for the signed-in devices list, looked up locally in a
// MaxMind-format database (DB-IP City Lite in production). The address is only
// read here: it is never stored or sent anywhere. Without a database every
// lookup answers '' and the list simply shows no location.
function createGeoLocator({ databasePath = '', logger = console, openReader } = {}) {
  let readerPromise = null;

  function loadReader() {
    if (!databasePath) return Promise.resolve(null);
    readerPromise ||= (async () => {
      if (!fs.existsSync(databasePath)) {
        logger.warn?.(`GeoIP database not found at ${databasePath}; device locations are disabled`);
        return null;
      }
      const open = openReader || ((path) => require('maxmind').open(path));
      return open(databasePath);
    })().catch((error) => {
      logger.error?.('Failed to open GeoIP database:', error);
      return null;
    });
    return readerPromise;
  }

  async function locate(ip) {
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

module.exports = { createGeoLocator, formatLocation, normalizeAddress };
