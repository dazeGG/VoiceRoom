import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changedComponents, routeTrees } from '../ci/changed-components.mts';
import { measuredInputs, workspace, workspaceDirs } from '../ci/routing-inputs.mts';
import { selectTests, type TreeInputs } from '../ci/test-lanes.mts';
import { fixtureSpecs, FULL_SELECTION } from '../ci/verification-policy.mts';

// Synthetic manifests force traversal: ui-kit -> ui -> Widget; Web imports via call.
// Includes a dev-only edge; no installation or working tree files are evidence.
const workspaceFixture = [
  ['packages/ui-kit', []],
  ['packages/ui', ['ui-kit']],
  ['packages/call', ['ui']],
  ['packages/shared', []],
  ['apps/api', ['shared']],
  ['apps/web', ['call']],
  ['apps/admin', ['ui-kit']],
  ['apps/widget', ['ui']],
  ['apps/meet', ['call']],
  ['apps/site', ['ui']]
] as const;
const inventory = workspaceFixture.map(([dir, deps]) =>
  workspace(dir, {
    name: '@voiceroom/' + dir.slice(dir.indexOf('/') + 1),
    scripts: dir.startsWith('apps/') ? { test: 'test' } : {},
    devDependencies: Object.fromEntries(deps.map((dep) => ['@voiceroom/' + dep, '*']))
  })
);
const metadata: TreeInputs = {
  workspaces: inventory,
  measured: measuredInputs({
    businessPathPatterns: ['./apps/web//src/features/synthetic/measured.ts'],
    strictBranchPaths: ['apps/widget/src/dynamic-input.ts'],
    strictBranchGroups: [{ paths: [], pathPatterns: ['/extra-measured/'] }]
  })
};
function route(paths: string[], trees = [metadata, metadata]) {
  return selectTests(paths, trees, {
    ...changedComponents(paths),
    installer: paths.some((p) => p.startsWith('apps/get/'))
  });
}

test('independent UI leaves retain checks and run only their owning unit workspace', () => {
  assert.deepEqual(route(['apps/admin/src/users.ts']).selection, {
    lanes: ['check', 'check-lane', 'test-web'],
    workspaces: ['admin'],
    groups: []
  });
  const web = route(['apps/web/src/features/legal/terms.ts']).selection;
  assert.deepEqual(web.workspaces, ['web']);
  assert.ok(web.groups.includes('voice-core'));
  assert.ok(!web.lanes.includes('test'));
});

test('every API source selects the two producers, aggregate and G05 (no domain exclusions)', () => {
  const api = route(['apps/api/src/domains/rooms/service.ts']).selection;
  for (const lane of ['api-unit', 'api-integration', 'test', 'goal-g05']) assert.ok(api.lanes.includes(lane), lane);
  for (const group of ['voice-core', 'widget', 'personal']) assert.ok(api.groups.includes(group));
  assert.deepEqual(api.workspaces, []);
});

test('G08 path policy accepts exact paths, prefixes and group fragments', () => {
  for (const path of [
    'apps/web/src/features/synthetic/measured.ts',
    'apps/widget/src/dynamic-input.ts',
    'apps/admin/src/extra-measured/a.ts'
  ])
    assert.ok(route([path]).selection.lanes.includes('test'), path);
});

test('kit change reaches both chat and the embedding consumer through transitive manifest edges', () => {
  const kit = route(['packages/ui-kit/src/components/Message/Message.vue']).selection;
  assert.deepEqual(kit.workspaces, ['admin', 'meet', 'web', 'widget']);
  assert.ok(kit.lanes.includes('site'));
  for (const group of ['voice-chat', 'widget']) assert.ok(kit.groups.includes(group));
  assert.ok(!kit.lanes.includes('api-unit'));
});

test('a dependency present only in the base still reaches its consumer', () => {
  const tested = {
    ...metadata,
    workspaces: inventory.map((w) => (w.dir === 'apps/widget' ? { ...w, dependencies: [] } : w))
  };
  assert.ok(route(['packages/ui/src/tile-grid.ts'], [metadata, tested]).selection.workspaces.includes('widget'));
});

test('lock, migration, shared, manifest, fixture, deployment, CI and unknown changes select fixed full inventory', () => {
  for (const path of [
    'package-lock.json',
    'apps/api/src/db/migrations/foo.ts',
    'packages/shared/src/contracts.ts',
    'apps/admin/package.json',
    'apps/meet/tsconfig.json',
    'apps/web/e2e/fixtures/media.ts',
    'docker-compose.yml',
    '.github/workflows/ci.yml',
    'scripts/build.mts',
    'unowned/runtime.ts'
  ]) {
    const result = route([path]);
    assert.deepEqual(result.selection, FULL_SELECTION, path);
    assert.match(result.reason, /^ALL:/);
  }
});

test('changed tests retain their owner and correct fixture; portable runtime and installer retain Personal', () => {
  assert.deepEqual(route(['apps/admin/test/changed.test.ts']).selection.workspaces, ['admin']);
  for (const [path, group] of [
    ['apps/web/e2e/chat-drafts.spec.ts', 'voice-chat'],
    ['apps/web/e2e/widget-reconnect.spec.ts', 'widget'],
    ['apps/web/e2e/microphone-recovery.spec.ts', 'voice-call'],
    ['apps/web/e2e/mobile-room.spec.ts', 'voice-guest'],
    ['apps/meet/e2e/personal.spec.ts', 'personal'],
    ['packages/call/src/settings.ts', 'personal'],
    ['apps/get/install.sh', 'personal']
  ] as const)
    assert.ok(route([path]).selection.groups.includes(group), path);
  const original = route(['apps/web/e2e/chat-drafts.spec.ts']).selection;
  assert.deepEqual(original.groups, ['voice-chat', 'voice-core']);
  assert.ok(original.lanes.includes('voice-join') && !original.lanes.includes('voice-features'));
});

test('relative cross-workspace test imports retain Web on API log or Site download changes', () => {
  for (const path of [
    'apps/api/src/lib/client-log-intake.ts',
    'apps/site/src/scripts/download.ts',
    'apps/site/src/desktop-download.ts'
  ]) {
    assert.ok(route([path]).selection.workspaces.includes('web'), path);
  }
});

test('each new Voice journey runs on its feature and on a direct spec change, not on an Admin leaf', () => {
  const admin = route(['apps/admin/src/pages/UsersPage.vue']).selection;
  assert.ok(!admin.lanes.includes('voice-join') && !admin.lanes.includes('voice-features'));
  for (const [spec, feature] of [
    ['context-menu', 'apps/web/src/features/home/model/friend-menu.ts'],
    ['reactions', 'apps/api/src/domains/messaging/reaction.repository.ts'],
    ['room-delete', 'apps/web/src/features/room/components/RoomSettingsDialog.vue'],
    ['room-edit', 'apps/web/src/features/room/room-settings.store.ts'],
    ['room-realtime', 'apps/web/src/entities/room/room-realtime.ts'],
    ['localization', 'apps/web/src/shared/i18n/LanguageControl.vue'],
    ['desktop-root-boundary', 'apps/web/src/service-worker.ts'],
    ['mic-stall', 'packages/call/src/engine/services/microphone-service.ts']
  ] as const) {
    const specPath = 'e2e/' + spec + '.spec.ts';
    const group = 'voice-' + spec;
    const selected = route([feature]).selection;
    assert.ok(selected.lanes.includes('voice-features') && selected.lanes.includes('voice-join'), feature);
    assert.ok(fixtureSpecs('voice-features', selected.groups).includes(specPath), feature);
    assert.ok(!fixtureSpecs('voice', selected.groups).includes(specPath), feature);
    assert.ok(!admin.groups.includes(group));
    const direct = route(['apps/web/' + specPath]).selection;
    assert.deepEqual(direct.groups, ['voice-core', group].sort());
    assert.ok(direct.lanes.includes('voice-features') && direct.lanes.includes('voice-join'));
  }
  assert.ok(!route(['apps/web/src/features/home/model/friend-menu.ts']).selection.groups.includes('voice-mic-stall'));
  for (const path of [
    'apps/api/src/domains/admin/admin-stats.repository.ts',
    'apps/web/src/features/call-feedback/CallFeedbackCard.vue'
  ]) {
    const { groups, lanes } = route([path]).selection;
    assert.ok(groups.includes('voice-core'));
    assert.ok(!lanes.includes('voice-features'), path);
    assert.ok(!groups.includes('voice-reactions') && !groups.includes('voice-mic-stall'), path);
  }
});

test('audit inputs select the dedicated fixture; unrelated app leaves do not', () => {
  for (const path of [
    'packages/ui-kit/src/components/Dialog/Dialog.vue',
    'apps/site/src/styles/site.scss',
    'apps/web/src/styles/chat/_reaction-picker.scss',
    'apps/admin/src/shell/GlobalSearch.vue',
    'apps/web/src/entities/room/room-membership.store.ts',
    'apps/web/playwright.ui-audit.config.ts',
    'apps/web/ui-audit-e2e/focus.spec.ts',
    'apps/web/test/browser/SecurityCacheFixture.vue',
    'apps/admin/test/browser/vite.config.ts'
  ])
    assert.ok(route([path]).selection.lanes.includes('ui-audit'), path);
  assert.deepEqual(route(['apps/web/ui-audit-e2e/focus.spec.ts']).selection.groups, ['ui-audit']);
  for (const path of ['apps/web/src/features/legal/PrivacyPolicy.vue', 'apps/admin/src/users.ts'])
    assert.ok(!route([path]).selection.lanes.includes('ui-audit'), path);
});

test('rename/delete fan-out is shared with chat and voice, even in engine and chat directories', () => {
  for (const path of [
    'apps/web/src/features/room/use-room-chat-session.ts',
    'apps/web/src/entities/room/room-realtime.ts',
    'apps/web/src/features/room/adapters/web-call-transport.ts',
    'packages/call/src/engine/room/voice-events.ts',
    'packages/call/src/engine/room/lifecycle.ts'
  ]) {
    const specs = fixtureSpecs('voice-features', route([path]).selection.groups);
    for (const journey of ['room-realtime', 'reactions', 'mic-stall']) {
      assert.ok(specs.includes('e2e/' + journey + '.spec.ts'), path + ': ' + journey);
    }
  }
});

test('missing evidence, invalid metadata and unresolved workspace edges cannot narrow the selection', () => {
  const broken = {
    ...metadata,
    workspaces: [
      ...inventory,
      workspace('apps/cache', { name: '@voiceroom/cache', dependencies: { '@voiceroom/gone': '*' } })
    ]
  };
  for (const trees of [[], [metadata, broken]]) {
    assert.deepEqual(route(['apps/admin/src/users.ts'], trees).selection, FULL_SELECTION);
  }
  const empty = { ...metadata, workspaces: inventory.map((w) => ({ ...w, tests: false })) };
  assert.deepEqual(route(['apps/admin/src/users.ts'], [empty, empty]).selection, FULL_SELECTION);
  assert.deepEqual(workspaceDirs({ workspaces: ['apps/admin', 'packages/*'] }, ['packages/ui/package.json']), [
    'apps/admin',
    'packages/ui'
  ]);
  assert.throws(() => workspaceDirs({ workspaces: ['**'] }, []), /Unresolved/);
  assert.throws(
    () => workspace('apps/admin', { name: 'admin', dependencies: { kit: 'npm:@voiceroom/elsewhere@1' } }),
    /Unresolved/
  );
});

test('production chat and composer changes retain overlapping mobile and friend-call consumers', () => {
  for (const path of [
    'apps/web/src/features/room/components/RoomChatPanel.vue',
    'apps/web/src/features/home/components/lobby/dm/DmComposer.vue'
  ]) {
    const { groups } = route([path]).selection;
    for (const group of ['voice-core', 'voice-chat', 'voice-guest', 'voice-call'])
      assert.ok(groups.includes(group), path);
  }
});

test('local packages need no name prefix; mismatched file dependencies cannot be resolved by name alone', () => {
  const local = workspace('packages/ui-kit', { name: 'design' });
  const app = workspace('apps/admin', {
    name: '@voiceroom/admin',
    devDependencies: { design: 'file:../../packages/ui-kit' },
    scripts: { test: 'test' }
  });
  const tree = { ...metadata, workspaces: [local, app] };
  assert.deepEqual(route(['packages/ui-kit/src/tokens.ts'], [tree, tree]).selection.workspaces, ['admin']);
  const wrong = { ...tree, workspaces: [local, { ...app, localDirs: { design: 'packages/not-design' } }] };
  assert.deepEqual(route(['packages/ui-kit/src/tokens.ts'], [wrong, wrong]).selection, FULL_SELECTION);
});

test('exclusive production surfaces retain their journey; test helpers remain shared browser inputs', () => {
  for (const [path, groups] of [
    ['apps/web/src/features/legal/PrivacyPolicy.vue', ['voice-core']],
    ['apps/web/src/shared/chat/EmojiPickerPanel.vue', ['voice-chat', 'voice-core', 'voice-reactions']],
    ['apps/web/src/features/friend-call/FriendCallTiles.vue', ['voice-call', 'voice-core']],
    ['apps/web/src/features/room/components/MobileCallGrid.vue', ['voice-core', 'voice-guest']]
  ] as const)
    assert.deepEqual(route([path]).selection.groups, groups, path);
  assert.deepEqual(
    route(['apps/web/test/helpers/assert.ts']).selection.groups,
    FULL_SELECTION.groups.filter((group) => group.startsWith('voice-'))
  );
});

test('named unit tests run their owning workspace without starting browser fixtures', () => {
  for (const [name, file] of [
    ['web', 'features/embedded-room-document.test.ts'],
    ['admin', 'accounts.test.ts'],
    ['meet', 'guest-controller.test.ts'],
    ['widget', 'widget-loader.test.ts']
  ] as const) {
    assert.deepEqual(route([`apps/${name}/test/${file}`]).selection, {
      lanes: ['check', 'check-lane', 'test-web'],
      workspaces: [name],
      groups: []
    });
  }
  assert.deepEqual(route(['apps/site/test/desktop-download.test.ts']).selection, {
    lanes: ['site', 'static-publication'],
    workspaces: [],
    groups: []
  });
  assert.deepEqual(route(['apps/api/test/voice-call-lifecycle.test.ts']).selection, {
    lanes: ['api-integration', 'api-unit', 'check', 'check-lane', 'goal-g05', 'test'],
    workspaces: [],
    groups: []
  });
  assert.deepEqual(route(['packages/shared/test/widget.test.ts']).selection, FULL_SELECTION);
});

test('a unit test cannot add a browser group to its component change or mask one', () => {
  const component = 'apps/web/src/shared/chat/EmojiPickerPanel.vue';
  const unit = 'apps/web/test/composer-emoji.test.ts';
  assert.deepEqual(route([component, unit]).selection, route([component]).selection);
  assert.deepEqual(route([unit, component]).selection.groups, ['voice-chat', 'voice-core', 'voice-reactions']);
});

test('G08 follows transitive import, re-export and dynamic import edges, not neighbouring chat files', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'g08-routing-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const put = (file: string, content: string) => {
    const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], {
      cwd,
      input: content,
      encoding: 'utf8'
    }).trim();
    git('update-index', '--add', '--cacheinfo', '100644', blob, file);
  };
  git('init', '--quiet');
  const auth = 'apps/web/src/api/auth.ts';
  const runtime = 'apps/web/src/shared/i18n/runtime.ts';
  const catalog = 'apps/web/src/shared/i18n/catalog';
  const dirs = ['apps/web', 'apps/api', 'apps/admin', 'packages/ui-kit', 'packages/shared'];
  put('package.json', JSON.stringify({ workspaces: dirs }));
  for (const dir of dirs) {
    put(
      dir + '/package.json',
      JSON.stringify({
        name: '@voiceroom/' + dir.slice(dir.lastIndexOf('/') + 1),
        scripts: dir.startsWith('apps/') ? { test: 'test' } : {},
        ...(dir === 'apps/web' ? { dependencies: { '@voiceroom/ui-kit': '*', '@voiceroom/shared': '*' } } : {}),
        ...(dir === 'packages/ui-kit' ? { exports: { './i18n': './src/i18n.ts' } } : {})
      })
    );
  }
  put(
    'config/coverage/release-250-thresholds.json',
    JSON.stringify({
      businessPathPatterns: ['apps/api/src/', 'packages/shared/src/', auth],
      strictBranchGroups: []
    })
  );
  put(auth, "import { t } from '../shared/i18n/runtime.ts'; export default t;");
  put(runtime, "export { t } from './catalog'; import { locale } from '@voiceroom/ui-kit/i18n';");
  put(catalog + '/index.ts', "export const t = () => import('./Labels.vue');");
  put(catalog + '/Labels.vue', `<script setup lang="ts">import { labels } from './labels.js';</script>`);
  put(catalog + '/labels.js', "export const labels = ['hi'];");
  put('packages/ui-kit/src/i18n.ts', 'export const locale = "en";');
  const base = git('write-tree');
  const edit = (file: string, content: string) => {
    git('read-tree', base);
    put(file, content);
    return git('write-tree');
  };
  const api = (before: string, after: string) => {
    const { selection, reason } = routeTrees(before, after, cwd);
    assert.notDeepEqual(selection, FULL_SELECTION, reason);
    for (const id of ['api-unit', 'api-integration', 'test', 'goal-g05']) assert.ok(selection.lanes.includes(id), id);
  };
  api(base, edit('apps/api/src/domains/rooms/new-room.mts', 'export const limit = 4;'));
  assert.deepEqual(
    routeTrees(base, edit('packages/shared/src/room-limit.ts', 'export const limit = 4;'), cwd).selection,
    FULL_SELECTION
  );
  assert.deepEqual(routeTrees(base, edit('apps/admin/src/limit.ts', 'export const limit = 4;'), cwd).selection, {
    lanes: ['check', 'check-lane', 'test-web'],
    workspaces: ['admin'],
    groups: []
  });
  api(base, edit(catalog + '/labels.js', "export const labels = ['bye'];"));
  api(base, edit('packages/ui-kit/src/other.ts', 'export const other = 1;'));
  const chat = routeTrees(base, edit('apps/web/src/shared/chat/EmojiPickerPanel.vue', '<template/>'), cwd);
  assert.deepEqual(
    chat.selection.lanes,
    ['check', 'check-lane', 'test-web', 'voice-features', 'voice-join'],
    chat.reason
  );

  // Same specifier, new resolution: the added module takes precedence over
  // catalog/index.ts. Only the tested closure can select it; on deletion only the base can.
  const shadow = edit(catalog + '.ts', 'export const t = () => "changed";');
  api(base, shadow);
  api(shadow, base);
  const broken = edit(runtime, "export { t } from './not-found';");
  for (const [before, after] of [
    [base, broken],
    [broken, base]
  ] as const) {
    const fallback = routeTrees(before, after, cwd);
    assert.deepEqual(fallback.selection, FULL_SELECTION);
    assert.match(fallback.reason, /not-found/);
  }
});
