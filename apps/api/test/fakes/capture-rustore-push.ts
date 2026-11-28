// Preloaded into an API child process (`NODE_OPTIONS=--import=<this file>`)
// so an integration test can see the pushes the server sends to the Android
// app: each RuStore send is appended to RUSTORE_CAPTURE_FILE as one JSON line
// and answered as delivered. Every other request goes out unchanged.

import fs from 'node:fs';

const RUSTORE_ORIGIN = 'https://vkpns.rustore.ru/';
const captureFile = process.env.RUSTORE_CAPTURE_FILE ?? '';
const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!captureFile || !url.startsWith(RUSTORE_ORIGIN)) return realFetch(input, init);
  const body = typeof init?.body === 'string' ? init.body : '{}';
  fs.appendFileSync(captureFile, JSON.stringify(JSON.parse(body)) + '\n');
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
};
