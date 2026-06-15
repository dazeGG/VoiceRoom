'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);

// scrypt cost parameters. N must be a power of two; 2^14 keeps per-hash memory
// (≈ 128 * N * r bytes ≈ 16 MiB) under Node's default 32 MiB scrypt budget.
const COST = 16384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const ALGORITHM = 'scrypt';

// Self-describing hash so the parameters travel with the stored value and can be
// rotated later without a migration: scrypt$N$r$p$saltB64$hashB64
async function hashPassword(password) {
  if (typeof password !== 'string' || !password) {
    throw new Error('Password is required');
  }
  const salt = crypto.randomBytes(SALT_BYTES);
  const derived = await scrypt(password, salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELIZATION
  });
  return [
    ALGORITHM,
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString('base64'),
    derived.toString('base64')
  ].join('$');
}

async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== ALGORITHM) return false;

  const cost = Number.parseInt(parts[1], 10);
  const blockSize = Number.parseInt(parts[2], 10);
  const parallelization = Number.parseInt(parts[3], 10);
  if (!Number.isFinite(cost) || !Number.isFinite(blockSize) || !Number.isFinite(parallelization)) {
    return false;
  }

  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[4], 'base64');
    expected = Buffer.from(parts[5], 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let derived;
  try {
    derived = await scrypt(password, salt, expected.length, {
      N: cost,
      r: blockSize,
      p: parallelization
    });
  } catch {
    return false;
  }

  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

module.exports = { hashPassword, verifyPassword };
