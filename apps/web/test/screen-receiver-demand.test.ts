import { test } from 'vitest';
import assert from 'node:assert/strict';


async function loadDemandPolicy() {
  return import('../src/lib/features/room/client/media/screen-receiver-demand.ts');
}

test('screen receiver demand is deterministic and stage wins over preview', async () => {
  const { getScreenReceiverDemand } = await loadDemandPolicy();
  const subscribed = new Set(['peer-a', 'peer-b']);

  assert.equal(getScreenReceiverDemand('', '', subscribed), 'hidden');
  assert.equal(getScreenReceiverDemand('peer-c', '', subscribed), 'hidden');
  assert.equal(getScreenReceiverDemand('peer-a', '', subscribed), 'preview');
  assert.equal(getScreenReceiverDemand('peer-a', 'peer-a', subscribed), 'stage');
  assert.equal(getScreenReceiverDemand('peer-b', 'peer-a', subscribed), 'preview');
});
