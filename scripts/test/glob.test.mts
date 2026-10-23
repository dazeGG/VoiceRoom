import assert from 'node:assert/strict';
import test from 'node:test';
import { globToRegExp } from '../lib/glob.mts';

test('{a,b} matches either part and nothing else', () => {
  const glob = globToRegExp('apps/api/src/**/*.{js,ts}');
  assert.ok(glob.test('apps/api/src/server.ts'));
  assert.ok(glob.test('apps/api/src/lib/listen.js'));
  assert.equal(glob.test('apps/api/src/lib/listen.mts'), false);
  assert.equal(glob.test('apps/api/src/lib/listen.tsx'), false);
});

test('* stays inside one directory and ** crosses them', () => {
  assert.ok(globToRegExp('apps/api/src/*.ts').test('apps/api/src/server.ts'));
  assert.equal(globToRegExp('apps/api/src/*.ts').test('apps/api/src/lib/listen.ts'), false);
  assert.ok(globToRegExp('apps/api/src/**/*.ts').test('apps/api/src/domains/rooms/rooms.routes.ts'));
});

test('a glob matches at the end of an absolute path and treats dots literally', () => {
  assert.ok(globToRegExp('apps/api/src/server.ts').test('/tmp/fixture/apps/api/src/server.ts'));
  assert.equal(globToRegExp('apps/api/src/server.ts').test('apps/api/src/serverxts'), false);
  assert.equal(globToRegExp('apps/api/src/server.ts').test('apps/api/src/myserver.ts'), false);
});
