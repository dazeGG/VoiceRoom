import assert from 'node:assert/strict';
import test from 'node:test';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { REPO_ROOT } from '../lib/glob.mts';

// Keep the repository's import rules, but synthetic source needs no TS project.
const eslint = new ESLint({ cwd: REPO_ROOT, overrideConfig: tseslint.configs.disableTypeChecked });
const forms = [
  { rule: 'no-restricted-imports', source: (target: string) => `import { value } from '${target}';` },
  { rule: 'no-restricted-imports', source: (target: string) => `import type { Value } from '${target}';` },
  { rule: 'no-restricted-imports', source: (target: string) => `export { value } from '${target}';` },
  { rule: 'no-restricted-imports', source: (target: string) => `import '${target}';` },
  { rule: 'no-restricted-syntax', source: (target: string) => `void import('${target}');` },
  { rule: 'no-restricted-syntax', source: (target: string) => `void import(\`${target}\`);` },
  { rule: 'no-restricted-syntax', source: (target: string) => `type Fixture = import('${target}').Fixture;` }
];

async function boundaryRuleIds(filePath: string, source: string) {
  const code = filePath.endsWith('.vue') ? `<script setup lang="ts">${source}</script>` : source;
  const results = await eslint.lintText(code, { filePath });
  assert.equal(results.length, 1, filePath);
  const messages = results.flatMap((result) => result.messages);
  assert.deepEqual(
    messages.filter((message) => message.fatal),
    [],
    `${filePath}: ${source}`
  );
  return messages
    .map((message) => message.ruleId)
    .filter((id) => id === 'no-restricted-imports' || id === 'no-restricted-syntax');
}

const webAliases = [
  '@/api/realtime',
  '@/api/rooms',
  '@/entities/room/room-realtime',
  '@/features/auth/session.store',
  '@/features/call-feedback/call-feedback.store',
  '@/features/room/adapters/web-call-ports',
  '@/platform/app-visibility',
  '@/platform/desktop-boundary',
  '@/platform/open-in-app',
  '@/runtime-config',
  '@/stores/page.store.ts'
];

for (const [filePath, relativePath] of [
  ['packages/call/src/engine/main.ts', '../../../../apps/web/src/api/rooms.ts'],
  ['packages/call/src/engine/core/voice-session.store.ts', '../../../../../apps/web/src/features/call-feedback'],
  ['packages/call/src/engine/services/livekit/Fixture.ts', '../../../../../../apps/api/src/server.ts'],
  ['packages/call/src/views/fixtures/Fixture.vue', '../../../../../apps/site/src/site.ts']
] as const) {
  test(`${filePath} rejects app paths in every import form`, async () => {
    const targets = [...webAliases, relativePath, '/repo/apps/admin/src/main.ts', '@voiceroom/web/src/main'];
    for (const target of targets) {
      for (const form of forms) {
        const source = form.source(target);
        assert.deepEqual(await boundaryRuleIds(filePath, source), [form.rule], source);
      }
    }
  });

  test(`${filePath} accepts portable modules and package exports`, async () => {
    const targets = [
      './local',
      '../room/room.ts',
      '../adapters/local',
      'vue',
      'pinia',
      '@voiceroom/shared/contracts/rooms',
      '@voiceroom/ui-kit/components'
    ];
    for (const target of targets) {
      for (const form of forms) {
        const source = form.source(target);
        assert.deepEqual(await boundaryRuleIds(filePath, source), [], source);
      }
    }
  });
}

test('web call adapters may import host dependencies and call ports', async () => {
  const filePath = 'apps/web/src/features/room/adapters/web-call-ports.ts';
  const harness = 'packages/call/test/jsdom/fixture.test.ts';
  for (const form of forms) {
    for (const target of [
      '@/shared/log',
      '../../../../apps/web/test/helpers/fresh-module',
      '../../../../apps/api/src/lib/client-log-intake.ts'
    ])
      assert.deepEqual(await boundaryRuleIds(harness, form.source(target)), []);
    for (const target of [
      '../../../../apps/web/src/shared/log.ts',
      '../../../../apps/api/src/lib/config.ts',
      '@voiceroom/admin'
    ])
      assert.deepEqual(await boundaryRuleIds(harness, form.source(target)), [form.rule]);
  }
  for (const target of [...webAliases, '@voiceroom/call/engine/ports']) {
    for (const form of forms) {
      const source = form.source(target);
      assert.deepEqual(await boundaryRuleIds(filePath, source), [], source);
    }
  }
});

test('web lobby uses the public call engine index', async () => {
  const filePath = 'apps/web/src/features/home/Fixture.ts';
  assert.deepEqual(await boundaryRuleIds(filePath, "import '@voiceroom/call/engine';"), []);
  assert.deepEqual(await boundaryRuleIds(filePath, "import '@voiceroom/call/engine/core/state';"), [
    'no-restricted-imports'
  ]);
});
