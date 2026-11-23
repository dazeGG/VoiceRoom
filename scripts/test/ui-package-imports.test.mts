import assert from 'node:assert/strict';
import test from 'node:test';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { REPO_ROOT } from '../lib/glob.mts';

const eslint = new ESLint({ cwd: REPO_ROOT, overrideConfig: tseslint.configs.disableTypeChecked });
const tsPath = 'packages/ui/src/utils/fixture.ts';
const vuePath = 'packages/ui-kit/src/components/fixtures/Fixture.vue';
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

for (const [filePath, relativePath] of [
  [tsPath, '../../../../apps/web/src/shared/log.ts'],
  [vuePath, '../../../../../apps/site/src/site.ts']
] as const) {
  test(`${filePath} rejects app dependencies in each import form`, async () => {
    for (const target of ['@/shared/log', relativePath, '/repo/apps/admin/src/main.ts', '@voiceroom/api']) {
      for (const form of forms) {
        const source = form.source(target);
        assert.deepEqual(await boundaryRuleIds(filePath, source), [form.rule], source);
      }
    }
  });

  test(`${filePath} accepts internal modules and package exports`, async () => {
    for (const target of ['./local', '../utils/tile-grid.ts', 'vue', 'pinia', '@voiceroom/shared/contracts/rooms']) {
      for (const form of forms) {
        const source = form.source(target);
        assert.deepEqual(await boundaryRuleIds(filePath, source), [], source);
      }
    }
  });
}
