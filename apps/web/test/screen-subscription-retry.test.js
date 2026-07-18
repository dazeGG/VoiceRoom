import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const ts = require('typescript');

async function loadRetryController() {
  const path = 'src/lib/features/room/client/media/screen-subscription-retry.ts';
  const output = ts.transpileModule(readFileSync(resolve(root, path), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true
    },
    fileName: path
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

class FakeTimers {
  now = 0;
  nextId = 1;
  timers = new Map();

  set = (callback, delay) => {
    const id = this.nextId++;
    this.timers.set(id, { callback, dueAt: this.now + delay });
    return id;
  };

  clear = (id) => {
    this.timers.delete(id);
  };

  advance(milliseconds) {
    const target = this.now + milliseconds;
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.dueAt <= target)
        .sort((left, right) => left[1].dueAt - right[1].dueAt || left[0] - right[0])[0];
      if (!next) break;
      const [id, timer] = next;
      this.timers.delete(id);
      this.now = timer.dueAt;
      timer.callback();
    }
    this.now = target;
  }

  runAll() {
    for (let iteration = 0; this.timers.size && iteration < 20; iteration += 1) {
      const nextDueAt = Math.min(...[...this.timers.values()].map((timer) => timer.dueAt));
      this.advance(nextDueAt - this.now);
    }
    assert.equal(this.timers.size, 0, 'retry timers must converge');
  }
}

function target(overrides = {}) {
  const state = {
    attached: false,
    current: true,
    demanded: true,
    retries: 0,
    ...overrides
  };
  return {
    state,
    target: {
      isAttached: () => state.attached,
      isCurrent: () => state.current,
      isDemanded: () => state.demanded,
      key: 'screen-track',
      retry: () => { state.retries += 1; }
    }
  };
}

test('screen subscription retry is bounded to three attempts', async () => {
  const { createScreenSubscriptionRetryController } = await loadRetryController();
  const timers = new FakeTimers();
  const controller = createScreenSubscriptionRetryController({
    clearTimer: timers.clear,
    setTimer: timers.set
  });
  const retryTarget = target();

  controller.schedule(retryTarget.target);
  timers.runAll();

  assert.equal(retryTarget.state.retries, 3);
  assert.equal(controller.getAttempts('screen-track'), 3);
  controller.schedule(retryTarget.target);
  assert.equal(timers.timers.size, 0);
});

test('screen subscription retry cancels stale or hidden demand and resets exhaustion', async () => {
  const { createScreenSubscriptionRetryController } = await loadRetryController();
  const timers = new FakeTimers();
  const controller = createScreenSubscriptionRetryController({
    clearTimer: timers.clear,
    setTimer: timers.set
  });
  const retryTarget = target();

  controller.schedule(retryTarget.target);
  timers.advance(150);
  assert.equal(retryTarget.state.retries, 1);
  retryTarget.state.demanded = false;
  timers.advance(600);
  assert.equal(controller.getAttempts('screen-track'), 0);

  retryTarget.state.demanded = true;
  retryTarget.state.attached = true;
  controller.schedule(retryTarget.target);
  timers.advance(150);
  assert.equal(retryTarget.state.retries, 1, 'a live existing track reattaches without another toggle');

  retryTarget.state.attached = false;
  retryTarget.state.current = false;
  controller.schedule(retryTarget.target);
  assert.equal(timers.timers.size, 0, 'stale publications do not schedule work');
});

test('screen subscription retry accepts success only after a live attach', async () => {
  const { createScreenSubscriptionRetryController } = await loadRetryController();
  const timers = new FakeTimers();
  const controller = createScreenSubscriptionRetryController({
    clearTimer: timers.clear,
    setTimer: timers.set
  });
  const retryTarget = target();

  controller.schedule(retryTarget.target);
  timers.advance(150);
  assert.equal(retryTarget.state.retries, 1);
  retryTarget.state.attached = true;
  timers.advance(600);
  timers.runAll();

  assert.equal(retryTarget.state.retries, 1);
  assert.equal(controller.getAttempts('screen-track'), 0);
});

test('screen subscription retry starts a fresh bounded epoch after reconnect reset', async () => {
  const { createScreenSubscriptionRetryController } = await loadRetryController();
  const timers = new FakeTimers();
  const controller = createScreenSubscriptionRetryController({
    clearTimer: timers.clear,
    setTimer: timers.set
  });
  const retryTarget = target();

  controller.schedule(retryTarget.target);
  timers.runAll();
  assert.equal(retryTarget.state.retries, 3);
  assert.equal(controller.getAttempts('screen-track'), 3);

  controller.clearAll();
  controller.schedule(retryTarget.target);
  timers.runAll();

  assert.equal(retryTarget.state.retries, 6);
  assert.equal(controller.getAttempts('screen-track'), 3);
});

test('screen subscription retry coalesces synchronous failure re-entry', async () => {
  const { createScreenSubscriptionRetryController } = await loadRetryController();
  const timers = new FakeTimers();
  const controller = createScreenSubscriptionRetryController({
    clearTimer: timers.clear,
    setTimer: timers.set
  });
  const retryTarget = target();
  retryTarget.target.retry = () => {
    retryTarget.state.retries += 1;
    controller.schedule(retryTarget.target);
  };

  controller.schedule(retryTarget.target);
  timers.runAll();

  assert.equal(retryTarget.state.retries, 3);
  assert.equal(controller.getAttempts('screen-track'), 3);
});
