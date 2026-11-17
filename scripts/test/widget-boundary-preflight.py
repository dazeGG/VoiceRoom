import importlib.util
import json
import sys
import pathlib
import unittest
import os
import subprocess
import tempfile
from unittest.mock import patch

path = pathlib.Path(__file__).parents[1] / 'cd' / 'widget-boundary-preflight.py'
spec = importlib.util.spec_from_file_location('boundary', path)
boundary = importlib.util.module_from_spec(spec)
spec.loader.exec_module(boundary)
manifest_spec = importlib.util.spec_from_file_location('manifest', path.parent / 'widget-release-capabilities.py')
manifest_module = importlib.util.module_from_spec(manifest_spec)
manifest_spec.loader.exec_module(manifest_module)


class ManifestTest(unittest.TestCase):
    def test_only_explicit_capabilities_on_exact_digests_are_recorded(self):
        digest = 'registry/image@sha256:' + 'a' * 64
        metadata = {'Config': {'Labels': {'org.voiceroom.capabilities': 'widget-boundary-v1'}}, 'RepoDigests': [digest]}
        self.assertEqual(manifest_module.build_manifest(['tag'], lambda _: metadata),
                         {'releases': {digest: ['widget-boundary-v1']}})
        for invalid in [{'Config': {'Labels': {}}, 'RepoDigests': [digest]},
                        {'Config': {'Labels': {'org.voiceroom.capabilities': 'widget-boundary-v1'}}, 'RepoDigests': []}]:
            self.assertEqual(manifest_module.build_manifest(['tag'], lambda _: invalid), {'releases': {}})

    def test_failed_image_inspection_cannot_generate_partial_evidence(self):
        def unavailable(_):
            raise RuntimeError('image inspection unavailable')
        with self.assertRaises(RuntimeError):
            manifest_module.build_manifest(['tag'], unavailable)


class CompatibilityTest(unittest.TestCase):
    def test_legacy_disabled_does_not_require_manifest(self):
        boundary.require_compatible(False, ['old'], {}, lambda _: [])

    def test_activated_floor_requires_each_exact_image_digest(self):
        digest = 'registry/api@sha256:' + 'a' * 64
        boundary.require_compatible(True, ['api'], {'releases': {digest: ['widget-boundary-v1']}}, lambda _: [digest])
        for manifest, resolved in [({}, [digest]), ({'releases': {digest: ['widget-boundary-v1']}}, []),
                                   ({'releases': {digest: ['widget-boundary-v1']}}, ['registry/api@sha256:' + 'b' * 64])]:
            with self.assertRaises(ValueError):
                boundary.require_compatible(True, ['api'], manifest, lambda _: resolved)

    def test_unproven_worker_blocks_whole_release(self):
        digest = 'registry/api@sha256:' + 'a' * 64
        with self.assertRaises(ValueError):
            boundary.require_compatible(True, ['api', 'worker'], {'releases': {digest: ['widget-boundary-v1']}},
                                        lambda image: [digest] if image == 'api' else [])


class DeploymentOrderingTest(unittest.TestCase):
    def run_deploy(self, initial, activate_during_rollout=False, compatible=False, recovery_fails=False, proof_mode='', multiple_owner='', fence_fails=False):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            tools = root / 'bin'
            tools.mkdir()
            (root / '.env').write_text('VOICEROOM_API_IMAGE=old-api\nVOICEROOM_WORKER_IMAGE=old-worker\nVOICEROOM_WEB_IMAGE=old-web\n')
            (root / 'floor').write_text(initial)
            log = root / 'events'
            def executable(name, body):
                target = tools / name
                target.write_text('#!/bin/bash\nset -e\n' + body)
                target.chmod(0o755)
            executable('git', '''echo "git $*" >> "$EVENTS"
case "$1" in
rev-parse) echo previous ;;
show) case "$2" in *widget-release-capabilities.py) cat "$MANIFEST_HELPER" ;; *) cat "$HELPER" ;; esac ;;
esac
''')
            executable('docker', '''echo "docker $*" >> "$EVENTS"
case "$*" in
*psql*information_schema*) echo boundary ;;
*psql*widget_fence*) if [ "$FENCE_FAILS" = 1 ]; then exit 1; fi ;;
*psql*) cat "$FLOOR" ;;
"compose ps --quiet"*)
  echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  if [ "$MULTIPLE_OWNER" = "${@: -1}" ]; then echo bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb; fi ;;
"compose up"*)
  if [ "$ACTIVATE" = 1 ]; then echo t > "$FLOOR"; fi
  exit 1 ;;
"compose exec -T api node"*)
  if [ "$RECOVERY_FAILS" = 1 ]; then exit 1; fi
  generation=1
  if [ "$PROOF_MODE" = wrong-generation ] && [ "${@: -1}" = verify-disabled ]; then generation=2; fi
  occupancy=true
  if [ "$PROOF_MODE" = missing-occupancy ]; then occupancy=null; fi
  echo '{"ok":true,"admissionDisabled":true,"credentialsRevoked":true,"widgetMediaEmpty":true,"widgetOccupancyEmpty":'"$occupancy"',"widgetApiQuiescent":true,"widgetGateQuiescent":true,"recoveryGeneration":"'"$generation"'","apiOwner":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","gateOwner":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"}' ;;
"compose exec"*) echo dump ;;
"image inspect --format"*)
  if [ "$COMPATIBLE" = 1 ]; then echo '["registry/image@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]'; else echo '[]'; fi ;;
"image inspect"*)
  if [ "$COMPATIBLE" = 1 ]; then
    echo '[{"Config":{"Labels":{"org.voiceroom.capabilities":"widget-boundary-v1"}},"RepoDigests":["registry/image@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]}]'
  else echo '[{"Config":{"Labels":{}},"RepoDigests":[]}]'; fi ;;
esac
''')
            env = dict(os.environ, PATH=str(tools) + os.pathsep + os.environ['PATH'],
                       EVENTS=str(log), HELPER=str(path), FLOOR=str(root / 'floor'),
                       MANIFEST_HELPER=str(path.parent / 'widget-release-capabilities.py'),
                       ACTIVATE='1' if activate_during_rollout else '0')
            env.update(COMPATIBLE='1' if compatible else '0', RECOVERY_FAILS='1' if recovery_fails else '0')
            env.update(PROOF_MODE=proof_mode, MULTIPLE_OWNER=multiple_owner, FENCE_FAILS='1' if fence_fails else '0')
            script = pathlib.Path(__file__).parents[1] / 'cd' / 'remote-deploy.sh'
            result = subprocess.run(['bash', str(script), str(root), 'candidate', 'new-api', 'new-worker', 'new-web'],
                                    env=env, capture_output=True, text=True)
            return result, log.read_text(), (root / '.env').read_text()

    def test_disabled_first_rollout_can_restore_legacy(self):
        result, events, environment = self.run_deploy('f')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('git checkout --quiet --detach previous', events)
        self.assertIn('VOICEROOM_API_IMAGE=old-api', environment)

    def test_activated_floor_rejects_before_checkout_or_env_mutation(self):
        result, events, environment = self.run_deploy('t')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('git checkout', events)
        self.assertNotIn('docker compose up', events)
        self.assertIn('VOICEROOM_API_IMAGE=old-api', environment)

    def test_err_trap_rechecks_floor_before_restoring_old_environment(self):
        result, events, environment = self.run_deploy('f', True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('git checkout --quiet --detach candidate', events)
        self.assertNotIn('git checkout --quiet --detach previous', events)
        self.assertIn('VOICEROOM_API_IMAGE=new-api', environment)


    def test_compatible_activated_rollback_requires_recovery_and_forces_flag_off(self):
        result, events, environment = self.run_deploy('t', compatible=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('widget-recovery.ts recover', events)
        self.assertIn('widget-recovery.ts verify-disabled', events)
        self.assertLess(events.index('widget-recovery.ts verify-disabled'), events.index('git checkout --quiet --detach previous'))
        self.assertIn('VOICEROOM_API_IMAGE=old-api', environment)
        self.assertIn('WIDGET_ENABLED=false', environment)
        self.assertIn('rollback stack restoration failed; operator repair required', result.stderr)

    def test_failed_recovery_never_restores_even_compatible_stack(self):
        result, events, environment = self.run_deploy('t', compatible=True, recovery_fails=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('git checkout --quiet --detach previous', events)
        self.assertIn('VOICEROOM_API_IMAGE=new-api', environment)

    def test_missing_occupancy_proof_never_restores_compatible_stack(self):
        result, events, _ = self.run_deploy('t', compatible=True, proof_mode='missing-occupancy')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('git checkout --quiet --detach previous', events)

    def test_changed_recovery_generation_never_restores_compatible_stack(self):
        result, events, _ = self.run_deploy('t', compatible=True, proof_mode='wrong-generation')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('git checkout --quiet --detach previous', events)

    def test_owner_lock_loss_after_receipts_never_restores_compatible_stack(self):
        result, events, _ = self.run_deploy('t', compatible=True, fence_fails=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('widget-recovery.ts verify-disabled', events)
        self.assertNotIn('git checkout --quiet --detach previous', events)

    def test_multiple_api_or_gate_refuses_widget_recovery(self):
        for service in ('api', 'livekit-gate'):
            result, events, _ = self.run_deploy('t', compatible=True, multiple_owner=service)
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn('widget-recovery.ts recover', events)
            self.assertNotIn('git checkout --quiet --detach previous', events)


class ActivationTest(unittest.TestCase):
    def activation(self, old_worker=False, database_failure=False, multiple_owner=''):
        digest = 'registry/image@sha256:' + 'a' * 64
        queries = []
        def invoke(*arguments):
            command = ' '.join(arguments)
            if 'psql' in command:
                if database_failure:
                    raise RuntimeError('database unavailable')
                queries.append(arguments[-1])
                if 'information_schema' in command:
                    return 'boundary'
                if 'UPDATE widget_boundary_activation' in command:
                    return ''
                return 'f'
            if arguments[:4] == ('docker', 'compose', 'ps', '--quiet'):
                if arguments[-1] == multiple_owner:
                    return 'a' * 64 + '\n' + 'b' * 64
                return ('b' if arguments[-1] == 'media-processing' else 'a') * 64
            if arguments[:6] == ('docker', 'compose', 'exec', '-T', 'api', 'node'):
                return json.dumps({'ok': True, 'admissionDisabled': True, 'credentialsRevoked': True,
                    'widgetMediaEmpty': True, 'widgetOccupancyEmpty': True, 'widgetApiQuiescent': True,
                    'widgetGateQuiescent': True, 'recoveryGeneration': '0',
                    'apiOwner': 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                    'gateOwner': 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'})
            if arguments[:2] == ('docker', 'inspect'):
                image = 'old-image' if old_worker and arguments[-1] == 'b' * 64 else 'new-image'
                return json.dumps([{'State': {'Running': True}, 'Image': image}])
            if '{{.Id}}' in arguments:
                return 'new-image'
            if '{{json .RepoDigests}}' in arguments:
                return json.dumps([digest])
            raise AssertionError(arguments)
        with tempfile.TemporaryDirectory() as directory:
            manifest = pathlib.Path(directory) / 'manifest.json'
            manifest.write_text(json.dumps({'releases': {digest: ['widget-boundary-v1']}}))
            with patch.object(boundary, 'run', invoke), patch.object(sys, 'argv', ['helper', '--activate', str(manifest)] + ['image'] * 6):
                if old_worker or database_failure or multiple_owner:
                    with self.assertRaises((ValueError, RuntimeError)):
                        boundary.main()
                else:
                    boundary.main()
        return queries

    def test_activation_requires_running_boundary_readers_and_uses_recovery_lock(self):
        queries = self.activation()
        activation = next(query for query in queries if 'UPDATE widget_boundary_activation' in query)
        self.assertIn("pg_advisory_xact_lock(hashtext('voice-room:widget-recovery'))", activation)
        self.assertIn('widget_boundary_required=true, widget_admission_enabled=true', activation)

    def test_old_worker_refuses_activation_before_floor_or_admission_change(self):
        self.assertFalse(any('UPDATE widget_boundary_activation' in query for query in self.activation(old_worker=True)))

    def test_database_failure_cannot_mean_first_disabled_rollout(self):
        self.assertEqual(self.activation(database_failure=True), [])

    def test_multiple_api_or_gate_refuses_activation_before_state_change(self):
        for service in ('api', 'livekit-gate'):
            self.assertFalse(any('UPDATE widget_boundary_activation' in query for query in self.activation(multiple_owner=service)))

    def test_receipt_rejects_missing_or_invalid_generation_and_owners(self):
        valid = {'ok': True, 'admissionDisabled': True, 'credentialsRevoked': True,
                 'widgetMediaEmpty': True, 'widgetOccupancyEmpty': True, 'widgetApiQuiescent': True,
                 'widgetGateQuiescent': True, 'recoveryGeneration': '1',
                 'apiOwner': 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                 'gateOwner': 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'}
        self.assertEqual(boundary.require_recovery_receipt(valid)[0], '1')
        for field, value in [('recoveryGeneration', None), ('recoveryGeneration', 'oops'),
                             ('recoveryGeneration', '-1'), ('recoveryGeneration', '9223372036854775808'),
                             ('apiOwner', None), ('gateOwner', 'not-a-uuid')]:
            with self.assertRaises(ValueError):
                boundary.require_recovery_receipt({**valid, field: value})


if __name__ == '__main__':
    unittest.main()
