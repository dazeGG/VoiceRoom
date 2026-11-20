import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


PUBLISH = Path(__file__).resolve().parents[3] / 'scripts' / 'cd' / 'publish-personal-release.sh'


class PublishPersonalReleaseTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='voiceroom-publish-test-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.bundle = self.root / 'bundle'
        self.bundle.mkdir()
        for asset in ('docker-compose.personal.yml', 'install.sh', 'manifest.json'):
            (self.bundle / asset).write_text('fixture\n')
        self.git('init', '-q')
        self.git('commit', '--allow-empty', '-qm', 'chore: legacy release')
        self.git('tag', 'v2.15.0')
        (self.root / 'apps/meet').mkdir(parents=True)
        (self.root / 'apps/web').mkdir()
        (self.root / 'apps/web/change').touch()
        self.git('add', 'apps/web/change')
        self.git('commit', '-qm', 'fix(web): unrelated change')
        (self.root / 'apps/meet/change').touch()
        self.git('add', 'apps/meet/change')
        self.git('commit', '-qm', 'fix(meet): installer fixture')
        self.git('tag', 'meet/v1.0.0')
        gh = self.root / 'gh'
        gh.write_text("""#!/usr/bin/env python3
import json
import os
import sys

args = sys.argv[1:]
with open(os.environ['GH_CALLS'], 'a') as log:
    log.write(json.dumps(args) + '\\n')
if args[0] == 'api':
    print(os.environ['GH_LATEST'])
elif args[:2] == ['release', 'view']:
    sys.exit(1)
elif args[:2] not in (['release', 'create'], ['release', 'upload'], ['release', 'edit']):
    sys.exit(2)
""")
        gh.chmod(0o700)

    def git(self, *arguments):
        subprocess.run(
            ['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', *arguments],
            cwd=self.root, check=True, capture_output=True,
        )

    def publish(self, tag, latest):
        log = self.root / 'gh.jsonl'
        result = subprocess.run(
            ['bash', str(PUBLISH), tag, str(self.bundle)],
            cwd=self.root, env=os.environ | {
                'PATH': f"{self.root}:{os.environ['PATH']}",
                'GITHUB_REPOSITORY': 'fixture/voiceroom',
                'GH_CALLS': str(log),
                'GH_LATEST': latest,
            },
            capture_output=True, text=True,
        )
        calls = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
        return result, calls

    def test_first_meet_release_replaces_legacy_latest_after_upload(self):
        result, calls = self.publish('meet/v1.0.0', 'v2.15.0')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([call[:2] for call in calls[1:]], [
            ['release', 'view'], ['release', 'create'], ['release', 'upload'], ['release', 'edit'],
        ])
        _, _, create, upload, edit = calls
        self.assertIn('--draft', create)
        self.assertEqual(create[create.index('--title') + 1], 'VoiceRoom Meet 1.0.0')
        notes = create[create.index('--notes') + 1]
        self.assertIn('fix(meet): installer fixture', notes)
        self.assertNotIn('fix(web): unrelated change', notes)
        self.assertIn('sh -s -- upgrade', notes)
        self.assertEqual([Path(asset).name for asset in upload[4:]], [
            'docker-compose.personal.yml', 'install.sh', 'manifest.json',
        ])
        self.assertIn('--latest=true', edit)

    def test_old_meet_release_cannot_replace_latest(self):
        result, calls = self.publish('meet/v1.0.0', 'meet/v1.0.10')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('--latest=false', calls[-1])

    def test_other_release_series_are_refused_without_calling_github(self):
        result, calls = self.publish('api/v1.0.0', 'meet/v1.0.0')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, [])
