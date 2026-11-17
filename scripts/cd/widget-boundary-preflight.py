#!/usr/bin/env python3
"""Fail-closed transition check, copied outside the checkout before deployment.

The host-owned JSON manifest maps immutable repo@sha256 digests to capabilities.
It is release evidence, not an authorization token. Database activation never
depends on a restored .env. This helper never clears the persistent floor.
"""
import json
import re
import subprocess
import sys


def run(*args):
    return subprocess.check_output(args, text=True, stdin=subprocess.DEVNULL, timeout=60).strip()


def require_compatible(required, images, manifest, resolve):
    if not required:
        return
    releases = manifest.get('releases', {})
    for image in images:
        digests = resolve(image)
        if not digests or not any(
            re.fullmatch(r'[^\s]+@sha256:[a-f0-9]{64}', digest)
            and 'widget-boundary-v1' in releases.get(digest, [])
            for digest in digests
        ):
            raise ValueError('incompatible or unproven widget boundary image')


def require_singleton_topology(invoke=run):
    """Widget operations support exactly one serving API and one gate."""
    owners = {}
    for service in ('api', 'livekit-gate'):
        containers = invoke('docker', 'compose', 'ps', '--quiet', service).splitlines()
        if len(containers) != 1 or not re.fullmatch(r'[a-f0-9]{12,64}', containers[0]):
            raise ValueError('widget operations require exactly one serving ' + service)
        owners[service] = containers[0]
    return owners


def require_recovery_receipt(proof):
    fields = ('ok', 'admissionDisabled', 'credentialsRevoked', 'widgetMediaEmpty',
              'widgetOccupancyEmpty', 'widgetApiQuiescent', 'widgetGateQuiescent')
    if not isinstance(proof, dict) or any(proof.get(field) is not True for field in fields):
        raise ValueError('widget recovery did not prove all admission, occupancy and media invariants')
    generation = proof.get('recoveryGeneration')
    if not isinstance(generation, str) or not re.fullmatch(r'0|[1-9][0-9]{0,18}', generation) or int(generation) > 9223372036854775807:
        raise ValueError('invalid widget recovery generation')
    for field in ('apiOwner', 'gateOwner'):
        value = proof.get(field)
        if not isinstance(value, str) or not re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}', value):
            raise ValueError('invalid widget recovery owner identity')
    return (generation, proof['apiOwner'], proof['gateOwner'])


def fenced_activation_statement(proof, activate=False):
    generation, api_owner, gate_owner = require_recovery_receipt(proof)
    # Values have been restricted to decimal/UUID literals before interpolation.
    ownership = []
    for role, owner, lock_id in (('api', api_owner, 1), ('gate', gate_owner, 2)):
        ownership.append(f"""EXISTS (SELECT 1 FROM widget_runtime_owners o JOIN pg_locks l
          ON l.pid=o.backend_pid AND l.locktype='advisory' AND l.classid=870113
          AND l.objid={lock_id} AND l.objsubid=2 AND l.granted AND l.mode='ExclusiveLock'
          AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database())
          WHERE o.role='{role}' AND o.owner_id='{owner}'::uuid
          AND o.acknowledged_generation={generation})""")
    update = 'UPDATE widget_boundary_activation SET widget_boundary_required=true, widget_admission_enabled=true WHERE singleton=true;' if activate else ''
    return f"""BEGIN; SELECT pg_advisory_xact_lock(hashtext('voice-room:widget-recovery'));
      DO $widget_fence$ BEGIN
        IF NOT (EXISTS (SELECT 1 FROM widget_boundary_activation WHERE singleton=true
          AND recovery_generation={generation} AND widget_admission_enabled=false)
          AND {' AND '.join(ownership)}) THEN
          RAISE EXCEPTION 'widget recovery ownership or generation changed';
        END IF;
        {update}
      END $widget_fence$; COMMIT;"""


def main():
    arguments = sys.argv[1:]
    rollback = arguments[0:1] == ['--rollback']
    activate = arguments[0:1] == ['--activate']
    if rollback or activate:
        arguments = arguments[1:]
    manifest_path, *images = arguments
    if len(images) != 6:
        raise ValueError('expected candidate and rollback API/worker/web images')
    # Missing schema is accepted only for a verified legacy, pre-activation DB.
    # PostgreSQL errors and malformed output never mean an empty database.
    sql = """DO $$ BEGIN
      IF to_regclass('public.widget_boundary_activation') IS NULL THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='rooms' AND column_name='kind') THEN
          RAISE EXCEPTION 'widget schema without activation floor';
        END IF;
      END IF;
    END $$;
    SELECT CASE WHEN to_regclass('public.widget_boundary_activation') IS NULL
      THEN 'legacy' ELSE 'boundary' END;"""
    def query(statement):
        return run('docker', 'compose', 'exec', '-T', 'postgres', 'sh', '-c',
                   'exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"',
                   'sh', statement)
    schema = query(sql)
    if schema not in ('legacy', 'boundary'):
        raise ValueError('cannot establish database boundary state')
    if schema == 'boundary':
        state = query("SELECT widget_boundary_required OR EXISTS(SELECT 1 FROM rooms WHERE kind='widget') FROM widget_boundary_activation WHERE singleton=true")
        if state not in ('t', 'f'):
            raise ValueError('missing or malformed activation floor')
        required = state == 't'
    else:
        required = False
    manifest = {}
    if activate and schema != 'boundary':
        raise ValueError('activation requires the additive boundary schema')
    if required or activate:
        with open(manifest_path, encoding='utf-8') as source:
            manifest = json.load(source)
    require_compatible(required or activate, images, manifest,
                       lambda image: json.loads(run('docker', 'image', 'inspect', '--format', '{{json .RepoDigests}}', image)))
    if required and rollback:
        require_singleton_topology(run)
        previous = None
        for operation in ('recover', 'verify-disabled'):
            proof = json.loads(run('docker', 'compose', 'exec', '-T', 'api', 'node',
                'apps/api/src/scripts/widget-recovery.ts', operation))
            identity = require_recovery_receipt(proof)
            if previous is not None and identity != previous:
                raise ValueError('widget recovery generation or owner changed between proofs')
            previous = identity
        query(fenced_activation_statement(proof))
    if activate:
        require_singleton_topology(run)
        services = {'api': images[0], 'livekit-gate': images[0],
                    'message-delivery': images[1], 'notification-delivery': images[1],
                    'media-processing': images[1], 'media-maintenance': images[1],
                    'media-reconciliation': images[1], 'caddy': images[2]}
        for service, expected_image in services.items():
            container = run('docker', 'compose', 'ps', '--quiet', service)
            if not re.fullmatch(r'[a-f0-9]{12,64}', container):
                raise ValueError('cannot establish one serving boundary reader: ' + service)
            state = json.loads(run('docker', 'inspect', container))[0]
            expected_id = run('docker', 'image', 'inspect', '--format', '{{.Id}}', expected_image)
            if not state.get('State', {}).get('Running') or state.get('Image') != expected_id:
                raise ValueError('old or stopped serving boundary reader: ' + service)
        proof = json.loads(run('docker', 'compose', 'exec', '-T', 'api', 'node',
            'apps/api/src/scripts/widget-recovery.ts', 'verify-disabled'))
        query(fenced_activation_statement(proof, activate=True))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('widget transition refused: ' + str(error), file=sys.stderr)
        sys.exit(1)
