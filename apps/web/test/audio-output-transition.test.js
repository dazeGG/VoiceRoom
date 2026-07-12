import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAudioOutputTransitionQueue,
  initializeAudioOutput,
  transitionAudioOutput
} from '../src/lib/features/room/client/services/audio-output-transition.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

test('audio output remains disconnected until custom sink selection succeeds', async () => {
  const selection = deferred();
  const events = [];
  const result = transitionAudioOutput({
    disconnect: () => events.push('disconnect'),
    select: () => {
      events.push('select');
      return selection.promise;
    },
    connect: () => events.push('connect')
  });

  await Promise.resolve();
  assert.deepEqual(events, ['disconnect', 'select']);
  selection.resolve();
  assert.equal(await result, true);
  assert.deepEqual(events, ['disconnect', 'select', 'connect']);
});

test('failed sink selection stays fail-closed', async () => {
  const events = [];
  const selected = await transitionAudioOutput({
    disconnect: () => events.push('disconnect'),
    select: async () => {
      events.push('select');
      throw new Error('missing sink');
    },
    connect: () => events.push('connect')
  });

  assert.equal(selected, false);
  assert.deepEqual(events, ['disconnect', 'select']);
});

test('sink transitions are serialized in request order', async () => {
  const first = deferred();
  const events = [];
  const enqueue = createAudioOutputTransitionQueue();
  const firstResult = enqueue(async () => {
    events.push('first:start');
    await first.promise;
    events.push('first:end');
    return true;
  });
  const secondResult = enqueue(async () => {
    events.push('second');
    return true;
  });

  await Promise.resolve();
  assert.deepEqual(events, ['first:start']);
  first.resolve();
  assert.equal(await firstResult, true);
  assert.equal(await secondResult, true);
  assert.deepEqual(events, ['first:start', 'first:end', 'second']);
});

test('failed initial custom sink never falls back to the default output', async () => {
  const requested = [];
  const selected = await initializeAudioOutput(async (sinkId) => {
    requested.push(sinkId);
    return false;
  }, 'custom-speaker');

  assert.equal(selected, false);
  assert.deepEqual(requested, ['custom-speaker']);
});
