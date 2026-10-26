import test from 'node:test';
import assert from 'node:assert/strict';
import { createRingDeliveryRuntime } from '../src/domains/rings/ring-delivery.ts';
import { fake } from './fakes/index.ts';
import type { RingService } from '../src/domains/rings/ring.service.ts';

test('Ring delivery runtime waits for the current batch on close and does not start when disabled', async () => {
  let release: () => void = () => {};
  let maintenance = 0,
    drained = 0;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const rings = fake<RingService>({
    maintenance: async () => {
      maintenance++;
      await pending;
    },
    drainOnce: async () => {
      drained++;
      return false;
    }
  });
  const errors: unknown[] = [];
  const runtime = createRingDeliveryRuntime({ rings, enabled: () => true, onError: (error) => errors.push(error) });
  runtime.start();
  runtime.start();
  assert.equal(maintenance, 1);
  let stopped = false;
  const stopping = runtime.stop().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  assert.equal(stopped, false);
  release();
  await stopping;
  assert.equal(drained, 0);
  assert.equal(errors.length, 0);
  const disabled = createRingDeliveryRuntime({ rings, enabled: () => false, onError: (error) => errors.push(error) });
  disabled.start();
  await disabled.stop();
  assert.equal(maintenance, 1);
});
