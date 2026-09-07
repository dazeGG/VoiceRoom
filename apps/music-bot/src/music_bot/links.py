"""Link parsing for the three supported video sources.

Mirrors the shapes normalised by `normalizeMusicLink` in
`packages/shared/src/room-music.mjs`:

    VK      /video<owner>_<id>, /clip<owner>_<id>, /playlist/<owner>_<id>,
            /video/playlist/<owner>_<id>, ?z=video<owner>_<id>...
    Rutube  /video/<32 hex>/, /shorts/<32 hex>/, /play/embed/<32 hex>, /plst/<digits>/
    YouTube youtu.be/<11>, /watch?v=<11>, /shorts|/embed|/live|/v/<11>,
            /playlist?list=<id>

The shared package is the authority for what the *client* may submit; this
module exists so the bot never trusts a link it was handed and never has to
guess an id out of a free-form string. It is a second reader of the same shapes,
not a second authority - see `parse_link` for where the two can still differ and
what that costs.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal, get_args
from urllib.parse import parse_qs, urlsplit

from .errors import InvalidLinkError

Source = Literal["vk", "rutube", "youtube"]
LinkKind = Literal["video", "playlist"]

#: Mirrors `MUSIC_SOURCES`. Order is the shared module's order, and
#: `parse_link` resolves a host against the sources in this order too.
SOURCES: tuple[Source, ...] = get_args(Source)

# Mirrors `MUSIC_SOURCE_HOSTS`. Keyed the same way, values in the same order.
SOURCE_HOSTS: dict[Source, tuple[str, ...]] = {
    "vk": ("vk.com", "vk.ru", "m.vk.com", "vkvideo.ru", "vkvideo.com"),
    "rutube": ("rutube.ru",),
    "youtube": (
        "youtube.com",
        "m.youtube.com",
        "music.youtube.com",
        "youtube-nocookie.com",
        "youtu.be",
    ),
}

# Mirrors `MUSIC_CANONICAL_HOSTS`: one host per source, so that equal refs
# compare equal and `canonical_url` rebuilds exactly what `buildTrackRef` built.
CANONICAL_HOSTS: dict[Source, str] = {
    "vk": "vkvideo.ru",
    "rutube": "rutube.ru",
    "youtube": "www.youtube.com",
}

# Mirrors the id patterns in the shared module, character for character.
_VK_PAIR = re.compile(r"^-?[0-9]{1,20}_[0-9]{1,20}$")
_RUTUBE_VIDEO = re.compile(r"^[0-9a-f]{32}$")
_RUTUBE_PLAYLIST = re.compile(r"^[0-9]{1,20}$")
_YOUTUBE_VIDEO = re.compile(r"^[A-Za-z0-9_-]{11}$")
_YOUTUBE_PLAYLIST = re.compile(r"^[A-Za-z0-9_-]{2,64}$")

ID_PATTERNS: dict[Source, dict[LinkKind, re.Pattern[str]]] = {
    "vk": {"video": _VK_PAIR, "playlist": _VK_PAIR},
    "rutube": {"video": _RUTUBE_VIDEO, "playlist": _RUTUBE_PLAYLIST},
    "youtube": {"video": _YOUTUBE_VIDEO, "playlist": _YOUTUBE_PLAYLIST},
}

# The `?z=` form the VK feed still emits. Unanchored at the tail exactly like
# the shared regex: the parameter carries a `%2F<list>` suffix after the pair.
_VK_Z = re.compile(r"^(?:video|clip)(-?[0-9]{1,20}_[0-9]{1,20})")
_VK_PATH_VIDEO = re.compile(r"^(?:video|clip)(-?[0-9]{1,20}_[0-9]{1,20})$")

#: Mirrors `MUSIC_LINK_MAX_LENGTH`.
_MAX_LINK_LENGTH = 2048
_SCHEME = re.compile(r"^[a-z][a-z0-9+.-]*://", re.IGNORECASE)


def is_source(value: object) -> bool:
    return isinstance(value, str) and value in SOURCES


@dataclass(frozen=True)
class ParsedLink:
    """A source-aware reference to one video or one playlist."""

    source: Source
    kind: LinkKind
    video_id: str | None = None
    playlist_id: str | None = None

    @property
    def entity_id(self) -> str:
        """The bare per-source id (`-1_2`, 32 hex, an 11-char YouTube id)."""

        value = self.video_id if self.kind == "video" else self.playlist_id
        assert value is not None
        return value

    @property
    def track_id(self) -> str:
        """The canonical `<source>:<kind>:<id>`.

        Identical to `MusicTrackRef.id` in the shared contract, so the ids the
        bot hands back from `/resolve` are the same strings the API dedupes on
        and the same strings it sends back in a play request.
        """

        return f"{self.source}:{self.kind}:{self.entity_id}"

    @property
    def source_id(self) -> str:
        """Alias kept for the `/resolve` response field of the same name."""

        return self.track_id

    @property
    def canonical_url(self) -> str:
        """Rebuild the one URL per ref, matching `buildTrackRef`.

        Every accepted id has already matched a pattern above, and each of those
        alphabets is a subset of the unreserved URL characters - which is what
        makes the interpolation safe: no accepted id can carry a `?`, `&`, `#`
        or `/` into the URL and change what it addresses.
        """

        host = CANONICAL_HOSTS[self.source]
        if self.kind == "video":
            if self.source == "vk":
                return f"https://{host}/video{self.video_id}"
            if self.source == "rutube":
                return f"https://{host}/video/{self.video_id}/"
            return f"https://{host}/watch?v={self.video_id}"
        if self.source == "vk":
            return f"https://{host}/playlist/{self.playlist_id}"
        if self.source == "rutube":
            return f"https://{host}/plst/{self.playlist_id}/"
        return f"https://{host}/playlist?list={self.playlist_id}"


def _build(source: Source, kind: LinkKind, entity_id: str) -> ParsedLink:
    if kind == "video":
        return ParsedLink(source=source, kind="video", video_id=entity_id)
    return ParsedLink(source=source, kind="playlist", playlist_id=entity_id)


def _reject(reason: str) -> InvalidLinkError:
    return InvalidLinkError(f"not a supported music link: {reason}")


def _matches(source: Source, kind: LinkKind, value: str) -> bool:
    return bool(ID_PATTERNS[source][kind].match(value))


def _parse_vk(segments: list[str], query: dict[str, list[str]]) -> ParsedLink | None:
    head = (segments[0] if segments else "").lower()

    if len(segments) == 1:
        match = _VK_PATH_VIDEO.match(head)
        if match:
            return _build("vk", "video", match.group(1))

    playlist_id = ""
    if head == "playlist":
        playlist_id = segments[1] if len(segments) > 1 else ""
    elif head == "video" and len(segments) > 1 and segments[1].lower() == "playlist":
        playlist_id = segments[2] if len(segments) > 2 else ""
    if playlist_id and _matches("vk", "playlist", playlist_id):
        return _build("vk", "playlist", playlist_id)

    z_values = query.get("z") or [""]
    z_match = _VK_Z.match(z_values[0])
    if z_match:
        return _build("vk", "video", z_match.group(1))
    return None


def _parse_rutube(segments: list[str]) -> ParsedLink | None:
    head = (segments[0] if segments else "").lower()
    second = segments[1] if len(segments) > 1 else ""

    if head in ("video", "shorts") and _matches("rutube", "video", second):
        return _build("rutube", "video", second)
    if head == "play" and second.lower() == "embed":
        third = segments[2] if len(segments) > 2 else ""
        if _matches("rutube", "video", third):
            return _build("rutube", "video", third)
    if head == "plst" and _matches("rutube", "playlist", second):
        return _build("rutube", "playlist", second)
    return None


def _parse_youtube(
    host: str, segments: list[str], query: dict[str, list[str]]
) -> ParsedLink | None:
    if host == "youtu.be":
        if len(segments) == 1 and _matches("youtube", "video", segments[0]):
            return _build("youtube", "video", segments[0])
        return None

    head = (segments[0] if segments else "").lower()
    if head == "watch" and len(segments) == 1:
        # `watch?v=X&list=Y` deliberately normalises to the video: on YouTube
        # that list is usually an auto-generated `RD...` mix rather than an
        # intent to queue. The shared parser makes the same choice.
        video_id = (query.get("v") or [""])[0]
        if _matches("youtube", "video", video_id):
            return _build("youtube", "video", video_id)
        return None
    if len(segments) == 2 and head in ("shorts", "embed", "live", "v"):
        if _matches("youtube", "video", segments[1]):
            return _build("youtube", "video", segments[1])
        return None
    if head == "playlist" and len(segments) == 1:
        playlist_id = (query.get("list") or [""])[0]
        if _matches("youtube", "playlist", playlist_id):
            return _build("youtube", "playlist", playlist_id)
    return None


def parse_link(raw: object) -> ParsedLink:
    """Parse a VK / Rutube / YouTube link. Raises `InvalidLinkError`.

    The only caller today is `POST /resolve`, and the API always sends
    `trackRef.sourceUrl` - a string *rebuilt* by `buildTrackRef` in
    `packages/shared/src/room-music.mjs` after that module validated the user's
    raw input. So what arrives here is already on a canonical host and already
    known to match the shared rules.

    The rules below are a deliberate transcription of the shared ones: the same
    host lists, the same id patterns, the same path shapes, the same
    lowercase-the-head-segment-but-not-the-id treatment, and the same choice to
    ignore `list=` beside `watch?v=`. The previous Yandex-era version of this
    module diverged in five places because ids were matched with
    `str.isdigit()`; ids are pattern-matched now, so those divergences are gone.

    One difference remains and cannot be removed from here: URL parsing itself.
    The shared module uses WHATWG `new URL`, this one uses `urllib.parse`. They
    disagree about malformed input - backslashes as separators, stray control
    characters, some percent-encodings and some IDNA hosts - so a *hostile*
    string can still be read differently by the two sides.

    **So: raw, user-supplied links must be normalized upstream first.** That is
    a property of the caller, not of this function. A new endpoint, a CLI, or a
    test harness that hands this function a link straight from a person
    reintroduces the mismatch: the bot would act on refs the shared contract
    rejects, and the API would have no record of them.
    """

    if not isinstance(raw, str):
        raise _reject("value is not a string")

    candidate = raw.strip()
    if not candidate or len(candidate) > _MAX_LINK_LENGTH:
        raise _reject("empty or oversized")

    if not _SCHEME.match(candidate):
        candidate = f"https://{candidate}"

    split = urlsplit(candidate)
    if split.scheme not in ("http", "https"):
        raise _reject(f"unsupported scheme {split.scheme!r}")

    host = (split.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]

    source: Source | None = next(
        (name for name in SOURCES if host in SOURCE_HOSTS[name]), None
    )
    if source is None:
        raise _reject(f"unsupported host {host!r}")

    segments = [segment for segment in split.path.split("/") if segment]
    query = parse_qs(split.query, keep_blank_values=True)

    if source == "vk":
        parsed = _parse_vk(segments, query)
    elif source == "rutube":
        parsed = _parse_rutube(segments)
    else:
        parsed = _parse_youtube(host, segments, query)

    if parsed is None:
        raise _reject(f"unrecognised {source} path {split.path!r}")
    return parsed


def parse_track_id(raw: object) -> ParsedLink:
    """Parse a canonical `<source>:<kind>:<id>` back into a `ParsedLink`.

    This is the inverse of `ParsedLink.track_id`, and it is how `stream_url`
    turns the id the API stored at enqueue time back into a URL to resolve. It
    is strict on purpose: a bare id with no source prefix is not accepted, so a
    caller that has not been updated to the source-aware contract fails loudly
    instead of being guessed at.
    """

    if not isinstance(raw, str):
        raise _reject("track id is not a string")
    parts = raw.strip().split(":")
    if len(parts) != 3:
        raise _reject(f"track id {raw!r} is not '<source>:<kind>:<id>'")
    source, kind, entity_id = parts
    if source not in SOURCES:
        raise _reject(f"unknown source {source!r}")
    if kind not in ("video", "playlist"):
        raise _reject(f"unknown kind {kind!r}")
    if not _matches(source, kind, entity_id):  # type: ignore[arg-type]
        raise _reject(f"malformed {source} {kind} id")
    return _build(source, kind, entity_id)  # type: ignore[arg-type]
