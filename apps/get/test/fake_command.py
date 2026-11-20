#!/usr/bin/env python3
"""Process doubles for Compose, host tools and the local HTTPS readiness probe."""

import json
import os
import re
import signal
import subprocess
import sys
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit


root = Path(os.environ['GET_TEST_ROOT'])
command = Path(sys.argv[0]).name
arguments = sys.argv[1:]


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
    if arguments in (['info'], ['version'], ['compose', 'version']):
        return 0
    if arguments == ['compose', 'up', '--help']:
        print('  --wait-timeout int           Maximum wait duration')
        return 0
    if arguments[:1] == ['ps'] or arguments[:2] == ['volume', 'ls']:
        if arguments[0] == os.environ.get('GET_TEST_EXISTING_PROJECT_RESOURCE'):
            print('pre-existing-project-resource')
        return 0

    assert arguments[0] == 'compose', arguments
    assert option('--project-name', '-p') == 'voiceroom-personal', arguments
    env_file = Path(option('--env-file'))
    config = json.loads(Path(option('--file', '-f')).read_text())
    values = dict(line.split('=', 1) for line in env_file.read_text().splitlines() if '=' in line)
    domain = values['PERSONAL_DOMAIN']
    origin = values.get('PERSONAL_ORIGIN', f'https://{domain}')
    signal = values.get('PERSONAL_SIGNAL_URL', f'wss://{domain}')
    site = values.get('PERSONAL_CADDY_SITE', domain)
    image = config['services']['api']['image']
    operations = {'config', 'pull', 'up', 'stop', 'run', 'exec', 'ps'}
    action = next(argument for argument in arguments if argument in operations)
    args = arguments[arguments.index(action) + 1:]
    state = load('compose-state.json')

    if action == 'config':
        assert option('--format') == 'json', args
        print(json.dumps(config))
    elif action == 'pull':
        log('pull', image=image)
    elif action == 'up':
        assert '--wait' in args, args
        if args[-1] != 'postgres':
            log('up', image=image, origin=origin)
            if state.get('schema', image) != image:
                print('database has incompatible migrations', file=sys.stderr)
                return 1
            state.update(image=image, origin=origin, signal=signal, site=site, schema=image, running=True)
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
        for service in ('api', 'livekit-gate', 'caddy'):
            print(json.dumps({
                'Service': service,
                'State': 'running',
                'Health': 'healthy',
                'Labels': f"unexpected-private-value={values['PERSONAL_GATE_SECRET']}",
            }))
    else:
        raise AssertionError(f'Unexpected Compose command: {action} {args}')
    return 0


def dig():
    record_type = next(arg for arg in arguments if arg in ('A', 'AAAA', 'NS'))
    domain = next(arg.rstrip('.') for arg in arguments if not arg.startswith(('-', '+', '@')) and arg != record_type)
    if domain == 'duckdns.org' and record_type == 'NS':
        print('ns1.duckdns.org.')
        return 0
    with urllib.request.urlopen(f"{os.environ['GET_TEST_HTTP']}/dns/{domain}/{record_type}", timeout=3) as response:
        records = json.load(response)
    if '+comments' in arguments:
        name_exists = bool(records)
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
        os.execv(os.environ['GET_TEST_REAL_CURL'], [command, *arguments])
    origin = f'https://{urlsplit(health_url).hostname}'
    state = load('compose-state.json')
    faults = load('faults.json')
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


if command == 'docker':
    sys.exit(compose())
if command == 'dig':
    sys.exit(dig())
if command == 'curl':
    sys.exit(curl())
if command == 'uname':
    sys.exit(uname())
if command == 'ss':
    occupied = os.environ.get('GET_TEST_BUSY_PORT')
    if occupied and f'sport = :{occupied}' in arguments:
        print(f'0.0.0.0:{occupied}')
    sys.exit(0)
if command == 'mv':
    result = subprocess.run([os.environ['GET_TEST_REAL_MV'], *arguments], check=False)
    if result.returncode == 0 and os.environ.get('GET_TEST_INTERRUPT_DOMAIN_COMMIT') == '1':
        target = Path(os.environ['VOICEROOM_HOME']) / '.env'
        if arguments[-1] == str(target) and Path(arguments[-2]).name == '.env':
            os.kill(os.getppid(), signal.SIGTERM)
    sys.exit(result.returncode)
raise AssertionError(f'Unexpected fake command: {command}')
