import assert from 'node:assert/strict';
import test from 'node:test';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { REPO_ROOT } from '../lib/glob.mts';

// Keep the repository's import rules, but synthetic source needs no TS project.
const eslint = new ESLint({ cwd: REPO_ROOT, overrideConfig: tseslint.configs.disableTypeChecked });
const clientRootPath = 'apps/web/src/features/room/client/main.ts';
const clientPaths = [clientRootPath, 'apps/web/src/features/room/client/room/room.ts'];
const lobbyPath = 'apps/web/src/features/room/voice-session.store.ts';
const aliases = [
  '@/features/auth',
  '@/features/auth/session.store',
  '@/api/auth',
  '@/features/call-feedback',
  '@/features/call-feedback/call-feedback.store',
  '@/stores/page.store',
  '@/platform/desktop-boundary',
  '@/platform/open-in-app',
  '@/platform/app-visibility',
  '@/features/room/adapters',
  '@/features/room/adapters/web-call-ports'
];
const relativeImports = [
  '../../auth',
  '../../auth/session.store',
  '../../../../api/auth',
  '../../call-feedback',
  '../../call-feedback/call-feedback.store',
  '../../../../stores/page.store',
  '../../../../platform/desktop-boundary',
  '../../../../platform/open-in-app',
  '../../../../platform/app-visibility',
  '../adapters',
  '../adapters/web-call-ports',
  '../../../../features/auth/session.store',
  '../../../../features/room/adapters/web-call-ports',
  '../../room/adapters/web-call-ports'
];
const forms = [
  { name: 'value imports', source: (target: string) => `import { value } from '${target}';` },
  { name: 'type imports', source: (target: string) => `import type { Value } from '${target}';` },
  { name: 're-exports', source: (target: string) => `export { value } from '${target}';` },
  { name: 'side effects', source: (target: string) => `import '${target}';` },
  { name: 'dynamic imports', source: (target: string) => `void import('${target}');` }
];

async function boundaryMessages(source: string, filePath: string) {
  const results = await eslint.lintText(source, { filePath });
  assert.equal(results.length, 1, filePath);
  const messages = results.flatMap((result) => result.messages);
  assert.deepEqual(
    messages.filter((message) => message.fatal),
    [],
    `${filePath}: ${source}`
  );
  return messages.filter(
    (message) => message.ruleId === 'no-restricted-imports' || message.ruleId === 'no-restricted-syntax'
  );
}

for (const form of forms) {
  test(`call client rejects forbidden alias and relative ${form.name} at both depths`, async () => {
    const rule = form.name === 'dynamic imports' ? 'no-restricted-syntax' : 'no-restricted-imports';
    for (const filePath of clientPaths) {
      for (const target of [...aliases, ...relativeImports]) {
        const messages = await boundaryMessages(form.source(target), filePath);
        assert.equal(messages.length, 1, `${filePath}: ${target}`);
        assert.equal(messages[0]?.ruleId, rule, `${filePath}: ${target}`);
      }
    }
  });
}

test('explicit .ts extensions do not bypass call import restrictions', async () => {
  for (const target of ['@/stores/page.store.ts', '../../../../platform/app-visibility.ts']) {
    for (const form of [forms[0], forms[4]]) {
      assert.ok(form);
      assert.equal((await boundaryMessages(form.source(target), clientRootPath)).length, 1, target);
    }
  }
});

test('voice session rejects feedback and adapter dependencies in every import form', async () => {
  const targets = [
    '@/features/call-feedback',
    '@/features/call-feedback/call-feedback.store',
    '../call-feedback/call-feedback.store',
    '@/features/room/adapters',
    '@/features/room/adapters/web-call-ports',
    './adapters/web-call-ports'
  ];
  for (const target of targets) {
    for (const form of forms) {
      assert.equal((await boundaryMessages(form.source(target), lobbyPath)).length, 1, target);
    }
  }
});

test('client accepts its ports, internal modules, shared contracts and residual transport dependencies', async () => {
  const targets = [
    './ports',
    '../core/session',
    '@/features/room/client/core/session',
    '@voice-room/shared',
    '@/api/realtime',
    '@/api/rooms',
    '@/entities/room/room-realtime',
    '@/runtime-config',
    '../net/api'
  ];
  for (const filePath of clientPaths) {
    for (const target of targets) {
      for (const form of forms) {
        assert.deepEqual(await boundaryMessages(form.source(target), filePath), [], `${filePath}: ${target}`);
      }
    }
  }
});

test('voice session accepts membership and the call ports', async () => {
  for (const target of ['@/entities/room/room-realtime', './client/ports', '@/features/auth/session.store']) {
    for (const form of forms) {
      assert.deepEqual(await boundaryMessages(form.source(target), lobbyPath), [], target);
    }
  }
});

test('client Vue scripts cannot bypass static or dynamic import restrictions', async () => {
  const filePath = 'apps/web/src/features/room/client/ui/PortFixture.vue';
  for (const target of [...aliases, ...relativeImports]) {
    for (const form of forms) {
      const source = `<script setup lang="ts">${form.source(target)}</script>`;
      assert.equal((await boundaryMessages(source, filePath)).length, 1, target);
    }
  }
});

test('similarly named modules are not mistaken for protected imports', async () => {
  for (const target of ['@/api/authentication', '@/platform/app-visibility-helper', '../adapters-other/example']) {
    for (const form of forms) {
      assert.deepEqual(await boundaryMessages(form.source(target), clientRootPath), [], target);
    }
  }
});

test('web adapters outside the client may import application dependencies', async () => {
  const filePath = 'apps/web/src/features/room/adapters/web-call-ports.ts';
  for (const target of [...aliases, ...relativeImports]) {
    for (const form of forms) {
      assert.deepEqual(await boundaryMessages(form.source(target), filePath), [], target);
    }
  }
});

test('the existing room-to-lobby restriction remains active inside narrower scopes', async () => {
  for (const filePath of [...clientPaths, lobbyPath]) {
    assert.equal((await boundaryMessages("import '@/features/home/rooms';", filePath)).length, 1, filePath);
  }
});
