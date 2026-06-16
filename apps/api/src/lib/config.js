'use strict';

function readEnvInt(name, fallback, min, env = process.env) {
  const value = Number.parseInt(env[name] || String(fallback), 10);
  return Number.isFinite(value) && value >= min ? value : fallback;
}

function readEnvBool(name, fallback, env = process.env) {
  const value = env[name];
  if (value === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function readDatabaseConfig(env = process.env) {
  const raw = typeof env.DATABASE_URL === 'string' ? env.DATABASE_URL.trim() : '';
  if (!raw) {
    throw new Error('DATABASE_URL is required for PostgreSQL persistence');
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL');
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must use postgres:// or postgresql://');
  }

  return { url: raw };
}

module.exports = { readEnvInt, readEnvBool, readDatabaseConfig };
