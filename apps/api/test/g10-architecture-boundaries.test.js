const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

async function loadScanners() {
  const [imports, sources] = await Promise.all([
    import('../../../scripts/import-boundary.mjs'),
    import('../../../scripts/check-api-sources.mjs')
  ]);
  return { checkImportBoundaries: imports.checkImportBoundaries, checkApiSources: sources.checkApiSources };
}

function config() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '../../../config/import-boundaries.v1.json'), 'utf8'));
}

function fixtureFile(name, source) {
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

  const serverSource = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');
  assert.match(serverSource, /function createApiServer\(/);
  assert.match(serverSource, /function createApiApp\(/);
  assert.match(serverSource, /function bootstrap\(/);
  assert.match(serverSource, /module\.exports\s*=\s*\{/);
});

test('G10-A02 seeded forbidden imports, direct foreign writes and listener worker timers fail', async () => {
  const { checkImportBoundaries, checkApiSources } = await loadScanners();
  const rules = config();

  const badImport = fixtureFile('apps/api/src/server.js', "const db = require('./lib/db');\nconst v = require('packages/shared/src/validation.js');\n");
  assert.match(
    checkImportBoundaries({ config: rules, files: [badImport] })[0]?.ruleId || '',
    /no-shared-src-deep-imports|api-routes-do-not-import-db/
  );

  const badWrite = fixtureFile('apps/api/src/lib/push-service.js', "async function run(db) { await db.query('UPDATE room_messages SET text = $1'); }\n");
  const writeConfig = {
    ...rules,
    writeRules: rules.writeRules,
    timerRules: rules.timerRules
  };
  const writeViolations = checkApiSources({ config: writeConfig, files: [badWrite] });
  assert.equal(writeViolations[0].ruleId, 'direct-foreign-table-write');
  assert.equal(writeViolations[0].table, 'room_messages');

  const badTimer = fixtureFile('apps/api/src/app.js', "setInterval(() => {}, 1000);\n");
  const timerViolations = checkApiSources({ config: rules, files: [badTimer] });
  assert.equal(timerViolations[0].ruleId, 'api-listener-worker-timer');
});
