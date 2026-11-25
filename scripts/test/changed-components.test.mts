import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { FULL_SELECTION } from '../ci/verification-policy.mts';
import { test } from 'node:test';
import {
  changedComponents,
  lockVersionComponent,
  manifestVersionOnly,
  routeTrees,
  routingBase
} from '../ci/changed-components.mts';

const app = { app: true, site: false, docs: false };
const site = { app: false, site: true, docs: false };
const docs = { app: false, site: false, docs: true };
const appAndSite = { app: true, site: true, docs: false };
const everyLane = { app: true, site: true, docs: true };

test('routes application, public site and documentation changes independently', () => {
  assert.deepEqual(
    changedComponents(['apps/api/src/server.ts', 'apps/web/src/main.ts', 'apps/admin/src/main.ts']),
    app
  );
  assert.deepEqual(changedComponents(['apps/meet/src/main.ts']), app);
  assert.deepEqual(changedComponents(['apps/widget/src/main.ts']), app);
  assert.deepEqual(changedComponents(['apps/site/src/pages/index.astro']), site);
  assert.deepEqual(changedComponents(['apps/docs/src/content/docs/index.md', 'apps/docs/package-lock.json']), docs);
  assert.deepEqual(changedComponents(['apps/site/public/image.png', 'apps/docs/astro.config.mjs']), {
    app: false,
    site: true,
    docs: true
  });
  assert.deepEqual(changedComponents(['docs/GIT_FLOW.md', 'README.md']), { app: false, site: false, docs: false });
});

test('routes shared dependencies and validation files to their consumers', () => {
  assert.deepEqual(changedComponents(['packages/shared/src/app-home.ts']), appAndSite);
  assert.deepEqual(changedComponents(['packages/shared/package.json']), appAndSite);
  assert.deepEqual(changedComponents(['scripts/check-type-coverage.mts']), appAndSite);
  assert.deepEqual(changedComponents(['scripts/test/web-text-contrast.test.mts']), appAndSite);
  assert.deepEqual(changedComponents(['.github/workflows/ci.yml']), everyLane);
  assert.deepEqual(changedComponents(['.nvmrc']), appAndSite);
  assert.deepEqual(changedComponents(['apps/docs/.nvmrc']), docs);
  assert.deepEqual(changedComponents(['scripts/cd/publish-static.sh']), everyLane);
  assert.deepEqual(changedComponents(['scripts/test/static-publication.sh']), everyLane);
  assert.deepEqual(changedComponents(['.github/workflows/build-static.yml']), { ...site, docs: true });
  assert.deepEqual(changedComponents(['.github/workflows/release-api.yml', 'Dockerfile']), app);
});

test('routes UI package changes to the web and site checks', () => {
  assert.deepEqual(changedComponents(['packages/ui/package.json']), appAndSite);
  assert.deepEqual(changedComponents(['packages/ui-kit/package.json']), appAndSite);
  assert.deepEqual(changedComponents(['packages/ui-kit/src/styles/_tokens.scss']), appAndSite);
  assert.deepEqual(changedComponents(['packages/ui-kit/.storybook/main.ts']), appAndSite);
  assert.deepEqual(changedComponents(['packages/ui/src/tile-grid.ts']), appAndSite);
});

test('routes the call package to the application checks and voice and widget e2e lanes', () => {
  for (const path of [
    'packages/call/package.json',
    'packages/call/src/engine/index.ts',
    'packages/call/src/views/CallStage.vue',
    'packages/call/assets/rnnoise/rnnoise.wasm'
  ]) {
    assert.deepEqual(changedComponents([path]), app);
  }
});

test('manifest and lock version bumps stay in their release lane', () => {
  const lock = (siteVersion: string, appVersion = '1.0.0', astroVersion = '7.4.2', widgetVersion = appVersion) =>
    JSON.stringify({
      lockfileVersion: 3,
      version: appVersion,
      packages: {
        '': { version: appVersion },
        'apps/web': { version: appVersion },
        'apps/admin': { version: appVersion },
        'apps/api': { version: appVersion },
        'apps/meet': { version: appVersion },
        'apps/widget': { version: widgetVersion },
        'packages/shared': { version: appVersion },
        'packages/call': { version: appVersion },
        'packages/ui': { version: appVersion },
        'packages/ui-kit': { version: appVersion },
        'apps/site': { name: '@voiceroom/site', version: siteVersion, devDependencies: { astro: astroVersion } },
        'node_modules/astro': { version: astroVersion }
      }
    });
  const before = lock('1.0.0');
  assert.equal(lockVersionComponent(before, lock('1.0.1')), 'site');
  assert.equal(lockVersionComponent(before, lock('1.0.0', '1.0.1')), 'app');
  assert.equal(lockVersionComponent(before, lock('1.0.0', '1.0.0', '7.4.2', '1.0.1')), 'app');
  assert.equal(lockVersionComponent(before, lock('1.0.1', '1.0.1')), undefined);
  assert.equal(lockVersionComponent(before, lock('1.0.1', '1.0.0', '7.4.3')), undefined);
  assert.equal(lockVersionComponent(before, before), undefined);
  assert.equal(lockVersionComponent(before, '{}'), undefined);
  assert.equal(lockVersionComponent('broken json', lock('1.0.1')), undefined);
  assert.equal(manifestVersionOnly('{"version":"2.13.0"}', '{"version":"2.13.1"}'), true);
  assert.equal(manifestVersionOnly('{"version":"2.13.0"}', '{"version":"2.13.1","devDependencies":{}}'), false);
  assert.deepEqual(changedComponents(['apps/site/package.json', 'package-lock.json'], { lock: 'site' }), site);
  const appManifests = ['package.json', 'packages/shared/package.json'];
  assert.deepEqual(
    changedComponents([...appManifests, 'apps/api/package.json', 'apps/web/package.json', 'package-lock.json'], {
      appManifests,
      lock: 'app'
    }),
    app
  );
  assert.deepEqual(changedComponents(['package-lock.json']), appAndSite);
});

test('tree routing observes both sides of rename/deletion and handles a missing base separately from publication intent', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'routing-trees-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const put = (name: string, value: string) => {
    mkdirSync(dirname(join(cwd, name)), { recursive: true });
    writeFileSync(join(cwd, name), value);
  };
  git('init', '--quiet');
  put('package.json', JSON.stringify({ workspaces: ['apps/admin', 'apps/web', 'packages/*'] }));
  for (const dir of ['apps/admin', 'apps/web', 'packages/ui'])
    put(
      dir + '/package.json',
      JSON.stringify({
        name: '@voiceroom/' + dir.slice(dir.indexOf('/') + 1),
        scripts: dir.startsWith('apps/') ? { test: 'test' } : {}
      })
    );
  put(
    'config/coverage/release-250-thresholds.json',
    JSON.stringify({ businessPathPatterns: ['apps/api/src/'], strictBranchGroups: [] })
  );
  put('apps/admin/src/a space.ts', 'same content');
  put('apps/web/src/stay.ts', 'not moved');
  git('add', '.');
  const base = git('write-tree');
  renameSync(join(cwd, 'apps/admin/src/a space.ts'), join(cwd, 'apps/web/src/a space.ts'));
  git('add', '-A');
  const tested = git('write-tree');
  const moved = routeTrees(base, tested, cwd);
  assert.deepEqual(moved.selection.workspaces, ['admin', 'web']);
  assert.equal(moved.site, false);
  assert.deepEqual(routeTrees(tested, base, cwd).selection, moved.selection);
  for (const missing of ['', 'f'.repeat(40), '0'.repeat(40)]) {
    const result = routeTrees(missing, tested, cwd);
    assert.deepEqual(result.selection, FULL_SELECTION);
    assert.match(result.reason, /missing base/);
    assert.equal(result.site, missing === '0'.repeat(40));
  }
  put('unowned input', 'unknown');
  git('add', '.');
  const unknown = routeTrees(tested, git('write-tree'), cwd);
  assert.deepEqual(unknown.selection, FULL_SELECTION);
  assert.deepEqual([unknown.app, unknown.site, unknown.docs, unknown.installer], [true, false, false, false]);
  put('packages/new-suite/package.json', JSON.stringify({ name: 'new-suite', scripts: { test: 'node --test' } }));
  git('add', '.');
  assert.throws(() => routeTrees(tested, git('write-tree'), cwd), /ALL cannot execute unassigned test workspace/);
});

test('a stale PR payload base routes against the tested merge first parent; a non-merge or wrong head is not proof', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'routing-parents-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args], {
      cwd,
      encoding: 'utf8'
    }).trim();
  git('init', '--quiet');
  const tree = git('write-tree');
  const base = git('commit-tree', tree, '-m', 'original base');
  const head = git('commit-tree', tree, '-p', base, '-m', 'head');
  const current = git('commit-tree', tree, '-p', base, '-m', 'new base');
  const merge = git('commit-tree', tree, '-p', current, '-p', head, '-m', 'test merge');
  git('update-ref', 'HEAD', merge);
  assert.equal(routingBase(base, merge, head, cwd), current);
  assert.equal(routingBase(base, merge, undefined, cwd), base);
  for (const missing of ['', 'f'.repeat(40)]) {
    const unknown = routingBase(missing, merge, head, cwd);
    assert.equal(unknown, '');
    assert.deepEqual(routeTrees(unknown, merge, cwd).selection, FULL_SELECTION);
  }
  assert.throws(() => routingBase(base, merge, current, cwd), /parents/);
  assert.throws(() => routingBase(head, merge, head, cwd)); // payload is not a base ancestor
  git('update-ref', 'HEAD', head);
  assert.throws(() => routingBase(base, merge, head, cwd), /checkout/);
  assert.throws(() => routingBase(base, head, head, cwd), /parents/);
});

test("this repository's own tree routes: every workspace with tests has a step in the full policy", () => {
  const root = join(import.meta.dirname, '../..');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const route = routeTrees(head, head, root);
  assert.deepEqual(route.selection.workspaces, []);
  assert.ok(FULL_SELECTION.workspaces.includes('call') && FULL_SELECTION.workspaces.includes('ui-kit'));
});
