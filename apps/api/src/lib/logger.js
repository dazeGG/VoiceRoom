'use strict';

const crypto = require('node:crypto');
const pino = require('pino');

const { version: SERVICE_VERSION } = require('../../package.json');

// Values that must never reach a log sink, whatever nests them. Redaction is
// applied by pino at serialization time so an accidental `log.info({ req })`
// cannot leak a cookie or a bearer token through a path nobody reviewed.
const REDACTED_PATHS = Object.freeze([
  'password',
  'passwordHash',
  'token',
  'sessionToken',
  'refreshToken',
  'recoveryCode',
  'recoveryCodes',
  'email',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.sessionToken',
  '*.token',
  '*.email',
  '*.authorization',
  '*.cookie'
]);

// `silent` keeps tests and local runs quiet without every call site guarding
// on an environment check.
const DISABLED_LEVELS = Object.freeze(['false', 'off', 'none', 'silent']);

function getLogLevel(env = process.env) {
  const configured = (env.LOG_LEVEL || '').trim();
  if (configured) return configured;
  return env.NODE_ENV === 'production' ? 'info' : 'silent';
}

function isLoggingDisabled(env = process.env) {
  return DISABLED_LEVELS.includes(getLogLevel(env).toLowerCase());
}

function baseFields(env = process.env, name = 'api') {
  return {
    service: name,
    version: SERVICE_VERSION,
    env: env.NODE_ENV || 'development'
  };
}

// Shared options so a worker's records and the API's records are the same
// shape: one query on `evt` spans both.
function loggerOptions(env = process.env, name = 'api') {
  return {
    base: baseFields(env, name),
    level: getLogLevel(env).toLowerCase(),
    redact: { paths: [...REDACTED_PATHS], remove: true },
    serializers: { err: pino.stdSerializers.err }
  };
}

// Fastify owns its own logger instance; it takes the options, not a logger.
function createFastifyLoggerOptions(env = process.env) {
  if (isLoggingDisabled(env)) return false;
  return loggerOptions(env, 'api');
}

// Workers and scripts have no Fastify instance, so they build their own. The
// fallback keeps a disabled logger API-compatible: call sites use `log.warn`
// unconditionally rather than `logger.warn?.()` guards.
// Dozens of call sites take a logger as a defaulted parameter, so an uncached
// factory would build a separate pino instance — and its own stream — per store
// and per pool. One instance per name is enough.
const sharedLoggers = new Map();

function createLogger({ env = process.env, name = 'api', destination } = {}) {
  const options = loggerOptions(env, name);
  if (isLoggingDisabled(env)) options.level = 'silent';
  // A caller that supplies its own destination wants its own instance.
  if (destination) return pino(options, destination);

  const key = `${name}:${options.level}`;
  let logger = sharedLoggers.get(key);
  if (!logger) {
    logger = pino(options);
    sharedLoggers.set(key, logger);
  }
  return logger;
}

// Identifiers that are useful to correlate but must not be reversible to a
// person or a household. A per-process salt means a hash cannot be matched
// across restarts either, which is the intent: it links records inside one
// incident window, nothing more.
const IP_SALT = crypto.randomBytes(16);

function hashIp(ip) {
  if (!ip) return 'unknown';
  return crypto.createHash('sha256').update(IP_SALT).update(String(ip)).digest('hex').slice(0, 12);
}

// Request ids arrive from the edge and are therefore untrusted input: cap the
// length and the alphabet so a caller cannot inject newlines into the log
// stream or blow up record size.
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

function normalizeRequestId(value) {
  const candidate = Array.isArray(value) ? value[0] : value;
  const trimmed = String(candidate || '').trim();
  return REQUEST_ID_PATTERN.test(trimmed) ? trimmed : '';
}

function newRequestId() {
  return crypto.randomUUID();
}

module.exports = {
  createFastifyLoggerOptions,
  createLogger,
  getLogLevel,
  hashIp,
  isLoggingDisabled,
  loggerOptions,
  newRequestId,
  normalizeRequestId,
  REDACTED_PATHS,
  REQUEST_ID_PATTERN
};
