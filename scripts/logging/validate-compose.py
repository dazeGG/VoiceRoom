#!/usr/bin/env python3
"""Check resolved Compose logging without printing its secret-bearing environment."""
import json
import sys

EXPECTED = {
    "syslog-address": "unixgram:///run/systemd/journal.voiceroom/dev-log",
    "tag": "voiceroom/{{.Name}}/{{.ID}}",
    "mode": "non-blocking",
    "max-buffer-size": "4m",
    "cache-disabled": "true",
}


def validate(config):
    services = config.get("services", {})
    if not isinstance(services, dict) or not services:
        raise ValueError("resolved Compose contains no services")
    for name, service in services.items():
        logging = service.get("logging", {})
        if logging.get("driver") != "syslog" or logging.get("options") != EXPECTED:
            raise ValueError(f"service {name} does not use the isolated persistent log configuration")
    return len(services)


if __name__ == "__main__":
    try:
        count = validate(json.load(sys.stdin))
    except (ValueError, TypeError, AttributeError) as error:
        print(f"logging preflight failed: {error}", file=sys.stderr)
        sys.exit(1)
    print(f"persistent logging configured for {count} services")
