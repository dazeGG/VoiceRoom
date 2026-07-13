import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

async function loadPresenceIdle() {
  const source = readFileSync(new URL('../src/lib/shared/presence-idle.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true
    },
    fileName: 'presence-idle.ts'
  }).outputText;
  const dir = mkdtempSync(join(tmpdir(), 'voice-room-presence-idle-'));
  const file = join(dir, 'presence-idle.mjs');
  writeFileSync(file, output);
  try {
    return await import(`${pathToFileURL(file).href}?v=${Date.now()}-${Math.random()}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('automatic presence policy only restores idle-driven away', async () => {
  const {
    getAutomaticPresenceTransition,
    PRESENCE_ACTIVE_LEASE_SECONDS,
    PRESENCE_IDLE_THRESHOLD_SECONDS
  } = await loadPresenceIdle();

  assert.equal(PRESENCE_ACTIVE_LEASE_SECONDS, 3 * 60);

  assert.equal(getAutomaticPresenceTransition({
    idleSeconds: PRESENCE_IDLE_THRESHOLD_SECONDS,
    presenceStatus: 'online',
    presenceStatusAutomatic: false
  }), 'away');
  assert.equal(getAutomaticPresenceTransition({
    idleSeconds: 0,
    presenceStatus: 'away',
    presenceStatusAutomatic: true
  }), 'online');
  assert.equal(getAutomaticPresenceTransition({
    idleSeconds: 0,
    presenceStatus: 'away',
    presenceStatusAutomatic: false
  }), null);
  assert.equal(getAutomaticPresenceTransition({
    idleSeconds: -1,
    presenceStatus: 'away',
    presenceStatusAutomatic: true
  }), null);
  for (const presenceStatus of ['dnd', 'offline']) {
    assert.equal(getAutomaticPresenceTransition({
      idleSeconds: PRESENCE_IDLE_THRESHOLD_SECONDS * 2,
      presenceStatus,
      presenceStatusAutomatic: false
    }), null);
  }
});

test('idle controller serializes transitions and converges after activity resumes', async () => {
  const {
    createPresenceIdleController,
    PRESENCE_ACTIVE_LEASE_SECONDS,
    PRESENCE_IDLE_THRESHOLD_SECONDS
  } = await loadPresenceIdle();
  let idleSeconds = PRESENCE_IDLE_THRESHOLD_SECONDS;
  const presence = {
    loaded: true,
    presenceStatus: 'online',
    presenceStatusAutomatic: false
  };
  const updates = [];
  const controller = createPresenceIdleController({
    getIdleSeconds: async () => idleSeconds,
    getPresence: () => presence,
    updatePresence: async (status) => {
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
  assert.equal(await invalidReader(), null);
  const reader = getDesktopIdleSecondsReader({
    voiceRoomDesktopIdle: { getSystemIdleTime: async () => 301 }
  });
  assert.equal(await reader(), 301);
});
