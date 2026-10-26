import path from 'node:path';

type Env = NodeJS.ProcessEnv;

// Unset or empty means the default. Anything else must be a whole number of at
// least `min`: a typo (MAX_VOICE_PEERS=6OO) stops the start instead of
// running with the default.
function readEnvInt(name: string, fallback: number, min: number, env: Env = process.env): number {
  const raw = (env[name] || '').trim();
  if (!raw) return fallback;
  const value = /^-?\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < min) {
    throw new Error(`${name} must be an integer of at least ${min}, got "${raw}"`);
  }
  return value;
}

function readEnvBool(name: string, fallback: boolean, env: Env = process.env): boolean {
  const value = env[name];
  if (value === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function readMessageDeliveryMode(
  env: Env = process.env
): Readonly<{ claimEnabled: boolean; directEmitEnabled: boolean }> {
  const directEmitEnabled = readEnvBool('MESSAGE_DIRECT_EMIT_ENABLED', true, env);
  const claimEnabled = readEnvBool('MESSAGE_DELIVERY_CLAIM_ENABLED', false, env);
  if (directEmitEnabled && claimEnabled) {
    throw new Error('MESSAGE_DIRECT_EMIT_ENABLED and MESSAGE_DELIVERY_CLAIM_ENABLED cannot both be enabled');
  }
  return Object.freeze({ claimEnabled, directEmitEnabled });
}

function readDatabaseConfig(env: Env = process.env): { url: string } {
  const raw = typeof env.DATABASE_URL === 'string' ? env.DATABASE_URL.trim() : '';
  if (!raw) {
    throw new Error('DATABASE_URL is required for PostgreSQL persistence');
  }

  let parsed: URL;
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

function readUploadsDir(env: Env = process.env): string {
  const configured = typeof env.UPLOADS_DIR === 'string' ? env.UPLOADS_DIR.trim() : '';
  return path.resolve(configured || path.join(import.meta.dirname, '../../uploads'));
}

export { readEnvInt, readEnvBool, readMessageDeliveryMode, readDatabaseConfig, readUploadsDir };
