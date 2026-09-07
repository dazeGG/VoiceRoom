"""Process configuration, read once from the environment.

Two rules encoded here, both from the work plan:

* `MUSIC_BOT_SECRET` is mandatory and must be at least
  `SECRET_MIN_LENGTH` characters. The control API is authenticated by a shared
  secret, never by network topology, so booting without one would publish an
  unauthenticated control plane, and booting with a guessable one is barely
  better. The floor matches `MUSIC_BOT_SECRET_MIN_LENGTH` in
  `apps/api/src/domains/music/music-bot-client.js`, so a too-short secret fails
  at both ends of the control plane rather than disabling music on the API side
  while the bot happily serves it. Either failure is a hard boot failure.
* `MUSIC_BOT_SOURCES` is validated at boot for the same reason: an unknown
  name there is a typo in a deployment, and a typo that silently disables a
  source would show up much later as "that link just stopped working". An
  unknown name is a hard boot failure, exactly like a missing secret.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass

from .links import SOURCES

DEFAULT_PORT = 8080
#: Mirrors `MUSIC_BOT_SECRET_MIN_LENGTH` in
#: `apps/api/src/domains/music/music-bot-client.js`. Both ends must agree, or an
#: operator gets a service that boots against a secret its peer refuses to use.
SECRET_MIN_LENGTH = 32
DEFAULT_LIVEKIT_URL = "ws://livekit:7880"
DEFAULT_API_URL = "http://api:3000"

# Fixed by the plan: heartbeat every 2s; the API marks a position stale after 6s.
DEFAULT_HEARTBEAT_INTERVAL_MS = 2000
DEFAULT_HEARTBEAT_FAILURE_LIMIT = 5

# Playlist expansion ceiling (AC-6). The API enforces the same number; sending
# more would only be discarded there.
DEFAULT_EXPAND_LIMIT = 50

# The sources a deployment inside Russia can actually reach. YouTube is left out
# because it is blocked there; `MUSIC_BOT_PROXY` is the switch that adds it back,
# and an operator elsewhere can list it explicitly.
DEFAULT_SOURCES: tuple[str, ...] = ("vk", "rutube")


class ConfigError(RuntimeError):
    """Raised when the process cannot legally start."""


@dataclass(frozen=True)
class Config:
    secret: str
    host: str = "0.0.0.0"
    port: int = DEFAULT_PORT
    log_level: str = "info"
    livekit_url: str = DEFAULT_LIVEKIT_URL
    api_base_url: str = DEFAULT_API_URL
    #: Which of `MUSIC_SOURCES` this deployment will actually resolve. A link
    #: from any other source is refused with `source_unavailable`.
    sources: tuple[str, ...] = DEFAULT_SOURCES
    #: Egress proxy for the resolver and for ffmpeg's own fetches. Bot egress
    #: only - it never applies to the control plane or to LiveKit.
    proxy: str | None = None
    max_rooms: int = 8
    heartbeat_interval_ms: int = DEFAULT_HEARTBEAT_INTERVAL_MS
    heartbeat_failure_limit: int = DEFAULT_HEARTBEAT_FAILURE_LIMIT
    callback_timeout_ms: int = 3000
    resolve_timeout_ms: int = 10000
    expand_limit: int = DEFAULT_EXPAND_LIMIT
    ffmpeg_binary: str = "ffmpeg"

    @property
    def heartbeat_interval_s(self) -> float:
        return self.heartbeat_interval_ms / 1000

    @property
    def callback_timeout_s(self) -> float:
        return self.callback_timeout_ms / 1000

    @property
    def resolve_timeout_s(self) -> float:
        return self.resolve_timeout_ms / 1000

    def source_enabled(self, source: str) -> bool:
        return source in self.sources


def _int(env: Mapping[str, str], key: str, fallback: int, *, minimum: int = 1) -> int:
    raw = (env.get(key) or "").strip()
    if not raw:
        return fallback
    try:
        value = int(raw)
    except ValueError as exc:
        raise ConfigError(f"{key} must be an integer, got {raw!r}") from exc
    if value < minimum:
        raise ConfigError(f"{key} must be >= {minimum}, got {value}")
    return value


def _str(env: Mapping[str, str], key: str, fallback: str) -> str:
    raw = (env.get(key) or "").strip()
    return raw or fallback


def _sources(env: Mapping[str, str], *, proxy: str | None) -> tuple[str, ...]:
    """Read `MUSIC_BOT_SOURCES`, or derive the default from `MUSIC_BOT_PROXY`.

    Unset means the defaults, plus `youtube` when a proxy is configured -
    setting the proxy is the single switch that turns YouTube back on, because
    a proxy is the only reason a Russian host can reach it at all. An explicit
    list always wins, including one that names `youtube` with no proxy: a
    deployment outside Russia reaches it directly.
    """

    raw = (env.get("MUSIC_BOT_SOURCES") or "").strip()
    if not raw:
        if proxy and "youtube" not in DEFAULT_SOURCES:
            return (*DEFAULT_SOURCES, "youtube")
        return DEFAULT_SOURCES

    names: list[str] = []
    for chunk in raw.split(","):
        name = chunk.strip().lower()
        if not name:
            continue
        if name not in SOURCES:
            raise ConfigError(
                f"MUSIC_BOT_SOURCES lists unknown source {name!r}; "
                f"known sources are {', '.join(SOURCES)}"
            )
        if name not in names:
            names.append(name)
    if not names:
        raise ConfigError(
            "MUSIC_BOT_SOURCES is set but names no source; unset it for the "
            f"default ({', '.join(DEFAULT_SOURCES)}) instead of emptying it."
        )
    return tuple(names)


def load_config(env: Mapping[str, str] | None = None) -> Config:
    source: Mapping[str, str] = os.environ if env is None else env

    secret = (source.get("MUSIC_BOT_SECRET") or "").strip()
    if not secret:
        raise ConfigError(
            "MUSIC_BOT_SECRET is required: the control API is authenticated by a "
            "shared secret, not by network placement."
        )
    if len(secret) < SECRET_MIN_LENGTH:
        raise ConfigError(
            f"MUSIC_BOT_SECRET must be at least {SECRET_MIN_LENGTH} characters "
            f"(got {len(secret)}); the API applies the same floor and disables "
            "music entirely below it."
        )

    proxy = (source.get("MUSIC_BOT_PROXY") or "").strip() or None
    sources = _sources(source, proxy=proxy)

    return Config(
        secret=secret,
        host=_str(source, "HOST", "0.0.0.0"),
        port=_int(source, "PORT", DEFAULT_PORT),
        log_level=_str(source, "LOG_LEVEL", "info"),
        livekit_url=_str(source, "LIVEKIT_INTERNAL_URL", DEFAULT_LIVEKIT_URL),
        api_base_url=_str(source, "MUSIC_BOT_API_URL", DEFAULT_API_URL).rstrip("/"),
        sources=sources,
        proxy=proxy,
        max_rooms=_int(source, "MUSIC_BOT_MAX_ROOMS", 8),
        heartbeat_interval_ms=_int(
            source, "MUSIC_BOT_HEARTBEAT_INTERVAL_MS", DEFAULT_HEARTBEAT_INTERVAL_MS, minimum=250
        ),
        heartbeat_failure_limit=_int(
            source, "MUSIC_BOT_HEARTBEAT_FAILURE_LIMIT", DEFAULT_HEARTBEAT_FAILURE_LIMIT
        ),
        callback_timeout_ms=_int(source, "MUSIC_BOT_CALLBACK_TIMEOUT_MS", 3000, minimum=100),
        resolve_timeout_ms=_int(source, "MUSIC_BOT_RESOLVE_TIMEOUT_MS", 10000, minimum=100),
        expand_limit=_int(source, "MUSIC_BOT_EXPAND_LIMIT", DEFAULT_EXPAND_LIMIT),
        ffmpeg_binary=_str(source, "FFMPEG_BINARY", "ffmpeg"),
    )
