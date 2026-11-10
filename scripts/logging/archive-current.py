#!/usr/bin/env python3
"""One-time bounded preservation of existing container-owned logs before recreation."""
import argparse
import datetime
import fcntl
import gzip
import io
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import threading

DESTINATION = Path('/var/lib/voiceroom/log-transition')
RAW_LIMIT = 30 * 1024 * 1024
ARCHIVE_LIMIT = 64 * 1024 * 1024
DURABLE_OPTIONS = {
    'syslog-address': 'unixgram:///run/systemd/journal.voiceroom/dev-log',
    'tag': 'voiceroom/{{.Name}}/{{.ID}}',
    'mode': 'non-blocking',
    'max-buffer-size': '4m',
    'cache-disabled': 'true',
}
STAMP = re.compile(r'^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z) (.*)$')


def command(args, cwd, limit):
    """Bound output in memory even when the Docker daemon returns unexpected data."""
    with subprocess.Popen(args, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT) as process:
        timer = threading.Timer(60, process.kill)
        timer.start()
        output = bytearray()
        try:
            while True:
                chunk = process.stdout.read(65536)
                if not chunk:
                    break
                if len(output) + len(chunk) > limit:
                    raise ValueError('Docker output exceeds the bounded capture limit')
                output.extend(chunk)
            if process.wait() != 0:
                raise ValueError('Docker log capture failed; no container may be recreated')
        finally:
            timer.cancel()
            if process.poll() is None:
                process.kill()
                process.wait()
    return bytes(output)


def clean_line(service, line):
    if service != 'caddy':
        return line
    try:
        event = json.loads(line)
    except ValueError:
        return line
    if not isinstance(event, dict):
        return line
    request = event.get('request')
    if isinstance(request, dict):
        for key in ('uri', 'headers', 'remote_ip', 'remote_port', 'client_ip'):
            request.pop(key, None)
    event.pop('resp_headers', None)
    return json.dumps(event, ensure_ascii=False, separators=(',', ':'))


def archive(deploy_path, destination=DESTINATION, max_raw_bytes=RAW_LIMIT, max_archive_bytes=ARCHIVE_LIMIT, now=None):
    destination = Path(destination)
    info = destination.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o007:
        raise ValueError('archive directory must be an existing private directory, not a symlink')
    lock = os.open(destination / '.lock', os.O_CREAT | os.O_WRONLY | os.O_NOFOLLOW, 0o640)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        now = now or datetime.datetime.now(datetime.timezone.utc)
        since = now - datetime.timedelta(days=14)
        cutoff = since.strftime('%Y-%m-%dT%H:%M:%SZ')
        initial_size = sum(entry.stat().st_size for entry in destination.iterdir() if entry.is_file() and not entry.is_symlink())
        if initial_size > max_archive_bytes:
            raise ValueError('existing transition archive exceeds its total size cap')
        ids = command(['docker', 'compose', 'ps', '--all', '--quiet'], deploy_path, 65536).decode().split()
        total_records = total_raw = containers = durable_containers = 0
        for container_id in ids:
            if not re.fullmatch(r'[a-f0-9]{12,64}', container_id):
                raise ValueError('unexpected Compose container identifier')
            metadata = json.loads(command([
                'docker', 'inspect', '--format',
                '{"id":{{json .Id}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},'
                '"loggingType":{{json .HostConfig.LogConfig.Type}},"loggingOptions":{{json .HostConfig.LogConfig.Config}}}',
                container_id
            ], deploy_path, 65536))
            if not isinstance(metadata, dict):
                raise ValueError('unexpected container metadata')
            service = metadata.get('service')
            container_id = metadata.get('id')
            if not isinstance(service, str) or not re.fullmatch(r'[a-z][a-z0-9-]{0,63}', service):
                raise ValueError('unexpected Compose service label')
            if not isinstance(container_id, str) or not re.fullmatch(r'[a-f0-9]{64}', container_id):
                raise ValueError('unexpected full container identifier')
            logging_type = metadata.get('loggingType')
            if logging_type == 'syslog' and metadata.get('loggingOptions') == DURABLE_OPTIONS:
                # A partial rollout may already have durable containers with
                # Docker's cache disabled. Their history is in the journal.
                durable_containers += 1
                continue
            if logging_type not in ('json-file', 'local'):
                raise ValueError('unverified log destination; transition capture must stop')
            raw = command(['docker', 'logs', '--since', cutoff, '--timestamps', container_id], deploy_path, max_raw_bytes)
            total_raw += len(raw)
            used = sum(entry.stat().st_size for entry in destination.iterdir() if entry.is_file() and not entry.is_symlink())
            remaining = max_archive_bytes - used
            if remaining < 0:
                raise ValueError('existing transition archive exceeds its total size cap')
            compressed = io.BytesIO()
            oldest = None
            records = 0
            with gzip.GzipFile(fileobj=compressed, mode='wb', filename='', mtime=0) as output:
                for raw_line in io.BytesIO(raw):
                    line = raw_line.decode('utf-8', errors='replace').rstrip('\r\n')
                    if not line:
                        continue
                    match = STAMP.fullmatch(line)
                    if not match:
                        raise ValueError('captured log line has no original Docker timestamp')
                    stamp, message = match.groups()
                    # Docker uses RFC3339Nano (0..9 fractional digits); Python
                    # 3.10 on Ubuntu 22.04 accepts only 3 or 6. Preserve the
                    # original stamp in the record, normalize only for expiry.
                    seconds, dot, fraction = stamp[:-1].partition('.')
                    normalized = seconds + ('.' + fraction.ljust(6, '0')[:6] if dot else '')
                    at = datetime.datetime.fromisoformat(normalized + '+00:00')
                    if at < since:
                        continue
                    if at > now + datetime.timedelta(minutes=5):
                        raise ValueError('future Docker timestamp would defeat archive expiry')
                    oldest = at if oldest is None else min(oldest, at)
                    record = {'at': stamp, 'service': service, 'containerId': container_id, 'line': clean_line(service, message)}
                    output.write((json.dumps(record, ensure_ascii=False, separators=(',', ':')) + '\n').encode())
                    records += 1
                    if compressed.tell() > remaining:
                        raise ValueError('transition archive exceeds its total size cap')
            if not records:
                continue
            content = compressed.getvalue()
            if len(content) > remaining:
                raise ValueError('transition archive exceeds its total size cap')
            descriptor, temporary = tempfile.mkstemp(prefix='.pending-', suffix='.jsonl.gz', dir=destination)
            try:
                with os.fdopen(descriptor, 'wb') as file:
                    os.fchmod(file.fileno(), 0o640)
                    file.write(content)
                    file.flush()
                    os.utime(file.fileno(), (oldest.timestamp(), oldest.timestamp()))
                    os.fsync(file.fileno())
                os.replace(temporary, destination / f'{service}-{container_id}.jsonl.gz')
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
            containers += 1
            total_records += records
        size = sum(entry.stat().st_size for entry in destination.iterdir() if entry.is_file() and not entry.is_symlink())
        directory = os.open(destination, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
        return {'containers': containers, 'durableContainers': durable_containers, 'records': total_records,
                'rawBytes': total_raw, 'archiveBytes': size}
    finally:
        os.close(lock)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('deploy_path')
    args = parser.parse_args()
    try:
        result = archive(Path(args.deploy_path).resolve(strict=True))
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        # Docker output and captured application records can contain private data.
        parser.exit(1, f'log transition capture failed ({type(error).__name__}); activation must stop\n')
    print(json.dumps(result))
