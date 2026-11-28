#!/usr/bin/env node
// Dev only: writes a message to the official VoiceRoom account (@voiceroom)
// from a test account, so the admin «Поддержка» inbox has a conversation to
// work on before the in-app entry point exists. It goes through the API like
// the app does (sign in, then POST /api/dm/<official id>), so the support
// thread, the live event and the notification all happen for real.
//
// Run from the repository root against a dev stack:
//
//   node apps/api/src/scripts/dev-seed-support.ts \
//     --api http://localhost:3000 --login alice --password password123 \
//     --text "После сна пропадает звук"
//
// --api defaults to http://localhost:3000 and --text to a sample question.
// It refuses to run with NODE_ENV=production and against the production site.

import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { OFFICIAL_ACCOUNT_ID } from '@voiceroom/shared/official-account';

const Sent = Type.Object({ message: Type.Object({ id: Type.String() }) });

export interface SeedOptions {
  api: string;
  login: string;
  password: string;
  text: string;
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const DEFAULT_TEXT = 'Здравствуйте! После сна ноутбука пропадает звук у собеседника.';

/** The options from the command line; throws a usage error for a missing login or password. */
export function parseSeedArgs(argv: readonly string[]): SeedOptions {
  const value = (name: string) => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const login = value('login');
  const password = value('password');
  if (!login || !password)
    throw new Error('Usage: dev-seed-support.ts --login <login> --password <password> [--api <url>] [--text <text>]');
  return { api: value('api') ?? 'http://localhost:3000', login, password, text: value('text') ?? DEFAULT_TEXT };
}

/** Whether the address is the production site (voiceroom.ru and its non-dev subdomains). */
export function isProductionSite(api: string): boolean {
  const host = new URL(api).hostname;
  if (host === 'voiceroom.ru') return true;
  return host.endsWith('.voiceroom.ru') && !host.split('.').includes('dev');
}

/** Signs in as the test account and writes to @voiceroom; answers the new message's id. */
export async function seedSupportMessage(
  options: SeedOptions,
  { nodeEnv, fetch }: { nodeEnv: string | undefined; fetch: Fetch }
): Promise<string> {
  if (nodeEnv === 'production') throw new Error('dev-seed-support refuses to run with NODE_ENV=production');
  if (isProductionSite(options.api)) throw new Error('dev-seed-support refuses to write to the production site');
  const base = options.api.replace(/\/+$/, '');
  // No Origin header: the API checks it only for browsers.
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  const signedIn = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ login: options.login, password: options.password })
  });
  if (!signedIn.ok) throw new Error(`Sign-in failed: ${signedIn.status}`);
  const cookie = (signedIn.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const sent = await fetch(`${base}/api/dm/${OFFICIAL_ACCOUNT_ID}`, {
    method: 'POST',
    headers: { ...headers, Cookie: cookie },
    body: JSON.stringify({ text: options.text })
  });
  const body: unknown = await sent.json();
  if (!sent.ok || !Value.Check(Sent, body)) throw new Error(`Sending failed: ${sent.status} ${JSON.stringify(body)}`);
  return body.message.id;
}

if (import.meta.main) {
  seedSupportMessage(parseSeedArgs(process.argv.slice(2)), { nodeEnv: process.env.NODE_ENV, fetch }).then(
    (id) => console.log(`Wrote message ${id} to @voiceroom; open «Поддержка» in the admin app.`),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  );
}
