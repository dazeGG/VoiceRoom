'use strict';

const path = require('node:path');

function readEnvInt(name, fallback, min, env = process.env) {
  const value = Number.parseInt(env[name] || String(fallback), 10);
  return Number.isFinite(value) && value >= min ? value : fallback;
}

function readEnvBool(name, fallback, env = process.env) {
  const value = env[name];
  if (value === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function readMessageDeliveryMode(env = process.env) {
  const directEmitEnabled = readEnvBool('MESSAGE_DIRECT_EMIT_ENABLED', true, env);
  const claimEnabled = readEnvBool('MESSAGE_DELIVERY_CLAIM_ENABLED', false, env);
  if (directEmitEnabled && claimEnabled) {
    throw new Error('MESSAGE_DIRECT_EMIT_ENABLED and MESSAGE_DELIVERY_CLAIM_ENABLED cannot both be enabled');
  }
  return Object.freeze({ claimEnabled, directEmitEnabled });
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

function readUploadsDir(env = process.env) {
  const configured = typeof env.UPLOADS_DIR === 'string' ? env.UPLOADS_DIR.trim() : '';
  return path.resolve(configured || path.join(__dirname, '../../uploads'));
}

module.exports = { readEnvInt, readEnvBool, readMessageDeliveryMode, readDatabaseConfig, readUploadsDir };
