#!/usr/bin/env python3
"""Prove namespace retention using disposable containers, never the application stack."""
import argparse
import datetime
import json
import subprocess
import time
import uuid

OPTIONS = {
    "syslog-address": "unixgram:///run/systemd/journal.voiceroom/dev-log",
    "tag": "voiceroom/{{.Name}}/{{.ID}}",
    "mode": "non-blocking",
    "max-buffer-size": "4m",
    "cache-disabled": "true",
}


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=30).stdout.strip()


def records(since, tags, namespace=True):
    args = ["journalctl", "--since", since, "--output=json", "--all", "--no-pager"]
    if namespace:
        args.append("--namespace=voiceroom")
    args.extend("SYSLOG_IDENTIFIER=" + tag for tag in tags)
    return [json.loads(line) for line in run(*args).splitlines() if line]


def check_records(rows, tags, marker):
    found = {}
    for row in rows:
        tag = row.get("SYSLOG_IDENTIFIER")
        if tag not in tags:
            continue
        message = json.loads(row["MESSAGE"])
        if message.get("marker") == marker:
            found[tag] = message
    if set(found) != set(tags):
        raise ValueError("both removed container generations must remain readable")
    if found[tags[0]].get("payload") != "x" * 5000:
        raise ValueError("large JSON record was truncated or its syslog envelope was not parsed")


def restart_journal():
    if run("systemctl", "is-active", "docker.service") != "active":
        raise ValueError("Docker must be active before the namespace restart")
    before = run("systemctl", "show", "docker.service", "--property=MainPID", "--value")
    if not before.isdigit() or int(before) == 0:
        raise ValueError("Docker has no active main process")
    run("journalctl", "--namespace=voiceroom", "--sync")
    run("systemctl", "restart", "systemd-journald@voiceroom.service")
    if run("systemctl", "is-active", "docker.service") != "active":
        raise ValueError("namespace restart stopped Docker")
    after = run("systemctl", "show", "docker.service", "--property=MainPID", "--value")
    if after != before:
        raise ValueError("namespace restart changed Docker's main process")
    if run("systemctl", "is-active", "voiceroom-logging.service") != "active":
        raise ValueError("namespace restart deactivated the logging bootstrap")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True, help="already present trusted image with /bin/sh; never pulled")
    parser.add_argument("--restart-journal", action="store_true", help="also restart this namespace (requires root)")
    args = parser.parse_args()
    run("docker", "image", "inspect", args.image)
    marker = uuid.uuid4().hex
    name = "voiceroom-log-smoke-" + marker[:12]
    since = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    tags = []
    container_id = None
    try:
        for generation in range(2):
            message = json.dumps({"evt": "logging.smoke", "marker": marker, "generation": generation,
                                  "payload": "x" * 5000 if generation == 0 else "recreated"})
            command = ["docker", "create", "--name", name, "--network=none", "--log-driver=syslog"]
            for key, value in OPTIONS.items():
                command.extend(["--log-opt", key + "=" + value])
            command.extend(["--entrypoint=/bin/sh", args.image, "-c", 'printf "%s\\n" "$1"', "sh", message])
            container_id = run(*command)
            tags.append("voiceroom/" + name + "/" + container_id[:12])
            run("docker", "start", container_id)
            if run("docker", "wait", container_id) != "0":
                raise ValueError("smoke container failed")
            run("docker", "rm", container_id)
            container_id = None
        # Delivery is asynchronous; bound the wait rather than assuming a sleep is proof.
        for attempt in range(20):
            try:
                check_records(records(since, tags), tags, marker)
                break
            except ValueError:
                if attempt == 19:
                    raise
                time.sleep(0.25)
        if args.restart_journal:
            restart_journal()
            check_records(records(since, tags), tags, marker)
        if records(since, tags, namespace=False):
            raise ValueError("VoiceRoom smoke records leaked into the ordinary host journal")
        print(json.dumps({"ok": True, "removedContainers": 2, "largeRecordBytes": 5000,
                          "journalRestartChecked": args.restart_journal, "hostJournalIsolated": True}))
    finally:
        if container_id:
            subprocess.run(["docker", "rm", "-f", container_id], capture_output=True, timeout=30, check=False)


if __name__ == "__main__":
    main()
