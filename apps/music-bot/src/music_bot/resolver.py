"""Source resolution via yt-dlp, isolated behind a narrow protocol.

Two operations, deliberately separated:

* `expand()` turns a link into queue metadata. The API calls this once, when the
  link is enqueued. It never processes formats, so it never produces a media
  URL that could be cached.
* `stream_url()` produces a direct audio URL for exactly one item. Media URLs
  from all three sources expire - VK and YouTube sign them with a short TTL - so
  this is called immediately before the item starts playing and never at enqueue
  time.

Everything yt-dlp does is synchronous and slow: a single extraction is a
handful of blocking HTTPS round trips, and on a bad day a full TCP timeout. It
therefore runs in a bounded thread pool and every call is fenced by
`resolve_timeout_ms`. If it ran on the event loop instead, heartbeats would
stall and the API's watchdog would tear down a room that is playing fine.

`UnavailableResolver` is the degraded implementation: it never touches the
network and raises `UnavailableError` for everything, which is what keeps the
service booting and answering when yt-dlp itself is missing from the image.
"""

from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Protocol

from .errors import (
    NOT_FOUND,
    RESOLVE_FAILED,
    RESOLVER_UNAVAILABLE,
    SOURCE_UNAVAILABLE,
    UnavailableError,
)
from .links import LinkKind, ParsedLink, Source, parse_link, parse_track_id

LOGGER = logging.getLogger(__name__)

#: Audio-only first, at the best available bitrate; a muxed stream only if the
#: source publishes no audio-only format at all (Rutube and VK often do not).
#: ffmpeg discards the video track with `-vn`, so the fallback still plays - it
#: just costs bandwidth, which is why it is the fallback and not the selector.
AUDIO_FORMAT = "bestaudio/best"

#: ffmpeg is given `-protocol_whitelist https,tls,tcp`; this is the other half
#: of that check, applied to a URL that came from an upstream response rather
#: than from us.
_ALLOWED_STREAM_SCHEMES = ("https://",)

# yt-dlp reports failures as prose, and the same exception class covers a
# removed video, a geo-block and a DNS failure. The substrings below are matched
# against the lowercased message, most specific group first.
_GEO_OR_WALL_MARKERS = (
    # yt-dlp's YouTube wording is "The uploader has not made this video
    # available in your country", so the marker matches the tail, not the
    # negation that precedes it.
    "available in your country",
    "available from your location",
    "geo restricted",
    "geo-restricted",
    "blocked in your country",
    "sign in to confirm",
    "confirm you're not a bot",
    "confirm you are not a bot",
    "captcha",
    "login required",
    "requires authentication",
    "sign in to view",
    "only available for registered",
)
_NOT_FOUND_MARKERS = (
    "video unavailable",
    "this video is unavailable",
    "has been removed",
    "was deleted",
    "does not exist",
    "not found",
    "is private",
    "private video",
    "no longer available",
    "http error 404",
    "http error 410",
    "unable to find",
)
_NETWORK_MARKERS = (
    "urlopen error",
    "getaddrinfo",
    "name or service not known",
    "temporary failure in name resolution",
    "connection refused",
    "connection reset",
    "connection aborted",
    "timed out",
    "timeout",
    "unable to connect",
    "network is unreachable",
    "ssl",
    "http error 403",
    "http error 429",
    "http error 5",
)


@dataclass(frozen=True)
class ResolvedTrack:
    track_id: str
    title: str
    artists: tuple[str, ...] = ()
    duration_ms: int = 0
    source: str = ""
    video_id: str | None = None
    cover_url: str | None = None

    def to_json(self) -> dict[str, Any]:
        return {
            "trackId": self.track_id,
            "title": self.title,
            "artists": list(self.artists),
            "durationMs": self.duration_ms,
            "source": self.source,
            "videoId": self.video_id,
            "coverUrl": self.cover_url,
        }


@dataclass(frozen=True)
class ResolvedLink:
    kind: LinkKind
    source: str
    source_id: str
    title: str
    items: tuple[ResolvedTrack, ...] = field(default=())
    total_available: int = 0
    truncated: bool = False

    def to_json(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "source": self.source,
            "sourceId": self.source_id,
            "title": self.title,
            "totalAvailable": self.total_available,
            "truncated": self.truncated,
            "items": [item.to_json() for item in self.items],
        }


class Resolver(Protocol):
    @property
    def available(self) -> bool: ...

    async def expand(self, link: ParsedLink, limit: int) -> ResolvedLink: ...

    async def stream_url(self, track_id: str) -> str: ...

    async def close(self) -> None: ...


class UnavailableResolver:
    """Stand-in used when yt-dlp cannot be loaded."""

    def __init__(self, code: str = RESOLVER_UNAVAILABLE, message: str = "") -> None:
        self._code = code
        self._message = message or "the media resolver is not available"

    @property
    def available(self) -> bool:
        return False

    async def expand(self, link: ParsedLink, limit: int) -> ResolvedLink:
        raise UnavailableError(self._message, code=self._code)

    async def stream_url(self, track_id: str) -> str:
        raise UnavailableError(self._message, code=self._code)

    async def close(self) -> None:
        return None


def classify_failure(exc: BaseException) -> tuple[str, str]:
    """Map a yt-dlp failure onto a contract error code.

    A geo-block, a bot wall, a DNS failure and a removed video all arrive as the
    same `DownloadError`, so the message is what separates them. Anything
    unrecognised stays `resolve_failed`: a room degrading is always preferable to
    a room crashing, and every branch here ends in a 503, never an exception that
    escapes.
    """

    name = type(exc).__name__
    text = str(exc).lower()
    if name == "GeoRestrictedError":
        return SOURCE_UNAVAILABLE, "the source will not serve this deployment"
    if any(marker in text for marker in _GEO_OR_WALL_MARKERS):
        return SOURCE_UNAVAILABLE, "the source will not serve this deployment"
    if any(marker in text for marker in _NOT_FOUND_MARKERS):
        return NOT_FOUND, "the source has nothing playable at that link"
    if any(marker in text for marker in _NETWORK_MARKERS):
        return SOURCE_UNAVAILABLE, "the source is not reachable from this deployment"
    return RESOLVE_FAILED, "the source could not be resolved"


def _text(value: Any, fallback: str = "") -> str:
    if value is None:
        return fallback
    text = str(value).strip()
    return text or fallback


def _duration_ms(info: dict[str, Any]) -> int:
    raw = info.get("duration")
    try:
        seconds = float(raw)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0
    if seconds != seconds or seconds in (float("inf"), float("-inf")) or seconds < 0:
        return 0
    return int(seconds * 1000)


def _artists(info: dict[str, Any]) -> tuple[str, ...]:
    """Best-effort performer names.

    Only YouTube Music reliably fills `artist`; everywhere else the channel or
    uploader is the closest true thing, and an empty tuple is better than a
    guess, because the API renders this straight into the queue row.
    """

    for key in ("artists", "artist", "creators", "creator"):
        raw = info.get(key)
        if isinstance(raw, (list, tuple)):
            names = tuple(_text(name) for name in raw if _text(name))
            if names:
                return names
        elif _text(raw):
            return tuple(part.strip() for part in str(raw).split(",") if part.strip())
    for key in ("channel", "uploader"):
        name = _text(info.get(key))
        if name:
            return (name,)
    return ()


def _cover_url(info: dict[str, Any]) -> str | None:
    """Pick a thumbnail, https only.

    The API re-validates covers at the contract boundary and drops anything that
    is not https; sending one that will be dropped is just noise, so it is
    filtered here too. A missing cover is never fatal - it is decorative.
    """

    candidates: list[str] = []
    thumbnail = _text(info.get("thumbnail"))
    if thumbnail:
        candidates.append(thumbnail)
    raw = info.get("thumbnails")
    if isinstance(raw, list):
        for entry in raw:
            if isinstance(entry, dict):
                url = _text(entry.get("url"))
                if url:
                    candidates.append(url)
    for candidate in candidates:
        if candidate.lower().startswith("https://"):
            return candidate
    return None


def pick_stream_url(info: dict[str, Any]) -> str | None:
    """Pull the selected media URL out of a processed extraction.

    yt-dlp normally resolves the format selector itself and leaves the winner in
    `url`. When it does not - a multi-format merge, or an extractor that only
    fills `formats` - the audio-only format with the highest bitrate is chosen
    here, applying the same preference as `AUDIO_FORMAT` rather than taking
    whatever happens to be first.
    """

    direct = _text(info.get("url"))
    if direct:
        return direct

    requested = info.get("requested_downloads")
    if isinstance(requested, list):
        for entry in requested:
            if isinstance(entry, dict):
                url = _text(entry.get("url"))
                if url:
                    return url

    formats = info.get("formats")
    if not isinstance(formats, list):
        return None
    audio_only: list[dict[str, Any]] = []
    muxed: list[dict[str, Any]] = []
    for entry in formats:
        if not isinstance(entry, dict) or not _text(entry.get("url")):
            continue
        if _text(entry.get("acodec"), "none") == "none":
            continue
        if _text(entry.get("vcodec"), "none") == "none":
            audio_only.append(entry)
        else:
            muxed.append(entry)

    def bitrate(entry: dict[str, Any]) -> float:
        for key in ("abr", "tbr"):
            try:
                return float(entry[key])
            except (KeyError, TypeError, ValueError):
                continue
        return 0.0

    pool = audio_only or muxed
    if not pool:
        return None
    return _text(max(pool, key=bitrate).get("url")) or None


class YtDlpResolver:
    """Live resolver backed by yt-dlp, one instance per process."""

    def __init__(
        self,
        sources: tuple[str, ...],
        *,
        proxy: str | None = None,
        timeout_s: float = 10.0,
        max_workers: int = 4,
        ydl_factory: Any | None = None,
    ) -> None:
        self._sources = tuple(sources)
        self._proxy = proxy
        self._timeout_s = timeout_s
        self._ydl_factory = ydl_factory
        # Bounded on purpose. `asyncio.wait_for` abandons a blocked extraction
        # but cannot kill the thread running it, so without a ceiling a source
        # that hangs would keep spawning threads for every retry.
        self._executor = ThreadPoolExecutor(
            max_workers=max_workers, thread_name_prefix="ytdlp"
        )
        self._closed = False

    @property
    def available(self) -> bool:
        return not self._closed and bool(self._sources)

    @property
    def sources(self) -> tuple[str, ...]:
        return self._sources

    # ------------------------------------------------------------------ setup

    def _options(self, **extra: Any) -> dict[str, Any]:
        options: dict[str, Any] = {
            "quiet": True,
            "no_warnings": True,
            "noprogress": True,
            "skip_download": True,
            "format": AUDIO_FORMAT,
            # The container runs read-only as uid 10001; yt-dlp's cache would be
            # a write to a directory that does not exist and cannot be created.
            "cachedir": False,
            "socket_timeout": max(self._timeout_s / 2, 1.0),
            "retries": 1,
            "extractor_retries": 1,
            # yt-dlp otherwise turns an extractor failure into a printed warning
            # and a `None` return, which would reach us as an unexplained
            # "nothing found" instead of a classifiable exception.
            "ignoreerrors": False,
            "noplaylist": True,
        }
        if self._proxy:
            options["proxy"] = self._proxy
        options.update(extra)
        return options

    def _extract(self, url: str, options: dict[str, Any]) -> dict[str, Any] | None:
        # `process` is an argument of `extract_info`, not a construction option:
        # it is carried in the same dict only so that one call site describes one
        # extraction. Passing it through to `YoutubeDL(...)` would be silently
        # ignored and every expansion would quietly process formats.
        params = dict(options)
        process = bool(params.pop("process", True))
        if self._ydl_factory is not None:
            ydl = self._ydl_factory(params)
        else:
            from yt_dlp import YoutubeDL

            ydl = YoutubeDL(params)
        with ydl:
            info = ydl.extract_info(url, download=False, process=process)
        return info if isinstance(info, dict) else None

    async def _run(self, url: str, options: dict[str, Any]) -> dict[str, Any] | None:
        loop = asyncio.get_running_loop()
        future = loop.run_in_executor(self._executor, self._extract, url, options)
        try:
            return await asyncio.wait_for(future, timeout=self._timeout_s)
        except TimeoutError as exc:
            raise UnavailableError(
                f"resolving timed out after {self._timeout_s:.0f}s",
                code=SOURCE_UNAVAILABLE,
            ) from exc
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            code, message = classify_failure(exc)
            LOGGER.info("resolve failed (%s): %s", code, exc)
            raise UnavailableError(message, code=code) from exc

    def _require_source(self, source: str) -> None:
        if source not in self._sources:
            raise UnavailableError(
                f"{source} is not enabled on this deployment "
                f"(MUSIC_BOT_SOURCES={','.join(self._sources) or 'none'})",
                code=SOURCE_UNAVAILABLE,
            )

    # -------------------------------------------------------------- expansion

    async def expand(self, link: ParsedLink, limit: int) -> ResolvedLink:
        self._require_source(link.source)
        if limit < 1:
            limit = 1
        if link.kind == "playlist":
            return await self._expand_playlist(link, limit)
        return await self._expand_video(link)

    async def _expand_video(self, link: ParsedLink) -> ResolvedLink:
        # `process=False` is what keeps this cheap and, more importantly, what
        # keeps it from producing a media URL at enqueue time.
        info = await self._run(
            link.canonical_url, self._options(process=False, extract_flat=False)
        )
        if not info:
            raise UnavailableError("the link resolved to nothing", code=NOT_FOUND)
        item = self._to_track(info, link.source, fallback_id=link.video_id)
        if item is None:
            raise UnavailableError("the link resolved to nothing", code=NOT_FOUND)
        return ResolvedLink(
            kind="video",
            source=link.source,
            source_id=link.track_id,
            title=item.title,
            items=(item,),
            total_available=1,
            truncated=False,
        )

    async def _expand_playlist(self, link: ParsedLink, limit: int) -> ResolvedLink:
        # One extra entry past the limit is requested so `truncated` is a fact
        # rather than an inference from a list that stopped exactly at `limit`.
        info = await self._run(
            link.canonical_url,
            self._options(
                extract_flat="in_playlist",
                noplaylist=False,
                playlist_items=f"1:{limit + 1}",
            ),
        )
        if not info:
            raise UnavailableError("the playlist resolved to nothing", code=NOT_FOUND)

        entries = [entry for entry in (info.get("entries") or []) if isinstance(entry, dict)]
        items: list[ResolvedTrack] = []
        for entry in entries:
            track = self._to_track(entry, link.source)
            if track is not None:
                items.append(track)
        if not items:
            raise UnavailableError("the playlist has nothing playable", code=NOT_FOUND)

        reported = info.get("playlist_count")
        total = reported if isinstance(reported, int) and reported >= len(items) else len(items)
        return ResolvedLink(
            kind="playlist",
            source=link.source,
            source_id=link.track_id,
            title=_text(info.get("title"), "Playlist"),
            items=tuple(items[:limit]),
            total_available=total,
            truncated=total > limit,
        )

    def _to_track(
        self, info: dict[str, Any], source: Source | str, *, fallback_id: str | None = None
    ) -> ResolvedTrack | None:
        """Turn one extraction (or one flat playlist entry) into a queue item.

        The id is taken from the entry's own URL where there is one, so that a
        playlist entry pointing at a different site - or at a shape this bot does
        not support - is dropped rather than queued under an id that would fail
        at play time.
        """

        ref: ParsedLink | None = None
        for candidate in (info.get("webpage_url"), info.get("original_url"), info.get("url")):
            if not isinstance(candidate, str) or not candidate.strip():
                continue
            try:
                ref = parse_link(candidate)
            except Exception:  # noqa: BLE001 - an unparseable entry is skipped, not fatal
                continue
            break

        if ref is None:
            raw_id = _text(info.get("id"), fallback_id or "")
            if not raw_id:
                return None
            try:
                ref = parse_track_id(f"{source}:video:{raw_id}")
            except Exception:  # noqa: BLE001 - a malformed id is skipped, not fatal
                return None

        if ref.source != source or ref.kind != "video":
            return None

        return ResolvedTrack(
            track_id=ref.track_id,
            title=_text(info.get("title"), "Unknown track"),
            artists=_artists(info),
            duration_ms=_duration_ms(info),
            source=ref.source,
            video_id=ref.video_id,
            cover_url=_cover_url(info),
        )

    # ------------------------------------------------------------- stream url

    async def stream_url(self, track_id: str) -> str:
        ref = parse_track_id(track_id)
        if ref.kind != "video":
            raise UnavailableError(
                "a playlist has no stream of its own", code=RESOLVE_FAILED
            )
        self._require_source(ref.source)

        info = await self._run(ref.canonical_url, self._options(process=True))
        if not info:
            raise UnavailableError("the item resolved to nothing", code=NOT_FOUND)
        url = pick_stream_url(info)
        if not url:
            raise UnavailableError("no playable audio format", code=RESOLVE_FAILED)
        # Checked, not assumed: this string is handed straight to ffmpeg and it
        # comes from an upstream response rather than from us. `build_command`
        # whitelists the protocol on its side too; this is the other half.
        if not url.lower().startswith(_ALLOWED_STREAM_SCHEMES):
            raise UnavailableError(
                "the source returned a non-https stream link", code=RESOLVE_FAILED
            )
        return url

    async def close(self) -> None:
        self._closed = True
        # `cancel_futures` drops queued work; an extraction already running in a
        # thread is abandoned rather than joined, so shutdown is not held hostage
        # by a source that stopped answering.
        self._executor.shutdown(wait=False, cancel_futures=True)


def build_resolver(
    sources: tuple[str, ...],
    *,
    proxy: str | None = None,
    timeout_s: float = 10.0,
    ydl_factory: Any | None = None,
) -> Resolver:
    if ydl_factory is None:
        try:
            import yt_dlp  # noqa: F401
        except ImportError as exc:
            LOGGER.error("yt-dlp is not installed: music will answer unavailable (%s)", exc)
            return UnavailableResolver(
                RESOLVER_UNAVAILABLE, "yt-dlp is not installed in this image"
            )
    return YtDlpResolver(
        sources, proxy=proxy, timeout_s=timeout_s, ydl_factory=ydl_factory
    )
