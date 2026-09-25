import { test } from 'vitest';
import { freshImport } from './helpers/fresh-module.ts';
import type * as PresenceIdle from '../src/lib/shared/presence-idle.ts';
import type { PresenceIdleSnapshot } from '../src/lib/shared/presence-idle.ts';

// A stand-in for the browser globals the idle tracker reads.
type IdleScope = Parameters<typeof PresenceIdle.hasGrantedBrowserIdlePermission>[0];
const asScope = (scope: object) => scope as IdleScope;
import assert from 'node:assert/strict';

async function loadPresenceIdle() {
  return freshImport<typeof PresenceIdle>('/src/lib/shared/presence-idle.ts');
}

test('automatic presence policy only restores idle-driven away', async () => {
  const { getAutomaticPresenceTransition, PRESENCE_ACTIVE_LEASE_SECONDS, PRESENCE_IDLE_THRESHOLD_SECONDS } =
    await loadPresenceIdle();

  assert.equal(PRESENCE_ACTIVE_LEASE_SECONDS, 3 * 60);

  assert.equal(
    getAutomaticPresenceTransition({
      idleSeconds: PRESENCE_IDLE_THRESHOLD_SECONDS,
      presenceStatus: 'online',
      presenceStatusAutomatic: false
    }),
    'away'
  );
  assert.equal(
    getAutomaticPresenceTransition({
      idleSeconds: 0,
      presenceStatus: 'away',
      presenceStatusAutomatic: true
    }),
    'online'
  );
  assert.equal(
    getAutomaticPresenceTransition({
      idleSeconds: 0,
      presenceStatus: 'away',
      presenceStatusAutomatic: false
    }),
    null
  );
  assert.equal(
    getAutomaticPresenceTransition({
      idleSeconds: -1,
      presenceStatus: 'away',
      presenceStatusAutomatic: true
    }),
    null
  );
  for (const presenceStatus of ['dnd', 'offline'] as const) {
    assert.equal(
      getAutomaticPresenceTransition({
        idleSeconds: PRESENCE_IDLE_THRESHOLD_SECONDS * 2,
        presenceStatus,
        presenceStatusAutomatic: false
      }),
      null
    );
  }
});

test('idle controller serializes transitions and converges after activity resumes', async () => {
  const { createPresenceIdleController, PRESENCE_ACTIVE_LEASE_SECONDS, PRESENCE_IDLE_THRESHOLD_SECONDS } =
    await loadPresenceIdle();
  let idleSeconds = PRESENCE_IDLE_THRESHOLD_SECONDS;
  const presence: PresenceIdleSnapshot = {
    loaded: true,
    presenceStatus: 'online',
    presenceStatusAutomatic: false
  };
  const updates: string[] = [];
  const controller = createPresenceIdleController({
    getIdleSeconds: async () => idleSeconds,
    getPresence: () => presence,
    updatePresence: async (status: PresenceIdleSnapshot['presenceStatus']) => {
      updates.push(status);
      presence.presenceStatus = status;
      presence.presenceStatusAutomatic = status === 'away';
    }
  });

  await Promise.all([controller.evaluate(), controller.evaluate(), controller.evaluate()]);
  assert.deepEqual(updates, ['away']);

  idleSeconds = 0;
  await controller.evaluate();
  assert.deepEqual(updates, ['away', 'online']);

  await controller.evaluate();
  assert.deepEqual(updates, ['away', 'online', 'online']);

  idleSeconds = PRESENCE_IDLE_THRESHOLD_SECONDS - PRESENCE_ACTIVE_LEASE_SECONDS;
  await controller.evaluate();
  assert.deepEqual(updates, ['away', 'online', 'online']);

  controller.stop();
  idleSeconds = PRESENCE_IDLE_THRESHOLD_SECONDS;
  await controller.evaluate();
  assert.deepEqual(updates, ['away', 'online', 'online']);
});

test('desktop idle reader fails closed when the bridge is absent or invalid', async () => {
  const { getDesktopIdleSecondsReader } = await loadPresenceIdle();

  assert.equal(getDesktopIdleSecondsReader({}), null);
  const invalidReader = getDesktopIdleSecondsReader({
    voiceRoomDesktopIdle: { getSystemIdleTime: async () => -1 }
  });
  assert.ok(invalidReader);
  assert.equal(await invalidReader(), null);
  const reader = getDesktopIdleSecondsReader({
    voiceRoomDesktopIdle: { getSystemIdleTime: async () => 301 }
  });
  assert.ok(reader);
  assert.equal(await reader(), 301);
});

test('desktop idle checks adapt to the remaining threshold and poll quickly only after automatic away', async () => {
  const { getNextPresenceIdleCheckDelayMs, PRESENCE_IDLE_THRESHOLD_SECONDS } = await loadPresenceIdle();

  assert.equal(
    getNextPresenceIdleCheckDelayMs({
      idleSeconds: 0,
      presenceStatus: 'online',
      presenceStatusAutomatic: false
    }),
    105_000
  );
  assert.equal(
    getNextPresenceIdleCheckDelayMs({
      idleSeconds: 105,
      presenceStatus: 'online',
      presenceStatusAutomatic: false
    }),
    (PRESENCE_IDLE_THRESHOLD_SECONDS - 105) * 1_000
  );
  assert.equal(
    getNextPresenceIdleCheckDelayMs({
      idleSeconds: PRESENCE_IDLE_THRESHOLD_SECONDS,
      presenceStatus: 'online',
      presenceStatusAutomatic: false
    }),
    5_000
  );
  assert.equal(
    getNextPresenceIdleCheckDelayMs({
      idleSeconds: PRESENCE_IDLE_THRESHOLD_SECONDS,
      presenceStatus: 'away',
      presenceStatusAutomatic: true
    }),
    5_000
  );
  assert.equal(
    getNextPresenceIdleCheckDelayMs({
      idleSeconds: 0,
      presenceStatus: 'away',
      presenceStatusAutomatic: false
    }),
    60_000
  );
});

test('browser idle tracking starts only for an already granted permission and never requests it', async () => {
  const { hasGrantedBrowserIdlePermission, startGrantedBrowserPresenceIdleTracking } = await loadPresenceIdle();
  const created: { detector?: FakeIdleDetector } = {};
  let queriedPermission = '';
  class FakeIdleDetector extends EventTarget {
    userState = 'active';
    screenState = 'unlocked';
    threshold = 0;

    constructor() {
      super();
      created.detector = this;
    }

    async start({ threshold }: { threshold: number }) {
      this.threshold = threshold;
    }
  }
  const scope = {
    IdleDetector: FakeIdleDetector,
    navigator: {
      permissions: {
        query: async ({ name }: { name: string }) => {
          queriedPermission = name;
          return { state: 'granted' };
        }
      }
    }
  };
  const presence: PresenceIdleSnapshot = {
    loaded: true,
    presenceStatus: 'online',
    presenceStatusAutomatic: false
  };
  const updates: string[] = [];
  const abortController = new AbortController();

  assert.equal(await hasGrantedBrowserIdlePermission(asScope(scope)), true);
  const stop = await startGrantedBrowserPresenceIdleTracking({
    scope: asScope(scope),
    signal: abortController.signal,
    getPresence: () => presence,
    updatePresence: async (status: PresenceIdleSnapshot['presenceStatus']) => {
      updates.push(status);
      presence.presenceStatus = status;
      presence.presenceStatusAutomatic = status === 'away';
    }
  });
  assert.equal(queriedPermission, 'idle-detection');
  assert.equal(typeof stop, 'function');
  const { detector } = created;
  assert.ok(detector);
  assert.equal(detector.threshold, 5 * 60 * 1_000);
  assert.equal(updates.length, 0);

  detector.userState = 'idle';
  detector.dispatchEvent(new Event('change'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(updates, ['away']);

  detector.userState = 'active';
  detector.dispatchEvent(new Event('change'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(updates, ['away', 'online']);

  stop?.();
  detector.userState = 'idle';
  detector.dispatchEvent(new Event('change'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(updates, ['away', 'online']);
});

test('browser idle tracking stays disabled for prompt, denied, unsupported, or failed permission checks', async () => {
  const { hasGrantedBrowserIdlePermission, startGrantedBrowserPresenceIdleTracking } = await loadPresenceIdle();
  class FakeIdleDetector extends EventTarget {
    userState = 'active';
    screenState = 'unlocked';
    async start() {}
  }
  for (const state of ['prompt', 'denied']) {
    const scope = {
      IdleDetector: FakeIdleDetector,
      navigator: { permissions: { query: async () => ({ state }) } }
    };
    assert.equal(await hasGrantedBrowserIdlePermission(asScope(scope)), false);
    assert.equal(
      await startGrantedBrowserPresenceIdleTracking({
        scope: asScope(scope),
        signal: new AbortController().signal,
        getPresence: () => ({
          loaded: true,
          presenceStatus: 'online',
          presenceStatusAutomatic: false
        }),
        updatePresence: async () => {}
      }),
      null
    );
  }
  assert.equal(await hasGrantedBrowserIdlePermission(asScope({})), false);
  assert.equal(
    await hasGrantedBrowserIdlePermission(
      asScope({
        IdleDetector: FakeIdleDetector,
        navigator: {
          permissions: {
            query: async () => {
              throw new Error('blocked');
            }
          }
        }
      })
    ),
    false
  );
});
