import { onTestFinished, test, vi } from 'vitest';
import assert from 'node:assert/strict';

class MemoryStorage {
  #values = new Map<string, string>();

  getItem(key: string) {
    return this.#values.has(key) ? this.#values.get(key) : null;
  }

  setItem(key: string, value: unknown) {
    this.#values.set(key, String(value));
  }
}

function binding(code: string) {
  return {
    altKey: false,
    code,
    ctrlKey: true,
    metaKey: false,
    shiftKey: true
  };
}

function registration(registered: string[], overrides: Record<string, unknown> = {}) {
  return {
    active: true,
    backend: 'native',
    failed: [],
    registered,
    unsupported: [],
    ...overrides
  };
}

type Deferred = { promise: Promise<unknown>; reject: (error: unknown) => void; resolve: (value: unknown) => void };

function deferred(): Deferred {
  let resolvePromise = (_value: unknown) => {};
  let rejectPromise = (_error: unknown) => {};
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, reject: rejectPromise, resolve: resolvePromise };
}

test('desktop hotkey sync buffers early events, prefers the latest status, and discards stale generations', async () => {
  const calls: Array<{ payload: { configurationId: string }; request: Deferred }> = [];
  const callAt = (index: number) => {
    const call = calls[index];
    assert.ok(call);
    return call;
  };
  const actionListeners = new Set<(event: unknown) => void>();
  const statusListeners = new Set<(status: unknown) => void>();
  const windowTarget = new EventTarget() as EventTarget & { voiceRoomDesktopHotkeys?: unknown };
  const storage = new MemoryStorage();
  const originalWarn = console.warn;
  let unbind = () => {};
  storage.setItem('voice-room:hotkey:output-mute', JSON.stringify(binding('KeyD')));
  storage.setItem('voice-room:hotkey:push-to-talk', JSON.stringify(binding('Space')));

  windowTarget.voiceRoomDesktopHotkeys = {
    configure(payload: { configurationId: string }) {
      const request = deferred();
      calls.push({ payload, request });
      return request.promise;
    },
    onAction(listener: (event: unknown) => void) {
      actionListeners.add(listener);
      return () => actionListeners.delete(listener);
    },
    onStatus(listener: (status: unknown) => void) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    setSuspended: async () => false
  };

  vi.stubGlobal('window', windowTarget);
  vi.stubGlobal('localStorage', storage);

  onTestFinished(() => {
    unbind();
    console.warn = originalWarn;
  });
  vi.resetModules();
  console.warn = () => {};

  const service = await import('../src/lib/features/room/client/services/desktop-hotkey-service.ts');
  const actions: unknown[] = [];
  const statuses: unknown[] = [];
  unbind = service.bindDesktopGlobalHotkeys(
    (action, phase) => actions.push({ action, phase }),
    (status) => statuses.push(status)
  );
  const firstSync = service.syncDesktopGlobalHotkeys(true);
  const firstConfigurationId = callAt(0).payload.configurationId;
  assert.equal(service.isDesktopGlobalHotkeyRegistered('mic-mute'), true);
  for (const listener of actionListeners) {
    listener({ action: 'mic-mute', configurationId: firstConfigurationId, phase: 'pressed' });
    listener({ action: 'push-to-talk', configurationId: firstConfigurationId, phase: 'pressed' });
    listener({ action: 'push-to-talk', configurationId: firstConfigurationId, phase: 'released' });
  }
  assert.equal(actions.length, 0);
  callAt(0).request.resolve(
    registration(['mic-mute', 'output-mute', 'push-to-talk'], {
      configurationId: firstConfigurationId
    })
  );
  await firstSync;
  assert.deepEqual(actions, [{ action: 'mic-mute', phase: 'pressed' }]);
  assert.equal(statuses.length, 1);

  const statusSync = service.syncDesktopGlobalHotkeys(true);
  const statusConfigurationId = callAt(1).payload.configurationId;
  const latestStatus = registration(['output-mute'], {
    backend: 'electron-fallback',
    configurationId: statusConfigurationId
  });
  for (const listener of statusListeners) listener(latestStatus);
  for (const listener of actionListeners) {
    listener({ action: 'output-mute', configurationId: statusConfigurationId, phase: 'pressed' });
    listener({ action: 'mic-mute', configurationId: statusConfigurationId, phase: 'pressed' });
  }
  callAt(1).request.resolve(
    registration(['mic-mute'], {
      configurationId: statusConfigurationId
    })
  );
  await statusSync;
  assert.equal(service.isDesktopGlobalHotkeyRegistered('mic-mute'), false);
  assert.equal(service.isDesktopGlobalHotkeyRegistered('output-mute'), true);
  assert.equal(statuses.at(-1), latestStatus);
  assert.equal(statuses.length, 2);
  assert.deepEqual(actions.at(-1), { action: 'output-mute', phase: 'pressed' });

  const staleSync = service.syncDesktopGlobalHotkeys(true);
  const staleConfigurationId = callAt(2).payload.configurationId;
  for (const listener of actionListeners) {
    listener({ action: 'mic-mute', configurationId: staleConfigurationId, phase: 'pressed' });
  }
  const currentSync = service.syncDesktopGlobalHotkeys(true);
  const currentConfigurationId = callAt(3).payload.configurationId;
  for (const listener of actionListeners) {
    listener({ action: 'mic-mute', configurationId: staleConfigurationId, phase: 'pressed' });
    listener({ action: 'output-mute', configurationId: currentConfigurationId, phase: 'released' });
  }
  callAt(2).request.resolve(
    registration(['mic-mute'], {
      configurationId: staleConfigurationId
    })
  );
  await staleSync;
  callAt(3).request.resolve(
    registration(['output-mute'], {
      configurationId: currentConfigurationId
    })
  );
  await currentSync;
  assert.deepEqual(actions.slice(-1), [{ action: 'output-mute', phase: 'released' }]);

  const failedSync = service.syncDesktopGlobalHotkeys(true);
  assert.equal(service.isDesktopGlobalHotkeyRegistered('mic-mute'), true);
  callAt(4).request.reject(new Error('renderer replaced'));
  assert.equal(await failedSync, null);
  assert.equal(service.isDesktopGlobalHotkeyRegistered('mic-mute'), false);
  assert.equal(service.isDesktopGlobalHotkeyRegistered('output-mute'), false);

  const inactiveSync = service.syncDesktopGlobalHotkeys(false);
  for (const listener of actionListeners) {
    listener({ action: 'mic-mute', phase: 'pressed' });
  }
  callAt(5).request.resolve(
    registration([], {
      active: false,
      backend: 'none',
      configurationId: callAt(5).payload.configurationId
    })
  );
  await inactiveSync;
  assert.equal(actions.length, 3);
});
