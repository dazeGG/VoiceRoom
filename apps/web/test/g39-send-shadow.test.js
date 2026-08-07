import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMessagingModule } from './messaging-module-loader.js';

test('G39-A01 retry and reordered realtime converge to one canonical row', async () => {
  const { createSendShadowStore } = await loadMessagingModule(new URL('../src/lib/shared/chat/send-shadow.svelte.ts', import.meta.url));
  const store = createSendShadowStore();
  const first = store.begin({ body: 'hello' }); const retry = store.begin({ body: 'hello' }); assert.equal(first.draftKey, retry.draftKey);
  store.reconcileRealtime({ id: 'canonical', body: 'hello' }, first.draftKey); store.confirm(first.draftKey, { id: 'canonical', body: 'hello' });
  assert.equal(store.items.length, 1); assert.equal(store.items[0].canonicalId, 'canonical');
});

test('G39-A02 fingerprint changes create a new bounded shadow identity', async () => {
  const { createSendShadowStore } = await loadMessagingModule(new URL('../src/lib/shared/chat/send-shadow.svelte.ts', import.meta.url));
  const store = createSendShadowStore(); const first = store.begin({ body: 'a' }); const second = store.begin({ body: 'b' });
  assert.notEqual(first.draftKey, second.draftKey); assert.notEqual(first.fingerprint, second.fingerprint);
});
