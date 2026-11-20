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
OLD_IPV6 = '2001:db8::59'
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

    def dns_name(self, subname):
        return f'{subname}.{self.dns_zone()}' if subname else self.dns_zone()

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
        if path.startswith('/api/v1/domains/') and path.endswith(('/A/', '/AAAA/')):
            if self.headers.get('Authorization') != f'Token {TOKEN}':
                return self.send_json({'detail': 'unauthorized'}, 401)
            subname, kind = path.rstrip('/').split('/')[-2:]
            record = self.server.records.get((self.dns_name('' if subname == '@' else subname), kind))
            return self.send_json(record if record else {'detail': 'missing'}, 200 if record else 404)
        if path == '/releases/latest/download/manifest.json':
            if self.server.direct_release_manifest:
                manifest = self.server.assets.get(f'/releases/download/{self.server.latest}/manifest.json')
                return self.send_body(manifest if manifest else b'not found', 200 if manifest else 404)
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
        elif 'ip' in query or 'ipv6' in query:
            for parameter, kind in (('ip', 'A'), ('ipv6', 'AAAA')):
                if parameter in query:
                    self.server.records[(name, kind)] = {'records': query[parameter]}
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
        if not isinstance(body, list) or not body or any(
            not isinstance(record.get('subname'), str) or record.get('type') not in ('A', 'AAAA') or record.get('ttl', 0) < 60
            for record in body
        ):
            return self.send_json({'detail': 'expected valid address RRsets'}, 400)
        for record in body:
            key = (self.dns_name(record['subname']), record['type'])
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
        self.doubles = self.root / 'fakes'
        self.doubles.mkdir()
        self.fake_commands('docker', 'dig', 'curl', 'uname', 'ss', 'mv', 'openssl')

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Endpoints)
        self.server.records = {(name, 'A'): {'records': [SERVER_IP]} for name in (
            'meet.example.test', 'turn.meet.example.test',
        )}
        self.server.public_ip = SERVER_IP
        self.server.assets = {}
        self.server.requests = []
        self.server.latest = V1
        self.server.direct_release_manifest = False
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
            PATH=f"{self.doubles}:{os.environ['PATH']}",
            GET_TEST_ROOT=str(self.root),
            GET_TEST_HTTP=self.base,
            GET_TEST_REAL_CURL=shutil.which('curl'),
            GET_TEST_REAL_MV=shutil.which('mv'),
            GET_TEST_REAL_OPENSSL=shutil.which('openssl'),
            GET_TEST_DNS_TOKEN=TOKEN,
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

    def fake_commands(self, *commands):
        for command in commands:
            target = self.doubles / command
            shutil.copyfile(Path(__file__).with_name('fake_command.py'), target)
            target.chmod(0o700)

    def publish(self, version, *, bad_image=False, turn=True):
        images = {name: image(name, version) for name in ('api', 'caddy', 'livekit', 'postgres')}
        services = {key: {'image': value} for key, value in images.items()}
        services['migrate'] = {'image': images['api']}
        services['livekit-gate'] = {'image': image('api', V1) if bad_image else images['api']}
        for name in ('api', 'livekit-gate', 'postgres'):
            services[name]['healthcheck'] = {'test': ['CMD', 'true']}
        udp_ports = [7882]
        if turn:
            services['caddy']['environment'] = {'TURN_ENABLED': 'true'}
            udp_ports.extend([3478, *range(30000, 30100)])
        services['livekit']['ports'] = [{'protocol': 'udp', 'published': str(port)} for port in udp_ports]
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

    def run_doctor(self, *, ok=True, bootstrap=False):
        self.fake_commands('df', 'free', 'timedatectl', 'chronyc', 'ufw', 'firewall-cmd', 'nft', 'iptables', 'ip6tables', 'ip')
        self.server.direct_release_manifest = True
        self.server.requests.clear()
        event_count = len(self.events())
        state_before = self.state()
        environment_before = self.environment() if self.dotenv.exists() else None
        try:
            output = self.run_cli(
                'doctor', ok=ok, bootstrap=bootstrap, GET_TEST_DOCTOR='1',
                DOCKER_CONTEXT='remote-context', DOCKER_HOST='tcp://192.0.2.1:2376',
            )
        finally:
            self.server.direct_release_manifest = False
        self.assertEqual(self.state(), state_before)
        self.assertEqual(self.environment() if self.dotenv.exists() else None, environment_before)
        self.assertEqual(self.server.requests.count('/releases/latest/download/manifest.json'), 1)
        self.assertEqual(self.server.requests.count('/public-ip'), 1)
        for path in self.server.requests:
            self.assertTrue(path in ('/public-ip', '/releases/latest/download/manifest.json') or path.startswith('/dns/'), path)
        for event in self.events()[event_count:]:
            self.assertIn(event['action'], ('dns-query', 'certificate', 'readyz', 'logs'), event)
        self.assertIn('security group', output.lower())
        return output

    def assert_doctor_status(self, output, status, label, *details):
        lines = [line for line in output.splitlines() if line.startswith(tuple(
            f'{level} {label}:' for level in ('OK', 'WARN', 'FAIL')
        ))]
        self.assertEqual(len(lines), 1, output)
        self.assertTrue(lines[0].startswith(f'{status} {label}:'), lines[0])
        for detail in details:
            self.assertIn(detail.lower(), lines[0].lower())

    def test_doctor_reports_every_check_and_only_uses_existing_network_endpoints(self):
        self.install()
        output = self.run_doctor()
        checks = {
            'Installed version': V1,
            'Latest release': V1,
            'Docker Engine': '',
            'Docker Compose': '2.38.1',
            'Docker disk': '4096',
            'Available memory': '2944',
            'Clock sync': '',
            'Public IPv4': SERVER_IP,
            'Meet DNS': 'meet.example.test',
            'TURN DNS': 'turn.meet.example.test',
            'Meet HTTPS certificate': '60 days',
            'TURN/TLS certificate': '60 days',
            'Local TCP 80': '',
            'Local TCP 443': '',
            'Local TCP 7881': '',
            'Local UDP 7882': '',
            'Local UDP 3478': '',
            'Local UDP 30000-30099': '',
            'Host firewall': '',
        }
        for service in ('api', 'caddy', 'livekit', 'livekit-gate', 'migrate', 'postgres'):
            checks[f'Container {service}'] = ''
        for label, detail in checks.items():
            self.assert_doctor_status(output, 'OK', label, detail)
        self.assertEqual(sum(line.startswith('OK ') for line in output.splitlines()), len(checks), output)
        self.assertNotIn('WARN ', output)
        self.assertNotIn('FAIL ', output)
        self.assertCountEqual([e['name'] for e in self.events() if e['action'] == 'certificate'],
                              ['meet.example.test', 'turn.meet.example.test'])
        for domain in ('meet.example.test', 'turn.meet.example.test'):
            for record_type in ('A', 'AAAA'):
                self.assertIn(f'/dns/{domain}/{record_type}', self.server.requests)

    def test_doctor_warns_about_updates_low_resources_clock_and_expiring_certificates(self):
        self.install()
        self.publish(V2)
        self.server.latest = V2
        self.fail_readiness(
            disk_mb=1500, memory_mb=299, clock='no', expiry_days={'meet.example.test': 13, 'turn.meet.example.test': 4},
            containers={'postgres': {'Health': 'starting'}},
        )
        output = self.run_doctor()
        self.assert_doctor_status(output, 'WARN', 'Latest release', V2, 'voiceroom upgrade')
        self.assert_doctor_status(output, 'WARN', 'Docker disk', '1500')
        self.assert_doctor_status(output, 'WARN', 'Available memory', '299')
        self.assert_doctor_status(output, 'WARN', 'Clock sync')
        self.assert_doctor_status(output, 'WARN', 'Meet HTTPS certificate', '13 days')
        self.assert_doctor_status(output, 'WARN', 'TURN/TLS certificate', '4 days')
        self.assert_doctor_status(output, 'WARN', 'Container postgres', 'starting')
        self.assertNotIn('FAIL ', output)

    def test_doctor_uses_chrony_and_warns_if_the_release_cannot_be_fetched(self):
        self.install()
        self.server.latest = 'missing-release'
        self.fail_readiness(clock=None, chrony='Leap status     : Normal')
        output = self.run_doctor()
        self.assert_doctor_status(output, 'WARN', 'Latest release', 'GitHub')
        self.assert_doctor_status(output, 'OK', 'Clock sync')

    def test_doctor_still_runs_with_docker_unavailable(self):
        self.install()
        self.fail_readiness(engine=True, compose=True)
        output = self.run_doctor(ok=False)
        self.assert_doctor_status(output, 'FAIL', 'Docker Engine')
        self.assert_doctor_status(output, 'FAIL', 'Docker Compose')
        self.assert_doctor_status(output, 'OK', 'Installed version', V1)
        self.assert_doctor_status(output, 'OK', 'Meet DNS')
        self.assert_doctor_status(output, 'OK', 'Local TCP 443')
        self.assert_doctor_status(output, 'OK', 'Host firewall')

    def test_doctor_names_the_configured_dns_provider_and_both_records(self):
        self.run_cli('install', '--provider', 'desec', '--domain', 'voice.dedyn.io', bootstrap=True)
        self.server.records[('voice.dedyn.io', 'A')] = {'records': [OLD_IP]}
        self.server.records[('turn.voice.dedyn.io', 'AAAA')] = {'records': [OLD_IPV6]}
        output = self.run_doctor(ok=False)
        self.assert_doctor_status(output, 'FAIL', 'Meet DNS', 'deSEC', 'voice.dedyn.io', 'A record', SERVER_IP)
        self.assert_doctor_status(output, 'FAIL', 'TURN DNS', 'deSEC', 'turn.voice.dedyn.io', 'AAAA')
        self.assertNotIn('Remove the AAAA record for voice.dedyn.io', output)
        self.assertNotIn('Set the A record for turn.voice.dedyn.io', output)

    def test_doctor_reports_unreadable_dns_and_socket_results(self):
        self.install()
        self.fail_readiness(
            dns_unavailable=['meet.example.test/A'], dns_malformed=['turn.meet.example.test/A'],
            sockets_unavailable=True,
        )
        output = self.run_doctor(ok=False)
        self.assert_doctor_status(output, 'FAIL', 'Meet DNS', 'meet.example.test', 'DNS resolver')
        self.assert_doctor_status(output, 'FAIL', 'TURN DNS', 'turn.meet.example.test', 'DNS resolver')
        queried = [(e['name'], e['record_type']) for e in self.events() if e['action'] == 'dns-query']
        self.assertCountEqual(queried, [(name, kind) for name in ('meet.example.test', 'turn.meet.example.test')
                                       for kind in ('A', 'AAAA')])
        self.assert_doctor_status(output, 'WARN', 'Local TCP 443', 'iproute2')
        self.assert_doctor_status(output, 'WARN', 'Local UDP 30000-30099', 'iproute2')
        self.assert_doctor_status(output, 'OK', 'Host firewall')

    def test_doctor_accepts_a_legacy_bundle_without_turn(self):
        self.publish(V1, turn=False)
        self.install()
        self.fail_readiness(missing_ports=[3478, *range(30000, 30100)])
        output = self.run_doctor()
        self.assert_doctor_status(output, 'OK', 'TURN DNS', 'disabled')
        self.assert_doctor_status(output, 'OK', 'TURN/TLS certificate', 'disabled')
        self.assertNotIn('3478', output)
        self.assertNotIn('30000-30099', output)
        self.assertEqual([e['name'] for e in self.events() if e['action'] == 'certificate'], ['meet.example.test'])

    def test_doctor_reports_missing_installation_and_still_checks_host(self):
        output = self.run_doctor(ok=False, bootstrap=True)
        self.assert_doctor_status(output, 'FAIL', 'Installed version', 'voiceroom install')
        self.assert_doctor_status(output, 'OK', 'Docker Engine')
        self.assert_doctor_status(output, 'OK', 'Public IPv4', SERVER_IP)
        self.assert_doctor_status(output, 'OK', 'Host firewall')

    def test_doctor_reports_all_critical_failures_in_one_run_and_redacts_tail(self):
        self.install()
        self.server.records[('meet.example.test', 'A')] = {'records': [OLD_IP]}
        self.server.records[('turn.meet.example.test', 'AAAA')] = {'records': [OLD_IPV6]}
        self.fail_readiness(
            disk_mb=499, certificates=['meet.example.test', 'turn.meet.example.test'],
            containers={'api': {'State': 'restarting'}, 'livekit-gate': {'Health': 'unhealthy'}},
            missing_services=['postgres'], missing_ports=[443, 7882, 30050],
            firewall={'ufw status verbose': [0, 'Status: active\n'
                      'Default: deny (incoming), allow (outgoing), disabled (routed)\n'
                      '80/tcp ALLOW IN Anywhere']},
        )
        output = self.run_doctor(ok=False)
        self.assert_doctor_status(output, 'FAIL', 'Docker disk', '499')
        self.assert_doctor_status(output, 'FAIL', 'Meet DNS', 'meet.example.test', 'A record', SERVER_IP, 'DNS provider')
        self.assert_doctor_status(output, 'FAIL', 'TURN DNS', 'turn.meet.example.test', 'AAAA', 'DNS provider')
        self.assert_doctor_status(output, 'FAIL', 'Meet HTTPS certificate')
        self.assert_doctor_status(output, 'FAIL', 'TURN/TLS certificate')
        self.assert_doctor_status(output, 'FAIL', 'Container api', 'restarting')
        self.assert_doctor_status(output, 'FAIL', 'Container livekit-gate', 'unhealthy')
        self.assert_doctor_status(output, 'FAIL', 'Container postgres')
        self.assert_doctor_status(output, 'FAIL', 'Local TCP 443')
        self.assert_doctor_status(output, 'FAIL', 'Local UDP 7882')
        self.assert_doctor_status(output, 'FAIL', 'Local UDP 30000-30099')
        self.assert_doctor_status(output, 'FAIL', 'Host firewall', 'sudo ufw', '443/tcp', '30000:30099/udp')
        self.assertCountEqual([e['service'] for e in self.events() if e['action'] == 'logs'], ['api', 'livekit-gate'])
        self.assertEqual(sum(line.startswith('    ') for line in output.splitlines()), 10, output)
        self.assertIn('recent crash while starting', output)
        self.assertIn('[redacted]', output)
        for sensitive in ('old log line that must remain private', 'another older log line', '#owner=',
                          'private-owner-token-0', 'unrecognised-password', 'unrecognised-token'):
            self.assertNotIn(sensitive, output)

    def test_doctor_warns_instead_of_failing_ports_when_docker_publishes_without_a_listener(self):
        self.install()
        daemon_config = self.root / 'daemon.json'
        daemon_config.write_text('{"userland-proxy": false}')
        self.env['VOICEROOM_DOCKER_DAEMON_CONFIG'] = str(daemon_config)
        self.fail_readiness(missing_ports=[7882])
        output = self.run_doctor()
        self.assert_doctor_status(output, 'WARN', 'Local UDP 7882', 'userland-proxy')

    def test_doctor_warns_when_firewall_rules_cannot_be_read(self):
        self.install()
        self.fail_readiness(firewall={'nft -n list ruleset': [1, 'Operation not permitted']})
        output = self.run_doctor()
        self.assert_doctor_status(output, 'WARN', 'Host firewall', 'allow')

    def test_doctor_reports_exact_commands_for_blocked_ports_across_firewall_backends(self):
        self.install()
        for backend, tool, open_port, fix in (
            (
                'firewalld', 'firewall-cmd --zone=public --list-all', '30000-30099/udp',
                'sudo firewall-cmd --zone=public --add-port=30000-30099/udp',
            ),
            (
                'nftables', 'nft -n list ruleset', 'udp dport 30000-30099 accept',
                'sudo nft insert rule inet filter inbound udp dport 30000-30099 accept',
            ),
            (
                'iptables', 'iptables -w 2 -S INPUT', '-A INPUT -p udp -m udp --dport 30000:30099 -j ACCEPT',
                'sudo iptables -I INPUT 1 -p udp --dport 30000:30099 -j ACCEPT',
            ),
        ):
            with self.subTest(backend=backend):
                rules = {
                    'firewalld': ('public\n  target: default\n  services: dhcpv6-client\n'
                                  '  ports: 80/tcp 443/tcp 7881/tcp 7882/udp 3478/udp @relay@'),
                    'nftables': ('table inet filter {\n  chain inbound {\n'
                                 '    type filter hook input priority filter; policy drop;\n'
                                 '    tcp dport { 80, 443, 7881 } accept\n'
                                 '    udp dport { 7882, 3478 } accept\n    @relay@\n  }\n}'),
                    'iptables': ('-P INPUT DROP\n-A INPUT -p tcp -m multiport --dports 80,443,7881 -j ACCEPT\n'
                                 '-A INPUT -p udp -m multiport --dports 7882,3478 -j ACCEPT\n@relay@\n'
                                 '-A INPUT -j REJECT --reject-with icmp-port-unreachable'),
                }[backend]
                firewall = {}
                if backend == 'firewalld':
                    firewall.update({
                        'firewall-cmd --state': [0, 'running'],
                        'firewall-cmd --get-zone-of-interface=eth0': [0, 'public'],
                        'firewall-cmd --info-service=dhcpv6-client': [
                            0, 'dhcpv6-client\n  ports: 546/udp\n  destination: ipv6:fe80::/64\n  includes:',
                        ],
                    })
                firewall[tool] = [0, rules.replace('@relay@', '')]
                self.fail_readiness(firewall=firewall)
                output = self.run_doctor(ok=False)
                self.assert_doctor_status(output, 'FAIL', 'Host firewall', fix)
                firewall[tool][1] = rules.replace('@relay@', open_port)
                self.fail_readiness(firewall=firewall)
                self.assert_doctor_status(self.run_doctor(), 'OK', 'Host firewall')

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
        self.assertEqual(self.state()['turn_domain'], 'turn.meet.example.test')
        self.assertIn('/dns/meet.example.test/A', self.server.requests)
        self.assertIn('/dns/turn.meet.example.test/A', self.server.requests)
        self.assertIn('Set an A record for turn.meet.example.test', output)
        self.assertIn('https://meet.example.test/#owner=private-owner-token-0', output)
        status = self.run_cli('status')
        self.assertIn('api', status)
        self.assertIn('turn.meet.example.test:443/tcp', status)
        self.assertIn('3478/udp', status)
        self.assertIn('30000-30099/udp', status)

    def test_own_domain_requires_the_turn_dns_record_before_start(self):
        del self.server.records[('turn.meet.example.test', 'A')]
        output = self.run_cli('install', '--provider', 'own', '--domain', 'meet.example.test', bootstrap=True, ok=False)
        self.assertIn('DNS must resolve turn.meet.example.test', output)
        self.assertFalse(self.dotenv.exists())
        self.assertEqual(self.events(), [])

    def test_status_reports_when_turn_tls_is_not_ready(self):
        self.install()
        self.fail_readiness(turn='turn.meet.example.test')
        self.assertIn('TURN/TLS is not ready at turn.meet.example.test:443', self.run_cli('status', ok=False))

    def run_duckdns_install_on_terminal(self, confirmation, *, ok):
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
                responses = iter([
                    (b'DuckDNS (default)', b'\n', False),
                    (b'duckdns API token:', f'{TOKEN}\n'.encode(), True),
                    (b'[y/N]', confirmation, False),
                ])
                pending = next(responses)
                deadline = time.monotonic() + 15
                while process.poll() is None:
                    if time.monotonic() > deadline:
                        self.fail(f'Expected DNS confirmation on /dev/tty, got {output.decode()}')
                    if pending and pending[0] in output:
                        prompt, response, hidden = pending
                        if hidden:
                            self.assertFalse(termios.tcgetattr(master)[3] & termios.ECHO)
                        if prompt == b'[y/N]':
                            self.assertNotIn('/update', self.server.requests)
                        os.write(master, response)
                        pending = next(responses, None)
                    if select.select([master], [], [], 0.025)[0]:
                        output.extend(os.read(master, 4096))
                result = process.wait(timeout=15)
                while select.select([master], [], [], 0)[0]:
                    output.extend(os.read(master, 4096))
                self.assertEqual(result == 0, ok, output.decode())
                self.assertNotIn(TOKEN, output.decode())
                self.assertIsNone(pending, output.decode())
                return output.decode()
            finally:
                if process.poll() is None:
                    process.kill()

    def test_piped_duckdns_install_reads_secret_and_accepts_dns_confirmation_on_terminal(self):
        self.server.records[('voice.duckdns.org', 'A')] = {'records': [OLD_IP]}
        output = self.run_duckdns_install_on_terminal(b'y\n', ok=True)
        self.assertIn(f'voice.duckdns.org currently points to {OLD_IP}, not this server ({SERVER_IP}).', output)
        self.assertEqual(self.server.records[('voice.duckdns.org', 'A')]['records'], [SERVER_IP])
        self.assertEqual(self.state()['origin'], 'https://meet.voice.duckdns.org')
        self.assertEqual(self.state()['turn_domain'], 'turn.meet.voice.duckdns.org')
        self.assertIn('/dns/turn.meet.voice.duckdns.org/A', self.server.requests)

    def test_dns_confirmation_defaults_to_no(self):
        previous = {'records': [OLD_IP]}
        self.server.records[('voice.duckdns.org', 'A')] = previous
        self.run_duckdns_install_on_terminal(b'\n', ok=False)
        self.assertEqual(self.server.records[('voice.duckdns.org', 'A')], previous)
        self.assertNotIn('/update', self.server.requests)
        self.assertFalse(self.dotenv.exists())

    def test_noninteractive_dns_conflicts_require_opt_in_for_install_and_domain_set(self):
        domains = {'duckdns': 'voice.duckdns.org', 'desec': 'voice.dedyn.io'}
        for provider, domain in domains.items():
            self.server.records[(domain, 'A')] = {'ttl': 3600, 'records': [OLD_IP]}

        for command in [('install',), ('domain', 'set')]:
            bootstrap = command == ('install',)
            if not bootstrap:
                self.install()
            for provider, domain in domains.items():
                with self.subTest(command=command, provider=provider):
                    events = self.events()
                    output = self.run_cli(*command, '--provider', provider, '--domain', domain,
                                          bootstrap=bootstrap, ok=False)
                    self.assertIn(f'{domain} currently points to {OLD_IP}, not this server ({SERVER_IP}).', output)
                    self.assertIn('--replace-dns', output)
                    self.assertEqual(self.server.records[(domain, 'A')]['records'], [OLD_IP])
                    self.assertNotIn('/update', self.server.requests)
                    self.assertNotIn('/api/v1/domains/voice.dedyn.io/rrsets/', self.server.requests)
                    self.assertEqual(self.events(), events)

    def test_explicit_dns_replacement_installs_without_a_terminal(self):
        domain = 'voice.duckdns.org'
        self.server.records[(domain, 'A')] = {'records': [OLD_IP]}
        self.server.records[(domain, 'AAAA')] = {'records': [OLD_IPV6]}
        self.run_cli('--provider', 'duckdns', '--replace-dns', '--domain', domain, bootstrap=True)
        self.assertEqual(self.server.records[(domain, 'A')]['records'], [SERVER_IP])
        self.assertNotIn((domain, 'AAAA'), self.server.records)

    def test_existing_ipv6_at_turn_requires_opt_in_before_any_desec_write(self):
        self.install()
        domain = 'voice.dedyn.io'
        turn = f'turn.{domain}'
        self.server.records[(turn, 'AAAA')] = {'ttl': 7200, 'records': [OLD_IPV6]}
        output = self.run_cli('domain', 'set', '--provider', 'desec', '--domain', domain, ok=False)
        self.assertIn(f'{turn} currently points to {OLD_IPV6}, not this server ({SERVER_IP}).', output)
        self.assertIn('--replace-dns', output)
        self.assertNotIn('/api/v1/domains/voice.dedyn.io/rrsets/', self.server.requests)
        self.assertNotIn((domain, 'A'), self.server.records)
        self.run_cli('domain', 'set', '--provider', 'desec', '--domain', domain, '--replace-dns')
        self.assertEqual(self.server.records[(domain, 'A')]['records'], [SERVER_IP])
        self.assertEqual(self.server.records[(turn, 'A')]['records'], [SERVER_IP])
        self.assertNotIn((turn, 'AAAA'), self.server.records)

    def test_failed_duckdns_domain_change_restores_ipv6_only_dns(self):
        self.install()
        domain = 'voice.duckdns.org'
        previous = {'records': [OLD_IPV6]}
        self.server.records[(domain, 'AAAA')] = previous
        self.fail_readiness(origin=f'https://{domain}')
        output = self.run_cli('domain', 'set', '--provider', 'duckdns', '--domain', domain, '--replace-dns', ok=False)
        self.assertIn('Previous domain is healthy.', output)
        self.assertEqual(self.server.records[(domain, 'AAAA')], previous)
        self.assertNotIn((domain, 'A'), self.server.records)

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
        self.run_cli('upgrade', GET_TEST_BUSY_PORT='3478')
        self.assertEqual(self.environment(), saved)
        self.assertEqual(self.state()['image'], image('api', V2))
        self.assertEqual(self.state()['schema'], image('api', V2))
        self.assertIn(V2, self.run_cli('status'))
        self.assertFalse(list(self.home.rglob('*.dump')))

    def test_install_retries_a_transient_compose_pull_failure(self):
        self.fail_readiness(pull_failures=1)
        output = self.install()
        self.assertEqual([event['image'] for event in self.events() if event['action'] == 'pull'], [image('api', V1)] * 2)
        self.assertEqual(self.state()['image'], image('api', V1))
        self.assertNotIn('failed to cleanup', output)

    def test_upgrade_retries_compose_pull_before_it_stops_the_stack(self):
        self.install()
        self.publish(V2)
        self.fail_readiness(pull_failures=2)
        self.run_cli('upgrade', V2)
        events = self.events()
        candidate_pulls = [index for index, event in enumerate(events) if event == {'action': 'pull', 'image': image('api', V2)}]
        self.assertEqual(len(candidate_pulls), 3)
        self.assertLess(candidate_pulls[-1], next(index for index, event in enumerate(events) if event['action'] == 'stop'))
        self.assertEqual(self.state()['image'], image('api', V2))

    def test_pull_exhaustion_prints_only_final_stderr_tail_with_secrets_removed(self):
        self.install()
        self.publish(V2)
        self.fail_readiness(pull_failures=3)
        events = len(self.events())
        output = self.run_cli('upgrade', V2, ok=False)
        self.assertEqual(self.events()[events:], [{'action': 'pull', 'image': image('api', V2)}] * 3)
        self.assertEqual(self.state()['image'], image('api', V1))
        self.assertTrue(self.state()['running'])
        self.assertIn('failed to fetch anonymous token: 502 Bad Gateway', output)
        self.assertIn('failed to cleanup extract-attempt-3 snapshot', output)
        self.assertIn('The previous release is still active.', output)
        for hidden in ('extract-attempt-1', 'extract-attempt-2', 'Pull progress line 0',
                       'private-registry-password', 'private-registry-token'):
            self.assertNotIn(hidden, output)

    def test_upgrade_from_legacy_config_prepares_de_sec_turn_without_changing_env(self):
        self.publish(V1, turn=False)
        self.run_cli('install', '--provider', 'desec', '--domain', 'meet.voice.dedyn.io', bootstrap=True)
        saved = self.environment()
        self.assertIn('TURN: disabled', self.run_cli('status'))
        self.assertNotIn(('turn.meet.voice.dedyn.io', 'A'), self.server.records)
        self.publish(V2)
        self.run_cli('upgrade', V2)
        self.assertEqual(self.environment(), saved)
        self.assertEqual(self.server.records[('turn.meet.voice.dedyn.io', 'A')]['records'], [SERVER_IP])
        self.assertEqual(self.state()['turn_domain'], 'turn.meet.voice.dedyn.io')
        self.assertEqual(self.state()['schema'], image('api', V2))

    def test_upgrade_requires_consent_to_replace_a_legacy_turn_address(self):
        self.publish(V1, turn=False)
        domain = 'voice.dedyn.io'
        turn = f'turn.{domain}'
        self.run_cli('install', '--provider', 'desec', '--domain', domain, bootstrap=True)
        self.server.records[(turn, 'A')] = {'ttl': 3600, 'records': [OLD_IP]}
        self.publish(V2)
        events = self.events()
        output = self.run_cli('upgrade', V2, ok=False)
        self.assertIn(f'{turn} currently points to {OLD_IP}, not this server ({SERVER_IP}).', output)
        self.assertIn('--replace-dns', output)
        self.assertEqual(self.events(), events)
        self.assertEqual(self.server.records[(turn, 'A')]['records'], [OLD_IP])
        self.run_cli('upgrade', V2, '--replace-dns')
        self.assertEqual(self.server.records[(turn, 'A')]['records'], [SERVER_IP])
        self.assertEqual(self.state()['turn_domain'], turn)

    def test_upgrade_from_legacy_config_checks_new_ports_and_turn_dns_before_downtime(self):
        self.publish(V1, turn=False)
        del self.server.records[('turn.meet.example.test', 'A')]
        self.install()
        self.publish(V2)
        events = self.events()
        output = self.run_cli('upgrade', V2, ok=False, GET_TEST_BUSY_PORT='30012')
        self.assertIn('30012/udp', output)
        output = self.run_cli('upgrade', V2, ok=False)
        self.assertIn(f'Set an A record for turn.meet.example.test to {SERVER_IP}', output)
        self.assertEqual(self.events(), events)
        self.assertEqual(self.state()['image'], image('api', V1))

    def test_upgrade_from_legacy_config_reuses_duckdns_without_token(self):
        self.publish(V1, turn=False)
        self.run_cli('install', '--provider', 'duckdns', '--domain', 'meet.voice.duckdns.org', bootstrap=True)
        self.publish(V2)
        self.server.requests.clear()
        self.run_cli('upgrade', V2, bootstrap=True, VOICEROOM_DNS_TOKEN='')
        self.assertEqual(self.state()['turn_domain'], 'turn.meet.voice.duckdns.org')
        self.assertNotIn('/update', self.server.requests)

    def test_failed_turn_upgrade_restores_legacy_release_and_removes_new_dns_record(self):
        self.publish(V1, turn=False)
        self.run_cli('install', '--provider', 'desec', '--domain', 'voice.dedyn.io', bootstrap=True)
        saved = self.environment()
        self.publish(V2)
        self.fail_readiness(turn='turn.voice.dedyn.io')
        self.run_cli('upgrade', V2, ok=False)
        self.assertEqual(self.environment(), saved)
        self.assertEqual(self.state()['schema'], image('api', V1))
        self.assertEqual(self.state()['turn_domain'], '')
        self.assertNotIn(('turn.voice.dedyn.io', 'A'), self.server.records)

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
        self.assertEqual(self.server.records[('turn.voice.dedyn.io', 'A')]['records'], [SERVER_IP])
        self.assertEqual(self.state()['origin'], 'https://voice.dedyn.io')
        self.assertEqual(self.state()['signal'], 'wss://voice.dedyn.io')
        self.assertEqual(self.state()['site'], 'voice.dedyn.io')
        self.assertEqual(self.state()['turn_domain'], 'turn.voice.dedyn.io')
        self.assertIn('voice.dedyn.io', self.run_cli('domain', 'show'))
        for key in ('PERSONAL_POSTGRES_PASSWORD', 'PERSONAL_GATE_SECRET', 'PERSONAL_LIVEKIT_API_SECRET'):
            self.assertEqual(self.env_values()[key], old_values[key])

    def test_failed_domain_change_restores_dns_record_ttl_runtime_urls_and_env(self):
        self.install()
        saved = self.environment()
        previous = {'subname': '', 'type': 'A', 'ttl': 3600, 'records': [OLD_IP, '198.51.100.60']}
        previous_turn = {'subname': 'turn', 'type': 'A', 'ttl': 7200, 'records': [OLD_IP]}
        previous_ipv6 = {'subname': 'turn', 'type': 'AAAA', 'ttl': 10800, 'records': [OLD_IPV6]}
        self.server.records[('voice.dedyn.io', 'A')] = previous
        self.server.records[('turn.voice.dedyn.io', 'A')] = previous_turn
        self.server.records[('turn.voice.dedyn.io', 'AAAA')] = previous_ipv6
        self.fail_readiness(turn='turn.voice.dedyn.io')
        output = self.run_cli('domain', 'set', '--provider', 'desec', '--domain', 'voice.dedyn.io', '--replace-dns', ok=False)
        self.assertIn('Previous domain is healthy.', output)
        self.assertEqual(self.server.records[('voice.dedyn.io', 'A')], previous)
        self.assertEqual(self.server.records[('turn.voice.dedyn.io', 'A')], previous_turn)
        self.assertEqual(self.server.records[('turn.voice.dedyn.io', 'AAAA')], previous_ipv6)
        self.assertEqual(self.environment(), saved)
        self.assertEqual(self.state()['origin'], 'https://meet.example.test')
        self.assertEqual(self.state()['signal'], 'wss://meet.example.test')
        self.assertEqual(self.state()['turn_domain'], 'turn.meet.example.test')
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
        for port in ('7882', '3478', '30050'):
            with self.subTest(port=port):
                output = self.run_cli(
                    'install', '--provider', 'duckdns', '--domain', 'voice',
                    bootstrap=True, ok=False, GET_TEST_BUSY_PORT=port,
                )
                self.assertIn(f'{port}/udp', output)
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
