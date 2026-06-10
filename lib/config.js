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

module.exports = { readEnvInt, readEnvBool };
