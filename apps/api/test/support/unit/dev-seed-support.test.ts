// The dev seed on a fake API: it refuses production, signs in, then writes to
// the official account with the session it got.

import assert from 'node:assert/strict';
import test from 'node:test';
import { OFFICIAL_ACCOUNT_ID } from '@voiceroom/shared/official-account';
import { isProductionSite, parseSeedArgs, seedSupportMessage } from '../../../src/scripts/dev-seed-support.ts';

const options = { api: 'http://localhost:3000/', login: 'alice', password: 'password123', text: 'Помогите' };

function fakeApi(answers: { login?: number; send?: [number, unknown] } = {}) {
  const calls = new Array<{ url: string; init: RequestInit }>();
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith('/api/auth/login'))
      return new Response('{}', { status: answers.login ?? 200, headers: { 'set-cookie': 'vr_session=abc; Path=/' } });
    const [status, body] = answers.send ?? [201, { ok: true, message: { id: 'm1' } }];
    return new Response(JSON.stringify(body), { status });
  };
  return { calls, fetch };
}

test('the arguments need a login and a password; the address and text have defaults', () => {
  assert.throws(() => parseSeedArgs(['--login', 'alice']), /Usage/);
  assert.deepEqual(parseSeedArgs(['--login', 'alice', '--password', 'pw']).api, 'http://localhost:3000');
  assert.equal(parseSeedArgs(['--login', 'a', '--password', 'p', '--text', 'Привет']).text, 'Привет');
  assert.ok(parseSeedArgs(['--login', 'a', '--password', 'p']).text.length > 0);
});

test('production is refused by NODE_ENV and by address', async () => {
  const api = fakeApi();
  await assert.rejects(seedSupportMessage(options, { nodeEnv: 'production', fetch: api.fetch }), /NODE_ENV/);
  for (const site of ['https://voiceroom.ru', 'https://app.voiceroom.ru'])
    await assert.rejects(
      seedSupportMessage({ ...options, api: site }, { nodeEnv: 'development', fetch: api.fetch }),
      /production site/
    );
  assert.deepEqual(api.calls, []);
  assert.equal(isProductionSite('https://app.dev.voiceroom.ru'), false);
  assert.equal(isProductionSite('http://127.0.0.1:3000'), false);
});

test('it signs in, then writes to @voiceroom with that session', async () => {
  const api = fakeApi();
  assert.equal(await seedSupportMessage(options, { nodeEnv: undefined, fetch: api.fetch }), 'm1');
  assert.deepEqual(
    api.calls.map((call) => call.url),
    ['http://localhost:3000/api/auth/login', `http://localhost:3000/api/dm/${OFFICIAL_ACCOUNT_ID}`]
  );
  const sent = api.calls[1]?.init;
  assert.equal(new Headers(sent?.headers).get('cookie'), 'vr_session=abc');
  assert.equal(sent?.body, JSON.stringify({ text: 'Помогите' }));
});

test('a failed sign-in or send says so', async () => {
  await assert.rejects(
    seedSupportMessage(options, { nodeEnv: undefined, fetch: fakeApi({ login: 401 }).fetch }),
    /Sign-in failed: 401/
  );
  await assert.rejects(
    seedSupportMessage(options, {
      nodeEnv: undefined,
      fetch: fakeApi({ send: [403, { ok: false, code: 'relationship_blocked' }] }).fetch
    }),
    /Sending failed: 403/
  );
});
