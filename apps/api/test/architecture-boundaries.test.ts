import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

async function loadScanners() {
  const [imports, sources] = await Promise.all([
    import('../../../scripts/import-boundary.mts'),
    import('../../../scripts/check-api-sources.mts')
  ]);
  return { checkImportBoundaries: imports.checkImportBoundaries, checkApiSources: sources.checkApiSources };
}

function config() {
  return JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, '../../../config/import-boundaries.v1.json'), 'utf8')
  );
}

function fixtureFile(name: string, source: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-g10-'));
  const filePath = path.join(dir, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, source);
  return filePath.split(path.sep).join('/');
}

test('G10-A01 current API composition graph stays inside import, write and timer boundaries', async () => {
  const { checkImportBoundaries, checkApiSources } = await loadScanners();
  assert.deepEqual(checkImportBoundaries({ config: config() }), []);
  assert.deepEqual(checkApiSources({ config: config() }), []);

  const server = await import('../src/server.ts');
  for (const name of ['bootstrap', 'createApiApp', 'createApiServer'] as const)
    assert.equal(typeof server[name], 'function', name);
});

test('G10-A03 a declared cross-domain writer may touch only its declared tables', async () => {
  const { checkApiSources } = await loadScanners();
  const rules = config();
  const [writer, declared] = Object.entries(rules.writeRules.crossDomainWriters as Record<string, string[]>)[0] ?? [
    '',
    []
  ];

  assert.ok(declared.length > 0, 'a cross-domain writer declares the tables it erases');
  const allowed = fixtureFile(
    writer,
    `async function run(db) { await db.query('DELETE FROM ${declared[0]} WHERE user_id = $1'); }
`
  );
  assert.deepEqual(checkApiSources({ config: rules, files: [allowed] }), []);

  const undeclared = Object.keys(rules.writeRules.allowedOwners).find((table) => !declared.includes(table));
  const forbidden = fixtureFile(
    writer,
    `async function run(db) { await db.query('DELETE FROM ${undeclared} WHERE id = $1'); }
`
  );
  const violations = checkApiSources({ config: rules, files: [forbidden] });
  assert.equal(violations[0]?.ruleId, 'direct-foreign-table-write');
  assert.equal(violations[0]?.table, undeclared);
});

test('G10-A02 seeded forbidden imports, direct foreign writes and listener worker timers fail', async () => {
  const { checkImportBoundaries, checkApiSources } = await loadScanners();
  const rules = config();

  const badImport = fixtureFile(
    'apps/api/src/server.ts',
    "const db = require('./lib/db');\nconst v = require('packages/shared/src/validation.js');\n"
  );
  assert.match(
    checkImportBoundaries({ config: rules, files: [badImport] })[0]?.ruleId || '',
    /no-shared-src-deep-imports|api-routes-do-not-import-db/
  );

  const badWrite = fixtureFile(
    'apps/api/src/lib/push-service.js',
    "async function run(db) { await db.query('UPDATE room_messages SET text = $1'); }\n"
  );
  const writeConfig = {
    ...rules,
    writeRules: rules.writeRules,
    timerRules: rules.timerRules
  };
  const writeViolations = checkApiSources({ config: writeConfig, files: [badWrite] });
  assert.equal(writeViolations[0]?.ruleId, 'direct-foreign-table-write');
  assert.equal(writeViolations[0]?.table, 'room_messages');

  // Kysely writes are owned the same way as raw SQL.
  const badKyselyWrite = fixtureFile(
    'apps/api/src/lib/push-service.ts',
    "export async function run(db) { await db.updateTable('room_messages').set({ text: '' }).execute(); }\n"
  );
  const kyselyViolations = checkApiSources({ config: writeConfig, files: [badKyselyWrite] });
  assert.equal(kyselyViolations[0]?.ruleId, 'direct-foreign-table-write');
  assert.equal(kyselyViolations[0]?.table, 'room_messages');

  const badTimer = fixtureFile('apps/api/src/app.js', 'setInterval(() => {}, 1000);\n');
  const timerViolations = checkApiSources({ config: rules, files: [badTimer] });
  assert.equal(timerViolations[0]?.ruleId, 'api-listener-worker-timer');
});

test('G10-A04 the checks scan the repository whatever the working directory', async (t) => {
  const { checkImportBoundaries, checkApiSources } = await loadScanners();
  const cwd = process.cwd();
  process.chdir(os.tmpdir());
  t.after(() => process.chdir(cwd));

  // Probe rules the real sources are known to break: the runtime imports
  // fastify, and the room repository writes rooms.
  const runtime = 'apps/api/src/app/api-runtime.ts';
  const imports = checkImportBoundaries({
    config: { importRules: [{ id: 'probe', sources: [runtime], forbidden: ['fastify'], message: '' }] }
  });
  assert.equal(imports[0]?.filePath, runtime);

  const writes = checkApiSources({ config: { writeRules: { allowedOwners: { rooms: [] } } } });
  assert.ok(writes.some((violation) => violation.filePath === 'apps/api/src/domains/rooms/room.repository.ts'));
});

// docs/ARCHITECTURE.md section 3: a domain file says which layer it is after
// a dot, so `rooms.service.ts`, never `rooms-service.ts`.
test('G10-A05 domain files name their layer with a dot', () => {
  const domains = fileURLToPath(new URL('../src/domains/', import.meta.url));
  const misnamed = fs
    .readdirSync(domains, { recursive: true, encoding: 'utf8' })
    .filter((file) => /-(routes|service|repository|policy|module)\.ts$/.test(file));
  assert.deepEqual(misnamed, []);
});
