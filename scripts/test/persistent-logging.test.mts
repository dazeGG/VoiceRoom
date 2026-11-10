import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const scripts = path.resolve(import.meta.dirname, '../logging');
const python = spawnSync('python3', ['--version'], { timeout: 3000 }).status === 0;
const bash = spawnSync('bash', ['-c', 'true'], { timeout: 3000 }).status === 0;
const linux = process.platform === 'linux';
const options = {
  'syslog-address': 'unixgram:///run/systemd/journal.voiceroom/dev-log',
  tag: 'voiceroom/{{.Name}}/{{.ID}}',
  mode: 'non-blocking',
  'max-buffer-size': '4m',
  'cache-disabled': 'true'
};
const runPython = (file: string, input: unknown) =>
  spawnSync('python3', [path.join(scripts, file)], { input: JSON.stringify(input), encoding: 'utf8' });

test(
  'effective journal limits reject later overrides that remove persistence, expiry or isolation',
  { skip: !python },
  () => {
    const config = fs.readFileSync(path.resolve(scripts, '../../config/logging/journal.conf'), 'utf8');
    const run = (text: string) =>
      spawnSync('python3', [path.join(scripts, 'validate-journal.py')], { input: text, encoding: 'utf8' });
    assert.equal(run(config).status, 0);
    for (const replacement of ['Storage=volatile', 'MaxRetentionSec=0', 'ForwardToSyslog=yes', 'SystemMaxUse=4G']) {
      assert.notEqual(run(`${config}\n[Journal]\n${replacement}\n`).status, 0, replacement);
    }
  }
);

test(
  'resolved Compose requires persistent logging on every service without the inherited JSON options',
  { skip: !python },
  () => {
    const config = {
      services: { api: { logging: { driver: 'syslog', options } }, livekit: { logging: { driver: 'syslog', options } } }
    };
    const valid = runPython('validate-compose.py', config);
    assert.equal(valid.status, 0, valid.stderr);
    assert.match(valid.stdout, /2 services/);
    const inherited = structuredClone(config);
    Object.assign(inherited.services.api.logging.options, { 'max-size': '10m', 'max-file': '3' });
    assert.notEqual(runPython('validate-compose.py', inherited).status, 0);
    const missing = structuredClone(config);
    missing.services.livekit.logging.driver = 'json-file';
    assert.notEqual(runPython('validate-compose.py', missing).status, 0);
    assert.notEqual(runPython('validate-compose.py', { services: {} }).status, 0);
  }
);

test('Compose failure does not echo deployment secrets', { skip: !python }, () => {
  const result = runPython('validate-compose.py', {
    services: { api: { logging: { driver: 'json-file' }, environment: { DATABASE_PASSWORD: 'keep-this-secret' } } }
  });
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout + result.stderr, /keep-this-secret/);
});

function fakeCommands(t: TestContext, commands: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-log-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, body] of Object.entries(commands)) {
    fs.writeFileSync(path.join(dir, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  }
  return { dir, env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH ?? ''}` } };
}

test(
  'reader queries only the application namespace, with complete JSON and a bounded default window',
  { skip: !bash || !linux },
  (t) => {
    const { env } = fakeCommands(t, { journalctl: 'printf "%s\\n" "$@"' });
    const result = spawnSync('bash', [path.join(scripts, 'read.sh')], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split('\n'), [
      '--namespace=voiceroom',
      '--output=json',
      '--all',
      '--no-pager',
      '--since=24 hours ago',
      '--lines=5000',
      '--until=now'
    ]);
  }
);

test(
  'reader treats time strings as data and refuses journal mutation or unbounded output',
  { skip: !bash || !linux },
  (t) => {
    const { env } = fakeCommands(t, { journalctl: 'printf "%s\\n" "$@"' });
    for (const args of [
      ['--vacuum-time', '1s'],
      ['--namespace', 'system'],
      ['--lines', '0'],
      ['--lines', '100001'],
      ['--since']
    ]) {
      const result = spawnSync('bash', [path.join(scripts, 'read.sh'), ...args], { env, encoding: 'utf8' });
      assert.notEqual(result.status, 0, args.join(' '));
      assert.equal(result.stdout, '');
    }
    const literal = '2026-11-10; echo must-not-execute';
    const result = spawnSync('bash', [path.join(scripts, 'read.sh'), '--since', literal, '--lines', '25', '--follow'], {
      env,
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(`--since=${literal}\n`));
    assert.match(result.stdout, /--follow/);
    assert.doesNotMatch(result.stdout, /--until=/);
  }
);

test('smoke validation requires both removed generations and the full large JSON message', { skip: !python }, () => {
  const harness = `import json, runpy, sys\nm = runpy.run_path(sys.argv[1])\nd = json.load(sys.stdin)\nm['check_records'](d['rows'], d['tags'], 'marker')`;
  const tags = ['voiceroom/test/first', 'voiceroom/test/second'];
  const rows = tags.map((tag, index) => ({
    SYSLOG_IDENTIFIER: tag,
    MESSAGE: JSON.stringify({ marker: 'marker', payload: index === 0 ? 'x'.repeat(5000) : 'recreated' })
  }));
  const run = (entries: typeof rows) =>
    spawnSync('python3', ['-c', harness, path.join(scripts, 'smoke.py')], {
      input: JSON.stringify({ rows: entries, tags }),
      encoding: 'utf8'
    });
  assert.equal(run(rows).status, 0);
  assert.notEqual(run(rows.slice(1)).status, 0);
  const truncated = structuredClone(rows);
  const first = truncated[0];
  assert.ok(first);
  first.MESSAGE = JSON.stringify({ marker: 'marker', payload: 'x'.repeat(4096) });
  assert.notEqual(run(truncated).status, 0);
});

test('journal namespace lifecycle is ordered before Docker without stop propagation', () => {
  for (const [file, dependency] of [
    ['docker.conf', 'voiceroom-logging.service'],
    ['voiceroom-logging.service', 'systemd-journald@voiceroom.service'],
    ['voiceroom-log-retention.service', 'voiceroom-logging.service']
  ]) {
    assert.ok(file && dependency);
    const config = fs.readFileSync(path.resolve(scripts, '../../config/logging', file), 'utf8');
    assert.ok(config.includes(`Wants=${dependency}\n`));
    assert.ok(config.includes(`After=${dependency}\n`));
    assert.doesNotMatch(config, /^(?:Requires|BindsTo|PartOf)=/m);
  }
});

test('namespace restart smoke rejects a stopped or restarted Docker and a stopped bootstrap', { skip: !python }, () => {
  const harness = `import runpy, sys
m = runpy.run_path(sys.argv[1])
fn = m['restart_journal']
scenario = sys.argv[2]
restarted = False
def run(*args):
    global restarted
    if args[:2] == ('systemctl', 'restart'):
        restarted = True
    if args[:3] == ('systemctl', 'is-active', 'docker.service'):
        return 'inactive' if restarted and scenario == 'stopped' else 'active'
    if args[:3] == ('systemctl', 'show', 'docker.service'):
        return '456' if restarted and scenario == 'changed' else '123'
    if args[:3] == ('systemctl', 'is-active', 'voiceroom-logging.service'):
        return 'inactive' if scenario == 'bootstrap' else 'active'
    return ''
fn.__globals__['run'] = run
fn()
`;
  for (const scenario of ['unchanged', 'stopped', 'changed', 'bootstrap']) {
    const result = spawnSync('python3', ['-c', harness, path.join(scripts, 'smoke.py'), scenario], {
      encoding: 'utf8'
    });
    if (scenario === 'unchanged') assert.equal(result.status, 0, result.stderr);
    else assert.notEqual(result.status, 0, scenario);
  }
});

test(
  'installer refuses an unrelated override without changing it or running system setup',
  { skip: !python || !bash || !linux || process.getuid?.() !== 0 },
  (t) => {
    const { dir, env } = fakeCommands(t, {
      docker: 'echo 5.3.1',
      systemctl: '[[ "$1" == cat ]] || exit 99',
      'systemd-analyze': 'exit 99',
      journalctl: 'exit 99',
      logger: 'exit 99'
    });
    fs.writeFileSync(path.join(dir, 'docker-compose.yml'), 'services: {}\n');
    const override = path.join(dir, 'docker-compose.override.yml');
    fs.writeFileSync(override, '# local settings\n');
    const result = spawnSync('bash', [path.join(scripts, 'install.sh'), dir], { env, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unrelated docker-compose.override.yml/);
    assert.equal(fs.readFileSync(override, 'utf8'), '# local settings\n');
  }
);

test('required persistent logging fails closed before deployment side effects', { skip: !bash || !linux }, (t) => {
  const { dir, env } = fakeCommands(t, {
    docker: 'echo docker >> "$VR_TEST_CALLS"; exit 99',
    git: 'echo git >> "$VR_TEST_CALLS"; exit 99'
  });
  const calls = path.join(dir, 'calls');
  const override = path.join(dir, 'docker-compose.override.yml');
  const deploy = path.resolve(scripts, '../cd/remote-deploy.sh');
  for (const scenario of [
    { name: 'missing override', flag: '1', override: null, error: /production requires the managed/ },
    { name: 'unmanaged override', flag: '1', override: '# local logging\n', error: /production requires the managed/ },
    { name: 'invalid flag', flag: 'yes', override: null, error: /REQUIRE_PERSISTENT_LOGS must be 0 or 1/ }
  ]) {
    fs.rmSync(override, { force: true });
    if (scenario.override !== null) fs.writeFileSync(override, scenario.override);
    const result = spawnSync('/bin/bash', [deploy, dir, 'test-commit', 'test-api', 'test-worker', 'test-web'], {
      env: { ...env, REQUIRE_PERSISTENT_LOGS: scenario.flag, VR_TEST_CALLS: calls },
      encoding: 'utf8'
    });
    assert.notEqual(result.status, 0, scenario.name);
    assert.match(result.stderr, scenario.error, scenario.name);
    assert.equal(fs.existsSync(path.join(dir, 'deploy-backups')), false, `${scenario.name}: no backups or lock`);
    assert.equal(fs.existsSync(calls), false, `${scenario.name}: no Docker or Git invocation`);
  }
});

test(
  'managed profile with an unavailable installed preflight cannot start backup or rollback',
  { skip: !bash || !linux },
  (t) => {
    const { dir, env } = fakeCommands(t, {
      docker: 'echo docker >> "$VR_TEST_CALLS"; exit 99',
      git: 'echo git >> "$VR_TEST_CALLS"; exit 99',
      bash: 'printf "%s\\n" "$@" > "$VR_TEST_PREFLIGHT"; echo "preflight helper unavailable" >&2; exit 127'
    });
    const calls = path.join(dir, 'calls');
    const preflight = path.join(dir, 'preflight-call');
    fs.writeFileSync(path.join(dir, 'docker-compose.override.yml'), '# VoiceRoom managed persistent logging v1\n');
    const result = spawnSync(
      '/bin/bash',
      [path.resolve(scripts, '../cd/remote-deploy.sh'), dir, 'test-commit', 'test-api', 'test-worker', 'test-web'],
      {
        env: { ...env, REQUIRE_PERSISTENT_LOGS: '1', VR_TEST_CALLS: calls, VR_TEST_PREFLIGHT: preflight },
        encoding: 'utf8'
      }
    );
    assert.equal(result.status, 127);
    assert.match(result.stderr, /preflight helper unavailable/);
    assert.deepEqual(fs.readFileSync(preflight, 'utf8').trim().split('\n'), [
      '/etc/voiceroom/logging/preflight.sh',
      dir
    ]);
    assert.equal(fs.existsSync(path.join(dir, 'deploy-backups')), false);
    assert.equal(fs.existsSync(calls), false, 'neither rollout nor rollback may invoke Docker or Git');
  }
);

function transitionFixture(t: TestContext) {
  const { dir, env } = fakeCommands(t, { docker: 'exec python3 "$VR_FAKE_DOCKER" "$@"' });
  const destination = path.join(dir, 'archive');
  fs.mkdirSync(destination, { mode: 0o700 });
  const logs = path.join(dir, 'docker-output');
  const fakeDocker = path.join(dir, 'docker.py');
  fs.writeFileSync(
    fakeDocker,
    `import json, os, sys
from pathlib import Path
args = sys.argv[1:]
if args == ['compose', 'ps', '--all', '--quiet']:
    print('a' * 64)
elif args[0] == 'inspect':
    print(json.dumps({'id': 'a' * 64, 'service': 'caddy'}))
elif args[0] == 'logs':
    assert args[1:4] == ['--since', '2026-10-27T00:00:00Z', '--timestamps']
    sys.stdout.buffer.write(Path(os.environ['VR_LOG_INPUT']).read_bytes())
    sys.exit(int(os.environ.get('VR_LOG_EXIT', '0')))
else:
    sys.exit(99)
`
  );
  const harness = `import datetime, json, runpy, sys
from pathlib import Path
m = runpy.run_path(sys.argv[1])
try:
    result = m['archive'](Path(sys.argv[2]), Path(sys.argv[3]), max_raw_bytes=int(sys.argv[4]), max_archive_bytes=int(sys.argv[5]), now=datetime.datetime(2026, 11, 10, tzinfo=datetime.timezone.utc))
except (OSError, ValueError):
    sys.exit('bounded capture failed')
print(json.dumps(result))
`;
  const run = (content: string, rawLimit = 30 * 1024 * 1024, archiveLimit = 64 * 1024 * 1024, exit = 0) => {
    fs.writeFileSync(logs, content);
    return spawnSync(
      'python3',
      [
        '-c',
        harness,
        path.join(scripts, 'archive-current.py'),
        dir,
        destination,
        String(rawLimit),
        String(archiveLimit)
      ],
      {
        env: { ...env, VR_FAKE_DOCKER: fakeDocker, VR_LOG_INPUT: logs, VR_LOG_EXIT: String(exit) },
        encoding: 'utf8'
      }
    );
  };
  return { destination, run };
}

function rolloutFixture(t: TestContext) {
  const { dir, env } = fakeCommands(t, {
    docker: 'exec /usr/bin/python3 "$VR_FAKE_DOCKER" "$@"',
    git: 'echo "git $*" >> "$VR_TEST_CALLS"; if [[ "$1" == rev-parse ]]; then echo previous-commit; fi',
    bash: 'echo "bash $1" >> "$VR_TEST_CALLS"; exit 0',
    python3: 'echo archive >> "$VR_TEST_CALLS"; exit "${VR_ARCHIVE_EXIT:-0}"',
    logger: 'exit 0',
    flock: 'exit 0'
  });
  const calls = path.join(dir, 'calls');
  const fakeDocker = path.join(dir, 'rollout-docker.py');
  const initialEnv = 'VOICEROOM_API_IMAGE=old-api\nVOICEROOM_WORKER_IMAGE=old-worker\nVOICEROOM_WEB_IMAGE=old-web\n';
  fs.writeFileSync(path.join(dir, '.env'), initialEnv);
  fs.writeFileSync(path.join(dir, 'docker-compose.override.yml'), '# VoiceRoom managed persistent logging v1\n');
  fs.writeFileSync(
    fakeDocker,
    `import os, subprocess, sys
from pathlib import Path
args = sys.argv[1:]
calls = Path(os.environ['VR_TEST_CALLS'])
def note(value):
    with calls.open('a') as file: file.write(value + '\\n')
if args == ['compose', 'ps', '--all', '--quiet', 'livekit']:
    print('a' * 64)
elif args[0] == 'inspect':
    print(os.environ.get('VR_DRIVER', 'json-file'))
elif args[:6] == ['compose', 'exec', '-T', 'api', 'node', '-e']:
    note('metric')
    counter = Path(os.environ['VR_METRIC_COUNTER'])
    count = int(counter.read_text()) if counter.exists() else 0
    counter.write_text(str(count + 1))
    env = dict(os.environ)
    env['VR_METRIC_VALUE'] = os.environ.get('VR_METRIC_FIRST' if count == 0 else 'VR_METRIC_SECOND', 'voice_room_api_presence_peers 0')
    prelude = "globalThis.fetch = async (_url, options) => { if (!(options.signal instanceof AbortSignal)) throw new Error('timeout required'); return {ok: process.env.VR_HTTP_OK !== 'false', text: async () => process.env.VR_METRIC_VALUE}; };"
    sys.exit(subprocess.run(['node', '-e', prelude + args[6]], env=env).returncode)
elif args[:4] == ['compose', 'exec', '-T', 'postgres']:
    note('database-backup')
    print('database dump')
elif args[0] == 'pull':
    note('pull')
    sys.exit(int(os.environ.get('VR_PULL_EXIT', '0')))
elif args[:2] == ['compose', 'up']:
    note('compose-up')
    sys.exit(int(os.environ.get('VR_UP_EXIT', '0')))
else:
    note('docker ' + ' '.join(args[:3]))
`
  );
  const run = (overrides: NodeJS.ProcessEnv = {}) =>
    spawnSync(
      '/bin/bash',
      [path.resolve(scripts, '../cd/remote-deploy.sh'), dir, 'test-commit', 'test-api', 'test-worker', 'test-web'],
      {
        env: {
          ...env,
          REQUIRE_PERSISTENT_LOGS: '1',
          VR_TEST_CALLS: calls,
          VR_FAKE_DOCKER: fakeDocker,
          VR_METRIC_COUNTER: path.join(dir, 'metric-count'),
          ...overrides
        },
        encoding: 'utf8'
      }
    );
  const events = () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n') : []);
  return { dir, initialEnv, run, events };
}

test(
  'first logging activation refuses busy, missing, duplicated or unreadable voice metrics before backup',
  { skip: !python || !bash || !linux },
  async (t) => {
    for (const scenario of [
      { metric: 'voice_room_api_presence_peers 1' },
      { metric: '# no live voice count' },
      { metric: 'voice_room_api_presence_peers 0\nvoice_room_api_presence_peers 1' },
      { metric: 'voice_room_api_presence_peers 0', httpOk: 'false' }
    ]) {
      await t.test(scenario.metric, (t) => {
        const fixture = rolloutFixture(t);
        const result = fixture.run({ VR_METRIC_FIRST: scenario.metric, VR_HTTP_OK: scenario.httpOk ?? 'true' });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /requires a verified zero voice-peer count/);
        assert.equal(fs.existsSync(path.join(fixture.dir, 'deploy-backups')), false);
        assert.equal(fixture.events().includes('compose-up'), false);
        assert.equal(
          fixture.events().some((event) => event.startsWith('git ')),
          false
        );
      });
    }
  }
);

test(
  'failed pull restores files without triggering first logging activation through rollback',
  { skip: !python || !bash || !linux },
  (t) => {
    const fixture = rolloutFixture(t);
    const result = fixture.run({ VR_PULL_EXIT: '17' });
    assert.notEqual(result.status, 0);
    assert.ok(fixture.events().includes('git checkout --quiet --detach previous-commit'));
    assert.equal(fixture.events().includes('compose-up'), false);
    assert.equal(fixture.events().includes('archive'), false);
    assert.equal(fs.readFileSync(path.join(fixture.dir, '.env'), 'utf8'), fixture.initialEnv);
  }
);

test(
  'archive failure or a newly joined peer aborts before rollout and restores the old environment',
  { skip: !python || !bash || !linux },
  async (t) => {
    for (const scenario of [{ VR_ARCHIVE_EXIT: '23' }, { VR_METRIC_SECOND: 'voice_room_api_presence_peers 2' }]) {
      await t.test(JSON.stringify(scenario), (t) => {
        const fixture = rolloutFixture(t);
        const result = fixture.run(scenario);
        assert.notEqual(result.status, 0);
        assert.ok(fixture.events().includes('archive'));
        assert.equal(fixture.events().includes('compose-up'), false);
        assert.equal(fs.readFileSync(path.join(fixture.dir, '.env'), 'utf8'), fixture.initialEnv);
      });
    }
  }
);

test(
  'zero-peer first activation archives then rechecks before rollout, while later releases skip both',
  { skip: !python || !bash || !linux },
  async (t) => {
    for (const driver of ['json-file', 'syslog']) {
      await t.test(driver, (t) => {
        const fixture = rolloutFixture(t);
        const result = fixture.run({ VR_DRIVER: driver });
        assert.equal(result.status, 0, result.stderr);
        const events = fixture.events();
        assert.equal(events.filter((event) => event === 'compose-up').length, 1);
        if (driver === 'json-file') {
          assert.equal(events.filter((event) => event === 'metric').length, 2);
          assert.ok(events.indexOf('archive') < events.lastIndexOf('metric'));
          assert.ok(events.lastIndexOf('metric') < events.indexOf('compose-up'));
        } else {
          assert.equal(events.includes('metric'), false);
          assert.equal(events.includes('archive'), false);
        }
      });
    }
  }
);

test(
  'a rollout failure still restores containers after rollout was actually attempted',
  { skip: !python || !bash || !linux },
  (t) => {
    const fixture = rolloutFixture(t);
    const result = fixture.run({ VR_DRIVER: 'syslog', VR_UP_EXIT: '24' });
    assert.notEqual(result.status, 0);
    assert.equal(fixture.events().filter((event) => event === 'compose-up').length, 2);
    assert.equal(fs.readFileSync(path.join(fixture.dir, '.env'), 'utf8'), fixture.initialEnv);
  }
);

test(
  'transition archive retains original timestamps and metadata while removing Caddy request secrets',
  { skip: !python || !bash || !linux },
  (t) => {
    const { destination, run } = transitionFixture(t);
    const stamp = '2026-11-08T06:00:00.000000123Z';
    const raw = `${stamp} ${JSON.stringify({
      logger: 'http.log.error',
      request: {
        method: 'GET',
        uri: '/rtc?access_token=secret-token',
        headers: { Cookie: 'private-cookie' },
        remote_ip: '192.0.2.1',
        client_ip: '192.0.2.1',
        remote_port: '1234'
      },
      resp_headers: { 'Set-Cookie': 'response-cookie' },
      msg: 'upstream failed'
    })}\n`;
    const first = run(raw);
    assert.equal(first.status, 0, first.stderr);
    assert.doesNotMatch(first.stdout, /secret-token|private-cookie|192\.0\.2\.1|upstream failed/);
    const file = path.join(destination, `caddy-${'a'.repeat(64)}.jsonl.gz`);
    const content = gunzipSync(fs.readFileSync(file)).toString();
    const parsed: unknown = JSON.parse(content);
    assert.deepEqual(parsed, {
      at: stamp,
      service: 'caddy',
      containerId: 'a'.repeat(64),
      line: JSON.stringify({ logger: 'http.log.error', request: { method: 'GET' }, msg: 'upstream failed' })
    });
    assert.equal(fs.statSync(file).mode & 0o777, 0o640);
    assert.ok(Math.abs(fs.statSync(file).mtimeMs - Date.parse(stamp)) < 1);
    const again = run(raw);
    assert.equal(again.status, 0, again.stderr);
    assert.deepEqual(
      fs.readdirSync(destination).filter((name) => name.endsWith('.jsonl.gz')),
      [path.basename(file)]
    );
    assert.ok(
      Math.abs(fs.statSync(file).mtimeMs - Date.parse(stamp)) < 1,
      'a rerun cannot renew the age of old records'
    );
  }
);

test(
  'transition capture accepts all Docker RFC3339Nano precisions without rewriting original timestamps',
  { skip: !python || !bash || !linux },
  (t) => {
    const { destination, run } = transitionFixture(t);
    for (let digits = 0; digits <= 9; digits += 1) {
      const fraction = digits ? `.${'123456789'.slice(0, digits)}` : '';
      const stamp = `2026-11-08T06:00:00${fraction}Z`;
      const result = run(`${stamp} {"msg":"precision fixture"}\n`);
      assert.equal(result.status, 0, result.stderr);
      const file = path.join(destination, `caddy-${'a'.repeat(64)}.jsonl.gz`);
      assert.match(gunzipSync(fs.readFileSync(file)).toString(), new RegExp(stamp.replace('.', '\\.')));
      assert.ok(Math.abs(fs.statSync(file).mtimeMs - Date.parse(stamp)) < 1);
    }
  }
);

test(
  'transition archive skips empty or expired logs and fails closed on raw, total or Docker errors',
  { skip: !python || !bash || !linux },
  (t) => {
    const { destination, run } = transitionFixture(t);
    for (const content of ['', '2026-10-01T00:00:00Z old record\n']) {
      const result = run(content);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(fs.readdirSync(destination).filter((name) => name.endsWith('.jsonl.gz')).length, 0);
    }
    const content = '2026-11-09T00:00:00Z {"msg":"private-captured-message"}\n';
    for (const result of [
      run(content, 10),
      run(content, 1000, 10),
      run(content, 1000, 1000, 1),
      run('2027-01-01T00:00:00Z future record\n')
    ]) {
      assert.notEqual(result.status, 0);
      assert.doesNotMatch(result.stdout + result.stderr, /private-captured-message/);
      assert.equal(fs.readdirSync(destination).filter((name) => name.endsWith('.jsonl.gz')).length, 0);
    }
    const existing = path.join(destination, 'existing.jsonl.gz');
    fs.writeFileSync(existing, 'existing retained archive');
    assert.notEqual(run(content, 1000, 5).status, 0);
    assert.equal(fs.readFileSync(existing, 'utf8'), 'existing retained archive');
  }
);

test(
  'transition retention removes only expired archives and abandoned staging within the fixed directory',
  { skip: !linux },
  (t) => {
    const { dir } = fakeCommands(t, {});
    const age = (name: string, minutes: number) => {
      const file = path.join(dir, name);
      fs.writeFileSync(file, 'fixture');
      const at = new Date(Date.now() - minutes * 60_000);
      fs.utimesSync(file, at, at);
    };
    age('old.jsonl.gz', 20162);
    age('recent.jsonl.gz', 10);
    age('.pending-old.jsonl.gz', 62);
    age('keep.txt', 30000);
    const unit = fs.readFileSync(path.resolve(scripts, '../../config/logging/voiceroom-log-retention.service'), 'utf8');
    const commands = unit.split('\n').filter((line) => line.startsWith('ExecStartPre=/usr/bin/find '));
    assert.equal(commands.length, 2);
    for (const command of commands) {
      const args = command.slice('ExecStartPre=/usr/bin/find '.length).split(' ');
      assert.equal(args.shift(), '/var/lib/voiceroom/log-transition');
      const result = spawnSync('/usr/bin/find', [dir, ...args], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    }
    assert.deepEqual(fs.readdirSync(dir).sort(), ['keep.txt', 'recent.jsonl.gz']);
  }
);
