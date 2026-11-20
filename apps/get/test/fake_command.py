#!/usr/bin/env python3
"""Process doubles for Compose, host tools and the local TLS readiness probes."""

import json
import os
import re
import signal
import subprocess
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit


root = Path(os.environ['GET_TEST_ROOT'])
command = Path(sys.argv[0]).name
arguments = sys.argv[1:]
doctor = os.environ.get('GET_TEST_DOCTOR') == '1'


def load(name):
    path = root / name
    return json.loads(path.read_text()) if path.exists() else {}


def save(name, value):
    (root / name).write_text(json.dumps(value))


def log(action, **fields):
    with (root / 'events.jsonl').open('a') as target:
        target.write(json.dumps({'action': action, **fields}) + '\n')


def option(*names):
    for index, argument in enumerate(arguments):
        name, separator, value = argument.partition('=')
        if name in names:
            return value if separator else arguments[index + 1]
    raise AssertionError(f'Expected one of {names}')


def compose():
    faults = load('faults.json') if doctor else {}
    if doctor and (
        not os.environ.get('DOCKER_HOST', '').startswith('unix:///') or 'DOCKER_CONTEXT' in os.environ
    ):
        log('unexpected-nonlocal-docker-request')
        return 1
    if arguments[:1] == ['info']:
        if faults.get('engine'):
            return 1
        if '--format' in arguments:
            assert option('--format') == '{{.DockerRootDir}}', arguments
            print('/srv/docker-data')
        return 0
    if arguments[:2] == ['compose', 'version']:
        if faults.get('compose'):
            return 1
        print('2.38.1' if '--short' in arguments else 'Docker Compose version v2.38.1')
        return 0
    if arguments == ['version']:
        return 0
    if arguments == ['compose', 'up', '--help']:
        if not faults.get('old_compose'):
            print('  --wait-timeout int           Maximum wait duration')
        return 0
    if arguments[:1] == ['ps'] or arguments[:2] == ['volume', 'ls']:
        if arguments[0] == os.environ.get('GET_TEST_EXISTING_PROJECT_RESOURCE'):
            print('pre-existing-project-resource')
        return 0
    if faults.get('compose'):
        return 1

    assert arguments[0] == 'compose', arguments
    assert option('--project-name', '-p') == 'voiceroom-personal', arguments
    env_file = Path(option('--env-file'))
    config = json.loads(Path(option('--file', '-f')).read_text())
    values = dict(line.split('=', 1) for line in env_file.read_text().splitlines() if '=' in line)
    domain = values['PERSONAL_DOMAIN']
    origin = values.get('PERSONAL_ORIGIN', f'https://{domain}')
    signal = values.get('PERSONAL_SIGNAL_URL', f'wss://{domain}')
    site = values.get('PERSONAL_CADDY_SITE', domain)
    caddy = config['services']['caddy']
    turn_domain = f'turn.{domain}' if caddy.get('environment', {}).get('TURN_ENABLED') == 'true' else ''
    if turn_domain:
        caddy['environment']['TURN_DOMAIN'] = turn_domain
    image = config['services']['api']['image']
    operations = {'config', 'pull', 'up', 'stop', 'run', 'exec', 'ps', 'logs'}
    action = next(argument for argument in arguments if argument in operations)
    if faults.get('engine') and action in ('ps', 'logs'):
        return 1
    if doctor and action not in ('config', 'ps', 'logs'):
        log('unexpected-compose-write', operation=action)
        return 1
    args = arguments[arguments.index(action) + 1:]
    state = load('compose-state.json')

    if action == 'config':
        assert option('--format') == 'json', args
        print(json.dumps(config))
    elif action == 'pull':
        log('pull', image=image)
        attempts = load('pull-attempts.json')
        attempts[image] = attempts.get(image, 0) + 1
        save('pull-attempts.json', attempts)
        if attempts[image] <= load('faults.json').get('pull_failures', 0):
            for line in range(20):
                print(f'Pull progress line {line}', file=sys.stderr)
            for key in ('PERSONAL_POSTGRES_PASSWORD', 'PERSONAL_GATE_SECRET',
                        'PERSONAL_LIVEKIT_API_KEY', 'PERSONAL_LIVEKIT_API_SECRET'):
                print(f'Compose diagnostic for value {values[key]}', file=sys.stderr)
            print(f"Compose diagnostic for value {os.environ['GET_TEST_DNS_TOKEN']}", file=sys.stderr)
            print(f"Resolved image at https://operator:private-registry-password@example.invalid/blob?{os.environ['GET_TEST_DNS_TOKEN']}",
                  file=sys.stderr)
            print('Authorization: Bearer private-registry-token', file=sys.stderr)
            print('failed to fetch anonymous token: 502 Bad Gateway', file=sys.stderr)
            print(f"failed to cleanup extract-attempt-{attempts[image]} snapshot", file=sys.stderr)
            return 1
    elif action == 'up':
        assert '--wait' in args, args
        if args[-1] != 'postgres':
            log('up', image=image, origin=origin)
            if state.get('schema', image) != image:
                print('database has incompatible migrations', file=sys.stderr)
                return 1
            state.update(image=image, origin=origin, signal=signal, site=site, schema=image, running=True,
                         turn_domain=turn_domain)
            save('compose-state.json', state)
    elif action == 'stop':
        log('stop', services=args)
        state['running'] = False
        save('compose-state.json', state)
    elif action == 'run' and args[-1] == 'migrate':
        log('migrate', image=image)
        state['schema'] = image
        save('compose-state.json', state)
    elif action == 'exec' and 'pg_dump' in args:
        log('pg_dump', schema=state['schema'])
        print(json.dumps({'schema': state['schema']}))
    elif action == 'exec' and 'pg_restore' in args:
        snapshot = json.load(sys.stdin)
        log('pg_restore', schema=snapshot['schema'])
        state.update(snapshot)
        save('compose-state.json', state)
    elif action == 'exec' and 'apps/api/src/scripts/owner-link.ts' in args:
        assert 'api' in args and '-T' in args, args
        if '--rotate' in args:
            state['owner_generation'] = state.get('owner_generation', 0) + 1
            save('compose-state.json', state)
        generation = state.get('owner_generation', 0)
        if state.get('owner_consumed') and not generation:
            print('The owner link was used. Pass --rotate to issue a fresh link.', file=sys.stderr)
            return 1
        log('owner-link', generation=generation)
        print(f'{origin}/#owner=private-owner-token-{generation}')
    elif action == 'ps':
        assert option('--format') == 'json', args
        default_services = ('api', 'livekit-gate', 'caddy')
        services = config['services'] if doctor else default_services
        for service in services:
            if service in faults.get('missing_services', []):
                continue
            container = {
                'State': 'exited' if service == 'migrate' else 'running',
                'Health': 'healthy' if 'healthcheck' in config['services'][service] else '',
                'ExitCode': 0,
            }
            if not doctor:
                container['Health'] = 'healthy'
            container.update(faults.get('containers', {}).get(service, {}))
            print(json.dumps({
                'Service': service,
                **container,
                'Labels': f"unexpected-private-value={values['PERSONAL_GATE_SECRET']}",
            }))
    elif action == 'logs':
        service = args[-1]
        assert service in config['services'], args
        assert option('--tail') == '5' and '--no-color' in args, args
        log('logs', service=service)
        lines = ['old log line that must remain private', 'another older log line', 'recent crash while starting']
        lines.extend((
            f"unstructured value {values['PERSONAL_POSTGRES_PASSWORD']}",
            f"provider value {os.environ['GET_TEST_DNS_TOKEN']}",
            f'link https://{domain}/#owner=private-owner-token-0',
            '{"password":"unrecognised-password","token":"unrecognised-token"}',
        ))
        print('\n'.join(f'{service}-1 | {line}' for line in lines[-int(option('--tail')):]))
    else:
        raise AssertionError(f'Unexpected Compose command: {action} {args}')
    return 0


def dig():
    record_type = next(arg for arg in arguments if arg in ('A', 'AAAA', 'NS'))
    domain = next(arg.rstrip('.') for arg in arguments if not arg.startswith(('-', '+', '@')) and arg != record_type)
    if doctor:
        log('dns-query', name=domain, record_type=record_type)
        faults = load('faults.json')
        query = f'{domain}/{record_type}'
        if query in faults.get('dns_unavailable', []):
            return 9
        if query in faults.get('dns_malformed', []):
            print('unexpected resolver reply')
            return 0
    if domain == 'duckdns.org' and record_type == 'NS':
        print('ns1.duckdns.org.')
        return 0
    with urllib.request.urlopen(f"{os.environ['GET_TEST_HTTP']}/dns/{domain}/{record_type}", timeout=3) as response:
        records = json.load(response)
    if '+comments' in arguments:
        name_exists = doctor or bool(records)
        print(f';; ->>HEADER<<- opcode: QUERY, status: {"NOERROR" if name_exists else "NXDOMAIN"}, id: 1')
        print(';; flags: qr aa; QUERY: 1, ANSWER: 1, AUTHORITY: 0, ADDITIONAL: 0')
        for record in records:
            print(f'{domain}.\t60\tIN\t{record_type}\t{record}')
    else:
        for record in records:
            print(record)
    return 0


def curl():
    health_url = next((arg for arg in arguments if re.fullmatch(r'https://[a-z0-9.-]+/api/readyz', arg)), None)
    if health_url is None:
        if doctor:
            base = os.environ['GET_TEST_HTTP']
            allowed = {f'{base}/public-ip', f'{base}/releases/latest/download/manifest.json'}
            urls = [arg for arg in arguments if arg.startswith(('https://', 'http://'))]
            if len(urls) != 1 or urls[0] not in allowed or any(
                arg.startswith(('-d', '--data', '-H', '--header', '-X', '--request', '-F', '--form'))
                and arg != '--disable' for arg in arguments
            ):
                log('unexpected-network-request')
                return 1
        os.execv(os.environ['GET_TEST_REAL_CURL'], [command, *arguments])
    origin = f'https://{urlsplit(health_url).hostname}'
    state = load('compose-state.json')
    faults = load('faults.json')
    if doctor:
        if '--noproxy' not in arguments or option('--noproxy') != '*' or (
            '--resolve' not in arguments or option('--resolve') != f'{urlsplit(origin).hostname}:443:127.0.0.1'
        ):
            log('unexpected-nonlocal-readiness-request')
            return 1
    log('readyz', origin=origin, image=state.get('image'))
    if (
        not state.get('running')
        or state.get('origin') != origin
        or state.get('image') == faults.get('image')
        or origin == faults.get('origin')
    ):
        print('readiness response contained private-owner-token-0', file=sys.stderr)
        return 22
    print('200' if '--write-out' in arguments else '{"ok":true}', end='')
    return 0


def uname():
    if 'GET_TEST_ARCH' in os.environ and any('m' in arg for arg in arguments):
        print(os.environ['GET_TEST_ARCH'])
        return 0
    os.execv('/usr/bin/uname', [command, *arguments])


def openssl():
    faults = load('faults.json')
    if doctor and arguments[:1] == ['x509']:
        assert '-enddate' in arguments and '-noout' in arguments, arguments
        content = sys.stdin.read() if '-in' not in arguments else Path(option('-in')).read_text()
        assert content.startswith('fake-certificate '), content
        name = content.strip().removeprefix('fake-certificate ')
        days = faults.get('expiry_days', {}).get(name, 60)
        expiry = datetime.now(timezone.utc) + timedelta(days=days, minutes=1)
        print(f'notAfter={expiry:%b %d %H:%M:%S %Y} GMT')
        return 0
    if arguments[0] != 's_client':
        os.execv(os.environ['GET_TEST_REAL_OPENSSL'], [command, *arguments])
    name = option('-servername')
    if doctor and option('-connect') != '127.0.0.1:443':
        log('unexpected-nonlocal-certificate-request')
        return 1
    assert option('-connect') == '127.0.0.1:443', arguments
    assert option('-verify_hostname') == name and '-verify_return_error' in arguments, arguments
    state = load('compose-state.json')
    if doctor:
        log('certificate', name=name)
        if state.get('running') and name in (urlsplit(state.get('origin', '')).hostname, state.get('turn_domain')):
            if name not in faults.get('certificates', []):
                print(f'fake-certificate {name}')
                return 0
        return 1
    log('turn-tls', name=name)
    return int(not state.get('running') or state.get('turn_domain') != name or faults.get('turn') == name)


def host():
    faults = load('faults.json')
    output = None
    if command == 'df':
        assert arguments[-1] == '/srv/docker-data', arguments
        output = ('Filesystem 1048576-blocks Used Available Capacity Mounted on\n'
                  f"/dev/vda1 100000 20000 {faults.get('disk_mb', 4096)} 20% /srv/docker-data")
    elif command == 'free':
        assert arguments == ['-m'], arguments
        output = 'total used free shared buff/cache available\nMem: 4096 512 2048 128 512 '
        output += str(faults.get('memory_mb', 2944))
    elif command == 'timedatectl':
        assert arguments == ['show', '--property=NTPSynchronized', '--value'], arguments
        output = faults.get('clock', 'yes')
    elif command == 'chronyc':
        assert arguments == ['-n', 'tracking'], arguments
        output = faults.get('chrony')
    if output is None:
        return 1
    print(output)
    return 0


def firewall():
    defaults = {
        'ufw': 'Status: inactive',
        'firewall-cmd': 'not running',
        'nft': '',
        'iptables': '-P INPUT ACCEPT',
        'ip6tables': '-P INPUT ACCEPT',
        'ip': 'default via 192.0.2.1 dev eth0',
    }
    readonly = {
        'ufw': ('status',),
        'firewall-cmd': ('--state', '--get-default-zone', '--get-zone-of-interface=', '--zone=', '--info-service='),
        'nft': ('-n', 'list'),
        'iptables': ('-w', '-S'),
        'ip6tables': ('-w', '-S'),
        'ip': ('-4', 'route'),
    }
    if not arguments or not arguments[0].startswith(readonly[command]):
        log('unexpected-firewall-write', command=command)
        return 1
    controls = load('faults.json').get('firewall', {})
    key = ' '.join((command, *arguments))
    override = controls.get(key)
    if override is None:
        if command == 'firewall-cmd' and arguments == ['--state']:
            print(defaults[command])
            return 1
        if command == 'firewall-cmd':
            return 1
        print(defaults[command])
        return 0
    code, output = override
    if output:
        print(output, file=sys.stderr if code else sys.stdout)
    return code


if command == 'docker':
    sys.exit(compose())
if command == 'dig':
    sys.exit(dig())
if command == 'curl':
    sys.exit(curl())
if command == 'uname':
    sys.exit(uname())
if command == 'openssl':
    sys.exit(openssl())
if command == 'ss':
    if doctor:
        faults = load('faults.json')
        if faults.get('sockets_unavailable'):
            sys.exit(1)
        assert arguments in (['-H', '-aun'], ['-H', '-ltn']), arguments
        ports, socket_state = ((80, 443, 7881), 'LISTEN') if '-ltn' in arguments else (
            (7882, 3478, *range(30000, 30100)), 'UNCONN',
        )
        for port in ports:
            if port not in faults.get('missing_ports', []):
                print(f'{socket_state} 0 0 *:{port} *:*')
        sys.exit(0)
    occupied = os.environ.get('GET_TEST_BUSY_PORT')
    if occupied and (f'sport = :{occupied}' in arguments or arguments == ['-H', '-aun']):
        print(f'UNCONN 0 0 0.0.0.0:{occupied} 0.0.0.0:*')
    sys.exit(0)
if command == 'mv':
    result = subprocess.run([os.environ['GET_TEST_REAL_MV'], *arguments], check=False)
    if result.returncode == 0 and os.environ.get('GET_TEST_INTERRUPT_DOMAIN_COMMIT') == '1':
        target = Path(os.environ['VOICEROOM_HOME']) / '.env'
        if arguments[-1] == str(target) and Path(arguments[-2]).name == '.env':
            os.kill(os.getppid(), signal.SIGTERM)
    sys.exit(result.returncode)
if command in ('df', 'free', 'timedatectl', 'chronyc'):
    sys.exit(host())
if command in ('ufw', 'firewall-cmd', 'nft', 'iptables', 'ip6tables', 'ip'):
    sys.exit(firewall())
raise AssertionError(f'Unexpected fake command: {command}')
