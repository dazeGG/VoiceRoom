import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changedComponents, lockVersionComponent, manifestVersionOnly } from '../ci/changed-components.mts';

const app = { app: true, site: false, docs: false };
const site = { app: false, site: true, docs: false };
const docs = { app: false, site: false, docs: true };
const appAndSite = { app: true, site: true, docs: false };
const everyLane = { app: true, site: true, docs: true };

test('routes application, public site and documentation changes independently', () => {
  assert.deepEqual(
    changedComponents(['apps/api/src/server.ts', 'apps/web/src/main.ts', 'apps/admin/src/main.tsx']),
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
  assert.deepEqual(changedComponents(['.github/workflows/release.yml', 'Dockerfile']), app);
});

test('routes UI package changes to the web and site checks', () => {
  assert.deepEqual(changedComponents(['packages/ui/package.json']), appAndSite);
  assert.deepEqual(changedComponents(['packages/ui/src/styles/_tokens.scss']), appAndSite);
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
  const lock = (siteVersion: string, appVersion = '2.13.0', astroVersion = '7.4.2') =>
    JSON.stringify({
      lockfileVersion: 3,
      version: appVersion,
      packages: {
        '': { version: appVersion },
        'apps/web': { version: appVersion },
        'apps/admin': { version: appVersion },
        'apps/api': { version: appVersion },
        'packages/shared': { version: appVersion },
        'packages/call': { version: appVersion },
        'apps/site': { name: '@voice-room/site', version: siteVersion, devDependencies: { astro: astroVersion } },
        'node_modules/astro': { version: astroVersion }
      }
    });
  const before = lock('1.0.0');
  assert.equal(lockVersionComponent(before, lock('1.0.1')), 'site');
  assert.equal(lockVersionComponent(before, lock('1.0.0', '2.13.1')), 'app');
  assert.equal(lockVersionComponent(before, lock('1.0.1', '2.13.1')), undefined);
  assert.equal(lockVersionComponent(before, lock('1.0.1', '2.13.0', '7.4.3')), undefined);
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
