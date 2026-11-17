#!/usr/bin/env python3
"""Record capabilities declared by inspected immutable release image digests."""
import json
import os
import pathlib
import subprocess
import sys


def build_manifest(images, inspect):
    releases = {}
    for image in images:
        metadata = inspect(image)
        capabilities = metadata.get('Config', {}).get('Labels', {}) or {}
        if capabilities.get('org.voiceroom.capabilities') != 'widget-boundary-v1':
            continue
        for digest in metadata.get('RepoDigests') or []:
            releases[digest] = ['widget-boundary-v1']
    return {'releases': releases}


if __name__ == '__main__':
    destination, *images = sys.argv[1:]
    manifest = build_manifest(images, lambda image: json.loads(subprocess.check_output(
        ['docker', 'image', 'inspect', image], text=True, stdin=subprocess.DEVNULL, timeout=30))[0])
    temporary = pathlib.Path(destination + '.tmp')
    temporary.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    os.replace(temporary, destination)
