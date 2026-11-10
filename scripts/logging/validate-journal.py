#!/usr/bin/env python3
"""Validate the effective namespace-only journal settings, including later drop-ins."""
import configparser
import sys

EXPECTED = {
    "Storage": "persistent",
    "Compress": "yes",
    "SystemMaxUse": "512M",
    "SystemKeepFree": "2G",
    "SystemMaxFileSize": "16M",
    "MaxRetentionSec": "14day",
    "MaxFileSec": "1h",
    "RuntimeMaxUse": "32M",
    "SyncIntervalSec": "30s",
    "RateLimitIntervalSec": "30s",
    "RateLimitBurst": "50000",
    "ForwardToSyslog": "no",
    "ForwardToKMsg": "no",
    "ForwardToConsole": "no",
    "ForwardToWall": "no",
}


if __name__ == "__main__":
    try:
        config = configparser.ConfigParser(strict=False, interpolation=None)
        config.read_string(sys.stdin.read())
        for key, expected in EXPECTED.items():
            if config.get("Journal", key, fallback=None) != expected:
                raise ValueError(f"unexpected effective VoiceRoom journal setting: {key}")
    except (ValueError, configparser.Error) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    print("persistent journal limits and namespace isolation verified")
