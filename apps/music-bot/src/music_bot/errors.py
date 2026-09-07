"""Error codes shared by the inbound control API and the outbound callbacks.

The codes are part of the API <-> bot contract: `apps/api` maps them onto the
`MusicSession` status and the error codes declared in
`packages/shared/src/room-music.mjs`.
"""

from __future__ import annotations

# Client errors (4xx).
INVALID_REQUEST = "invalid_request"
INVALID_LINK = "invalid_link"
UNAUTHORIZED = "unauthorized"
STALE_EPOCH = "stale_epoch"
ROOM_CAPACITY_EXCEEDED = "room_capacity_exceeded"

# Degraded states (503). The API turns these into `unavailable`, except
# `source_unavailable`, which it surfaces as itself: it is the one code in this
# block that is also a client-facing code in `MUSIC_ERROR_CODES`.
#
# `source_unavailable` means the link was well formed and its source is known,
# but this deployment cannot use it - either the source is not in
# `MUSIC_BOT_SOURCES`, or it is and the site refused us (geo-block, bot wall,
# DNS). Deliberately not `invalid_link`: the link is fine, and telling a person
# to fix it sends them after the wrong thing.
SOURCE_UNAVAILABLE = "source_unavailable"
#: The resolver itself could not be built - yt-dlp missing from the image. The
#: service still boots and still answers; every resolve and play degrades.
RESOLVER_UNAVAILABLE = "resolver_unavailable"
RESOLVE_FAILED = "resolve_failed"
NOT_FOUND = "not_found"
STREAM_FAILED = "stream_failed"
PUBLISH_FAILED = "publish_failed"


class MusicBotError(Exception):
    """Base error carrying a contract error code and an HTTP status."""

    status = 500
    code = "internal_error"

    def __init__(self, message: str = "", *, code: str | None = None) -> None:
        super().__init__(message or (code or self.code))
        if code is not None:
            self.code = code
        self.message = message or self.code


class InvalidRequestError(MusicBotError):
    status = 400
    code = INVALID_REQUEST


class InvalidLinkError(MusicBotError):
    status = 400
    code = INVALID_LINK


class StaleEpochError(MusicBotError):
    status = 409
    code = STALE_EPOCH


class RoomCapacityExceededError(MusicBotError):
    status = 429
    code = ROOM_CAPACITY_EXCEEDED


class UnavailableError(MusicBotError):
    """Anything that must degrade the room into `unavailable` (AC-9)."""

    status = 503
    code = SOURCE_UNAVAILABLE
