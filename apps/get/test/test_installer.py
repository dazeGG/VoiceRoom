import hashlib
import json
import os
import pty
import select
import shutil
import subprocess
import tempfile
import termios
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit


INSTALLER = Path(__file__).resolve().parents[1] / 'install.sh'
COMPOSE = 'docker-compose.personal.yml'
SERVER_IP = '198.51.100.48'
OLD_IP = '198.51.100.59'
TOKEN = 'private-dns-token-for-test'
V1 = 'v1.0.0'
V2 = 'v1.0.1'


def digest(content):
    return hashlib.sha256(content).hexdigest()


def image(service, version):
    return f'example.invalid/voice-{service}@sha256:{digest(f"{service}/{version}".encode())}'


class Endpoints(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def send_body(self, body, status=200):
        self.send_response(status)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def send_json(self, value, status=200):
        self.send_body(json.dumps(value).encode(), status)

    def dns_zone(self):
        return unquote(self.path.split('/')[4])

    def do_GET(self):
        request = urlsplit(self.path)
        path, query = request.path, parse_qs(request.query)
        self.server.requests.append(path)
        if path == '/public-ip':
            return self.send_body(f'{self.server.public_ip}\n'.encode())
        if path.startswith('/dns/'):
            _, _, name, kind = path.split('/')
            if name.endswith('.duckdns.org'):
                name = '.'.join(name.split('.')[-3:])
            return self.send_json(self.server.records.get((name, kind), {}).get('records', []))
        if path == '/update':
            return self.duckdns(query)
        if path.startswith('/api/v1/domains/') and path.endswith(('/@/A/', '/.../A/')):
            if self.headers.get('Authorization') != f'Token {TOKEN}':
                return self.send_json({'detail': 'unauthorized'}, 401)
            record = self.server.records.get((self.dns_zone(), 'A'))
            return self.send_json(record if record else {'detail': 'missing'}, 200 if record else 404)
        if path == '/releases/latest/download/manifest.json':
            self.send_response(302)
            self.send_header('Location', f'/releases/download/{self.server.latest}/manifest.json')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        asset = self.server.assets.get(path)
        self.send_body(asset if asset else b'not found', 200 if asset else 404)

    def duckdns(self, query):
        label = query.get('domains', [''])[0]
        if query.get('token') != [TOKEN] or '.' in label or not label:
            return self.send_body(b'KO\n')
        name = f'{label}.duckdns.org'
        if query.get('clear') == ['true']:
            for kind in ('A', 'AAAA'):
                self.server.records.pop((name, kind), None)
        elif 'ip' in query:
            self.server.records[(name, 'A')] = {'records': query['ip']}
        else:
            return self.send_body(b'KO\n')
        return self.send_body(b'OK\n')

    def do_PUT(self):
        self.server.requests.append(self.path)
        if self.headers.get('Authorization') != f'Token {TOKEN}':
            return self.send_json({'detail': 'unauthorized'}, 401)
        if not (self.path.startswith('/api/v1/domains/') and self.path.endswith('/rrsets/')):
            return self.send_json({'detail': 'use the upsert endpoint'}, 404)
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'null')
        if not isinstance(body, list) or len(body) != 1:
            return self.send_json({'detail': 'expected exactly one RRset'}, 400)
        record = body[0]
        if record.get('subname') != '' or record.get('type') != 'A' or record.get('ttl', 0) < 60:
            return self.send_json({'detail': 'expected the apex A RRset'}, 400)
        key = (self.dns_zone(), 'A')
        if record['records']:
            self.server.records[key] = record
        else:
            self.server.records.pop(key, None)
        return self.send_json(body)


class InstallerTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='voiceroom-installer-test-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.home = self.root / 'stack'
        self.dotenv = self.home / '.env'
        self.cli = self.root / 'bin' / 'voiceroom'
        self.cli.parent.mkdir()
        doubles = self.root / 'fakes'
        doubles.mkdir()
        for command in ('docker', 'dig', 'curl', 'uname', 'ss', 'mv'):
            target = doubles / command
            shutil.copyfile(Path(__file__).with_name('fake_command.py'), target)
            target.chmod(0o700)

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Endpoints)
        self.server.records = {('meet.example.test', 'A'): {'records': [SERVER_IP]}}
        self.server.public_ip = SERVER_IP
        self.server.assets = {}
        self.server.requests = []
        self.server.latest = V1
        self.base = f'http://127.0.0.1:{self.server.server_port}'
        thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': 0.05}, daemon=True)
        thread.start()

        def stop_server():
            self.server.shutdown()
            thread.join(timeout=3)
            self.server.server_close()

        self.addCleanup(stop_server)
        self.env = {key: value for key, value in os.environ.items() if not key.startswith(('VOICEROOM_', 'PERSONAL_'))}
        self.env.update(
            PATH=f"{doubles}:{os.environ['PATH']}",
            GET_TEST_ROOT=str(self.root),
            GET_TEST_HTTP=self.base,
            GET_TEST_REAL_CURL=shutil.which('curl'),
            GET_TEST_REAL_MV=shutil.which('mv'),
            NO_PROXY='127.0.0.1,localhost',
            VOICEROOM_HOME=str(self.home),
            VOICEROOM_BIN_DIR=str(self.cli.parent),
            VOICEROOM_RELEASE_BASE=f'{self.base}/releases',
            VOICEROOM_IP_URL=f'{self.base}/public-ip',
            VOICEROOM_DUCKDNS_URL=self.base,
            VOICEROOM_DESEC_URL=f'{self.base}/api/v1',
            VOICEROOM_DNS_TOKEN=TOKEN,
            VOICEROOM_DNS_WAIT='1',
            VOICEROOM_HEALTH_WAIT='1',
        )
        self.bootstrap = INSTALLER.read_bytes()
        self.publish(V1)

    def publish(self, version, *, bad_image=False):
        images = {name: image(name, version) for name in ('api', 'caddy', 'livekit', 'postgres')}
        services = {key: {'image': value} for key, value in images.items()}
        services['migrate'] = {'image': images['api']}
        services['livekit-gate'] = {'image': image('api', V1) if bad_image else images['api']}
        compose = json.dumps({'name': 'voiceroom-personal', 'services': services}).encode()
        manifest = {'schemaVersion': 1, 'version': version, 'images': images, 'files': {
            COMPOSE: digest(compose), 'install.sh': digest(self.bootstrap),
        }}
        self.server.assets.update({
            f'/releases/download/{version}/manifest.json': json.dumps(manifest).encode(),
            f'/releases/download/{version}/{COMPOSE}': compose,
            f'/releases/download/{version}/install.sh': self.bootstrap,
        })

    def run_cli(self, *args, bootstrap=False, ok=True, **env_vars):
        command = ['sh', '-s', '--', *args] if bootstrap else [str(self.cli), *args]
        result = subprocess.run(
            command, input=self.bootstrap if bootstrap else b'', env=self.env | env_vars,
            capture_output=True, timeout=20,
        )
        output = (result.stdout + result.stderr).decode()
        self.assertEqual(result.returncode == 0, ok, output)
        self.assertNotIn(TOKEN, output)
        for key, value in self.env_values().items():
            if value and any(mark in key for mark in ('PASSWORD', 'SECRET', 'TOKEN', 'API_KEY')):
                self.assertNotIn(value, output)
        return output

    def environment(self):
        return self.dotenv.read_bytes()

    def env_values(self):
        if not self.dotenv.exists():
            return {}
        return dict(line.split('=', 1) for line in self.dotenv.read_text().splitlines() if '=' in line)

    def state(self):
        state = self.root / 'compose-state.json'
        return json.loads(state.read_text()) if state.exists() else {}

    def events(self):
        events = self.root / 'events.jsonl'
        return [json.loads(line) for line in events.read_text().splitlines()] if events.exists() else []

    def fail_readiness(self, **fault):
        (self.root / 'faults.json').write_text(json.dumps(fault))

    def install(self):
        return self.run_cli('install', '--provider', 'own', '--domain', 'meet.example.test', bootstrap=True)

    def test_piped_install_checks_dns_starts_waiting_stack_and_prints_owner_link(self):
        output = self.install()
        self.assertTrue(os.access(self.cli, os.X_OK))
        self.assertEqual(self.dotenv.stat().st_mode & 0o777, 0o600)
        values = self.env_values()
        self.assertEqual(values['PERSONAL_DOMAIN'], 'meet.example.test')
        secrets = [
            values[key] for key in ('PERSONAL_POSTGRES_PASSWORD', 'PERSONAL_GATE_SECRET', 'PERSONAL_LIVEKIT_API_SECRET')
        ]
        self.assertEqual(len(set(secrets)), len(secrets))
        self.assertTrue(all(len(secret) >= 32 for secret in secrets))
        self.assertEqual(self.state()['image'], image('api', V1))
        self.assertEqual(self.state()['origin'], 'https://meet.example.test')
        self.assertIn('/dns/meet.example.test/A', self.server.requests)
        self.assertIn('https://meet.example.test/#owner=private-owner-token-0', output)
        self.assertIn('api', self.run_cli('status').lower())

    def test_piped_duckdns_install_reads_secret_from_terminal_without_echo(self):
        master, slave = pty.openpty()
        self.addCleanup(os.close, master)
        self.addCleanup(os.close, slave)
        setup_terminal = (
            'import fcntl, os, sys, termios\n'
            'fcntl.ioctl(1, termios.TIOCSCTTY, 0)\n'
            'os.execvp(sys.argv[1], sys.argv[1:])\n'
        )
        arguments = ['python3', '-c', setup_terminal, 'sh', '-s', '--', '--domain', 'meet.voice.duckdns.org']
        env = {key: value for key, value in self.env.items() if key != 'VOICEROOM_DNS_TOKEN'}
        with subprocess.Popen(
            arguments, stdin=subprocess.PIPE, stdout=slave, stderr=slave, env=env, start_new_session=True,
        ) as process:
            try:
                process.stdin.write(self.bootstrap)
                process.stdin.close()
                output = bytearray()
                selected_provider = False
                deadline = time.monotonic() + 15
                while process.poll() is None:
                    if time.monotonic() > deadline:
                        self.fail(f'Expected secure token prompt on /dev/tty, got {output.decode()}')
                    if b'DuckDNS (default)' in output and not selected_provider:
                        os.write(master, b'\n')
                        selected_provider = True
                    if selected_provider and not termios.tcgetattr(master)[3] & termios.ECHO:
                        os.write(master, f'{TOKEN}\n'.encode())
                        break
                    if select.select([master], [], [], 0.025)[0]:
                        output.extend(os.read(master, 4096))
                result = process.wait(timeout=15)
                while select.select([master], [], [], 0)[0]:
                    output.extend(os.read(master, 4096))
                self.assertEqual(result, 0, output.decode())
                self.assertNotIn(TOKEN, output.decode())
            finally:
                if process.poll() is None:
                    process.kill()
        self.assertEqual(self.server.records[('voice.duckdns.org', 'A')]['records'], [SERVER_IP])
        self.assertEqual(self.state()['origin'], 'https://meet.voice.duckdns.org')

    def test_rerun_preserves_existing_env_and_active_version(self):
        self.install()
        saved = self.environment()
        state = self.state() | {'owner_consumed': True}
        (self.root / 'compose-state.json').write_text(json.dumps(state))
        self.publish(V2)
        self.server.latest = V2
        output = self.run_cli('install', bootstrap=True)
        self.assertEqual(self.environment(), saved)
        self.assertEqual(self.state()['image'], image('api', V1))
        self.assertNotIn('/#owner=', output)
        self.assertIn('owner-link --rotate', output)

    def test_successful_upgrade_preserves_env_and_switches_active_version(self):
        self.install()
        saved = self.environment()
        self.publish(V2)
        self.server.latest = V2
        self.run_cli('upgrade')
        self.assertEqual(self.environment(), saved)
        self.assertEqual(self.state()['image'], image('api', V2))
        self.assertEqual(self.state()['schema'], image('api', V2))
        self.assertIn(V2, self.run_cli('status'))
        self.assertFalse(list(self.home.rglob('*.dump')))

    def test_failed_upgrade_restores_database_active_release_and_env(self):
        self.install()
        saved_env = self.environment()
        saved_manifest = (self.home / 'current' / 'manifest.json').read_bytes()
        self.publish(V2)
        self.fail_readiness(image=image('api', V2))
        output = self.run_cli('upgrade', V2, ok=False)
        self.assertEqual(self.environment(), saved_env)
        self.assertEqual((self.home / 'current' / 'manifest.json').read_bytes(), saved_manifest)
        self.assertEqual(self.state()['image'], image('api', V1))
        self.assertEqual(self.state()['schema'], image('api', V1))
        events = self.events()
        self.assertLess(events.index({'action': 'pg_dump', 'schema': image('api', V1)}),
                        events.index({'action': 'migrate', 'image': image('api', V2)}))
        self.assertIn({'action': 'pg_restore', 'schema': image('api', V1)}, events)
        [backup] = (self.home / 'backups').iterdir()
        self.assertEqual((backup / '.env').read_bytes(), saved_env)
        self.assertEqual((backup / '.env').stat().st_mode & 0o777, 0o600)
        self.assertEqual((backup / 'manifest.json').read_bytes(), saved_manifest)
        self.assertFalse(list(self.home.rglob('*.dump')))
        self.assertNotIn('private-owner-token-0', output)
        self.assertIn('meet.example.test', self.run_cli('domain', 'show'))

    def test_domain_change_creates_apex_a_and_updates_runtime_urls(self):
        self.install()
        old_values = self.env_values()
        self.run_cli('domain', 'set', '--provider', 'desec', '--domain', 'voice.dedyn.io')
        self.assertEqual(self.server.records[('voice.dedyn.io', 'A')]['records'], [SERVER_IP])
        self.assertEqual(self.state()['origin'], 'https://voice.dedyn.io')
        self.assertEqual(self.state()['signal'], 'wss://voice.dedyn.io')
        self.assertEqual(self.state()['site'], 'voice.dedyn.io')
        self.assertIn('voice.dedyn.io', self.run_cli('domain', 'show'))
        for key in ('PERSONAL_POSTGRES_PASSWORD', 'PERSONAL_GATE_SECRET', 'PERSONAL_LIVEKIT_API_SECRET'):
            self.assertEqual(self.env_values()[key], old_values[key])

    def test_failed_domain_change_restores_dns_record_ttl_runtime_urls_and_env(self):
        self.install()
        saved = self.environment()
        previous = {'subname': '', 'type': 'A', 'ttl': 3600, 'records': [OLD_IP, '198.51.100.60']}
        self.server.records[('voice.dedyn.io', 'A')] = previous
        self.fail_readiness(origin='https://voice.dedyn.io')
        output = self.run_cli('domain', 'set', '--provider', 'desec', '--domain', 'voice.dedyn.io', ok=False)
        self.assertEqual(self.server.records[('voice.dedyn.io', 'A')], previous)
        self.assertEqual(self.environment(), saved)
        self.assertEqual(self.state()['origin'], 'https://meet.example.test')
        self.assertEqual(self.state()['signal'], 'wss://meet.example.test')
        self.assertNotIn('private-owner-token-0', output)

    def test_signal_after_domain_commit_keeps_dns_aligned_with_committed_domain(self):
        self.install()
        self.run_cli(
            'domain', 'set', '--provider', 'desec', '--domain', 'voice.dedyn.io',
            ok=False, GET_TEST_INTERRUPT_DOMAIN_COMMIT='1',
        )
        self.assertEqual(self.server.records[('voice.dedyn.io', 'A')]['records'], [SERVER_IP])
        self.assertEqual(self.env_values()['PERSONAL_DOMAIN'], 'voice.dedyn.io')
        self.assertEqual(self.state()['origin'], 'https://voice.dedyn.io')

    def test_owner_rotation_forwards_explicit_rotate_and_prints_new_capability(self):
        self.install()
        self.assertIn('/#owner=private-owner-token-0', self.run_cli('owner-link'))
        rotated = self.run_cli('owner-link', '--rotate')
        self.assertIn('/#owner=private-owner-token-1', rotated)
        self.assertNotIn('/#owner=private-owner-token-0', rotated)
        self.assertIn('/#owner=private-owner-token-1', self.run_cli('owner-link'))

    def test_wrong_architecture_refuses_before_download_and_docker(self):
        output = self.run_cli('install', bootstrap=True, ok=False, GET_TEST_ARCH='aarch64')
        self.assertIn('x86_64', output)
        self.assertEqual(self.server.requests, [])
        self.assertEqual(self.events(), [])

    def test_busy_udp_socket_refuses_before_any_dns_or_stack_change(self):
        output = self.run_cli(
            'install', '--provider', 'duckdns', '--domain', 'voice',
            bootstrap=True, ok=False, GET_TEST_BUSY_PORT='7882',
        )
        self.assertIn('7882/udp', output)
        self.assertNotIn('/update', self.server.requests)
        self.assertEqual(self.events(), [])

    def test_fresh_install_does_not_take_over_a_preexisting_compose_project(self):
        for resource in ('ps', 'volume'):
            with self.subTest(resource=resource):
                self.run_cli(
                    'install', '--provider', 'own', '--domain', 'meet.example.test', bootstrap=True,
                    ok=False, GET_TEST_EXISTING_PROJECT_RESOURCE=resource,
                )
                self.assertEqual(self.server.requests, [])
                self.assertEqual(self.events(), [])
                self.assertFalse(self.dotenv.exists())

    def test_multiline_domain_is_rejected_before_dns(self):
        output = self.run_cli(
            'install', '--provider', 'own', '--domain', 'meet.example.test\nCONFUSING_LINE=value',
            bootstrap=True, ok=False,
        )
        self.assertIn('public DNS name', output)
        self.assertNotIn('/public-ip', self.server.requests)

    def test_multiline_ipv4_response_is_rejected_before_provider_update(self):
        self.server.public_ip = f'{SERVER_IP}\n{OLD_IP}'
        output = self.run_cli('install', '--provider', 'duckdns', '--domain', 'voice', bootstrap=True, ok=False)
        self.assertIn('public IPv4 address', output)
        self.assertNotIn('/update', self.server.requests)

    def test_multiline_version_is_rejected_before_asset_fetch(self):
        output = self.run_cli(
            'install', '--version', f'{V1}\n{V2}', '--provider', 'own', '--domain', 'meet.example.test',
            bootstrap=True, ok=False,
        )
        self.assertIn('Use a release version', output)
        self.assertEqual(self.server.requests, [])

    def test_hash_mismatch_blocks_use_of_the_bundle(self):
        self.server.assets[f'/releases/download/{V1}/{COMPOSE}'] += b'\n'
        output = self.run_cli('install', '--provider', 'own', '--domain', 'meet.example.test', bootstrap=True, ok=False)
        self.assertIn('SHA-256', output)
        self.assertEqual(self.events(), [])
        self.assertFalse(self.cli.exists())

    def test_manifest_image_mismatch_blocks_pull_and_start_after_hashes_pass(self):
        self.publish(V2, bad_image=True)
        output = self.run_cli('install', '--version', V2, '--provider', 'own', '--domain', 'meet.example.test', bootstrap=True, ok=False)
        self.assertIn('images do not match', output)
        self.assertEqual(self.events(), [])
        self.assertFalse(self.cli.exists())


if __name__ == '__main__':
    unittest.main()
