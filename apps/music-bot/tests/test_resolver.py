"""yt-dlp resolver.

No network and no yt-dlp: a fake `YoutubeDL` stands in, and it records the
options it was constructed with, because most of what this module does *is* the
options - the `process=False` / `process=True` split that keeps a media URL from
being produced at enqueue time, the flat playlist extraction, and the audio
format selection. A fake that only returned canned info would let all three
break silently, so every one of them is asserted on the recorded call.

Failures are classified by message, the way yt-dlp actually reports them: a
removed video, a geo-block and a DNS failure all arrive as the same exception
class.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

import pytest

from music_bot.errors import (
    NOT_FOUND,
    RESOLVE_FAILED,
    RESOLVER_UNAVAILABLE,
    SOURCE_UNAVAILABLE,
    InvalidLinkError,
    UnavailableError,
)
from music_bot.links import parse_link
from music_bot.resolver import (
    UnavailableResolver,
    YtDlpResolver,
    build_resolver,
    classify_failure,
    pick_stream_url,
)


class DownloadError(Exception):
    """Named like yt-dlp's own error, which is what the classifier sees."""


class GeoRestrictedError(Exception):
    pass


class FakeYoutubeDL:
    """Records how it was called and answers from a canned script."""

    def __init__(self, options: dict[str, Any], calls: list[dict[str, Any]], script: Any) -> None:
        self.options = options
        self._calls = calls
        self._script = script

    def __enter__(self) -> FakeYoutubeDL:
        return self

    def __exit__(self, *exc: object) -> bool:
        return False

    def extract_info(self, url: str, download: bool = True, process: bool = True) -> Any:
        self._calls.append(
            {"url": url, "download": download, "process": process, "options": self.options}
        )
        answer = self._script(url) if callable(self._script) else self._script
        if isinstance(answer, BaseException):
            raise answer
        return answer


def resolver_with(
    script: Any,
    *,
    sources: tuple[str, ...] = ("vk", "rutube", "youtube"),
    timeout_s: float = 5.0,
    proxy: str | None = None,
) -> tuple[YtDlpResolver, list[dict[str, Any]]]:
    calls: list[dict[str, Any]] = []

    def factory(options: dict[str, Any]) -> FakeYoutubeDL:
        return FakeYoutubeDL(options, calls, script)

    resolver = YtDlpResolver(
        sources, proxy=proxy, timeout_s=timeout_s, ydl_factory=factory
    )
    return resolver, calls


def video_info(
    url: str = "https://vkvideo.ru/video-1_2",
    *,
    title: str = "Song",
    duration: float | None = 212.0,
    **extra: Any,
) -> dict[str, Any]:
    info: dict[str, Any] = {"webpage_url": url, "title": title, "duration": duration}
    info.update(extra)
    return info


# ---------------------------------------------------------------------- build


def test_build_resolver_falls_back_when_yt_dlp_is_missing(monkeypatch: Any) -> None:
    # yt-dlp is a hard dependency, but an image built without it must still boot
    # and answer, not crash on the first link.
    import builtins

    real_import = builtins.__import__

    def refuse(name: str, *args: Any, **kwargs: Any) -> Any:
        if name == "yt_dlp":
            raise ImportError("no yt_dlp")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", refuse)
    resolver = build_resolver(("vk",))
    assert isinstance(resolver, UnavailableResolver)
    assert resolver.available is False


def test_build_resolver_with_an_injected_factory_is_live() -> None:
    resolver = build_resolver(("vk",), ydl_factory=lambda options: None)
    assert isinstance(resolver, YtDlpResolver)
    assert resolver.available is True


async def test_the_unavailable_resolver_reports_its_code() -> None:
    resolver = UnavailableResolver()
    link = parse_link("https://vk.com/video-1_2")
    for call in (resolver.expand(link, 50), resolver.stream_url("vk:video:-1_2")):
        with pytest.raises(UnavailableError) as excinfo:
            await call
        assert excinfo.value.code == RESOLVER_UNAVAILABLE
        assert excinfo.value.status == 503
    await resolver.close()


# ------------------------------------------------------------ enabled sources


async def test_a_disabled_source_is_refused_as_source_unavailable() -> None:
    # The link is valid and the source is known; this deployment just cannot
    # reach it. Reporting `invalid_link` here would send the user off to fix a
    # link that is not broken.
    resolver, calls = resolver_with(video_info(), sources=("vk", "rutube"))
    link = parse_link("https://youtu.be/dQw4w9WgXcQ")

    with pytest.raises(UnavailableError) as excinfo:
        await resolver.expand(link, 50)
    assert excinfo.value.code == SOURCE_UNAVAILABLE

    with pytest.raises(UnavailableError) as excinfo:
        await resolver.stream_url("youtube:video:dQw4w9WgXcQ")
    assert excinfo.value.code == SOURCE_UNAVAILABLE

    # Nothing was even attempted: a disabled source costs no network call.
    assert calls == []
    await resolver.close()


async def test_an_enabled_source_is_not_refused() -> None:
    resolver, calls = resolver_with(
        video_info("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
        sources=("vk", "rutube", "youtube"),
    )
    resolved = await resolver.expand(parse_link("https://youtu.be/dQw4w9WgXcQ"), 50)
    assert len(calls) == 1
    assert resolved.items[0].track_id == "youtube:video:dQw4w9WgXcQ"
    await resolver.close()


async def test_a_malformed_track_id_is_an_invalid_link_not_a_degradation() -> None:
    resolver, _ = resolver_with(video_info())
    with pytest.raises(InvalidLinkError):
        await resolver.stream_url("12345")
    await resolver.close()


# ------------------------------------------------------------------- expand()


async def test_expanding_a_video_never_processes_formats() -> None:
    # This is the enqueue-time call. Processing here would mint a media URL that
    # expires long before the item plays, which is exactly what the
    # expand/stream_url split exists to prevent.
    resolver, calls = resolver_with(
        video_info(thumbnail="https://cdn.example/c.jpg", channel="Uploader")
    )
    resolved = await resolver.expand(parse_link("https://vk.com/video-1_2"), 50)

    assert calls[0]["url"] == "https://vkvideo.ru/video-1_2"
    assert calls[0]["download"] is False
    assert calls[0]["process"] is False
    assert resolved.kind == "video"
    assert resolved.source == "vk"
    assert resolved.source_id == "vk:video:-1_2"
    assert resolved.total_available == 1
    assert resolved.truncated is False
    item = resolved.items[0]
    assert item.track_id == "vk:video:-1_2"
    assert item.video_id == "-1_2"
    assert item.title == "Song"
    assert item.duration_ms == 212000
    assert item.artists == ("Uploader",)
    assert item.cover_url == "https://cdn.example/c.jpg"
    await resolver.close()


async def test_a_video_that_resolves_to_nothing_is_not_found() -> None:
    resolver, _ = resolver_with(None)
    with pytest.raises(UnavailableError) as excinfo:
        await resolver.expand(parse_link("https://vk.com/video-1_2"), 50)
    assert excinfo.value.code == NOT_FOUND
    await resolver.close()


async def test_a_playlist_is_expanded_flat_and_truncated_at_the_limit() -> None:
    entries = [
        video_info(f"https://rutube.ru/video/{index:032x}/", title=f"Track {index}")
        for index in range(4)
    ]
    resolver, calls = resolver_with(
        {"title": "Mix", "playlist_count": 40, "entries": entries}
    )

    resolved = await resolver.expand(parse_link("https://rutube.ru/plst/123/"), 3)

    options = calls[0]["options"]
    assert options["extract_flat"] == "in_playlist"
    assert options["noplaylist"] is False
    # One past the limit, so `truncated` is observed rather than inferred.
    assert options["playlist_items"] == "1:4"
    assert calls[0]["url"] == "https://rutube.ru/plst/123/"

    assert resolved.kind == "playlist"
    assert resolved.title == "Mix"
    assert len(resolved.items) == 3
    assert resolved.total_available == 40
    assert resolved.truncated is True
    assert [item.title for item in resolved.items] == ["Track 0", "Track 1", "Track 2"]
    assert resolved.items[0].track_id == f"rutube:video:{0:032x}"
    await resolver.close()


async def test_a_short_playlist_is_not_reported_as_truncated() -> None:
    entries = [video_info(f"https://vkvideo.ru/video-1_{i}") for i in range(2)]
    resolver, _ = resolver_with({"title": "Mix", "entries": entries})
    resolved = await resolver.expand(parse_link("https://vk.com/playlist/-1_9"), 50)
    assert resolved.total_available == 2
    assert resolved.truncated is False
    await resolver.close()


async def test_playlist_entries_from_another_site_are_dropped() -> None:
    # A playlist page can carry a cross-posted or embedded entry. Queuing it
    # under this playlist's source would produce an id that fails at play time,
    # long after the person who queued it has stopped watching.
    entries = [
        video_info("https://vkvideo.ru/video-1_1", title="Kept"),
        video_info("https://example.com/whatever", title="Foreign"),
        video_info("https://www.youtube.com/watch?v=dQw4w9WgXcQ", title="Other source"),
        {"title": "No id at all"},
    ]
    resolver, _ = resolver_with({"title": "Mix", "entries": entries})
    resolved = await resolver.expand(parse_link("https://vk.com/playlist/-1_9"), 50)
    assert [item.title for item in resolved.items] == ["Kept"]
    await resolver.close()


async def test_a_flat_entry_identified_only_by_id_is_still_queued() -> None:
    # Flat extraction often gives an id and no resolvable URL. The id is
    # validated against the source's own pattern before it is trusted.
    entries = [
        {"id": "-1_7", "title": "By id"},
        {"id": "not a vk pair", "title": "Rejected"},
    ]
    resolver, _ = resolver_with({"title": "Mix", "entries": entries})
    resolved = await resolver.expand(parse_link("https://vk.com/playlist/-1_9"), 50)
    assert [item.track_id for item in resolved.items] == ["vk:video:-1_7"]
    await resolver.close()


async def test_a_playlist_with_nothing_playable_is_not_found() -> None:
    resolver, _ = resolver_with({"title": "Mix", "entries": []})
    with pytest.raises(UnavailableError) as excinfo:
        await resolver.expand(parse_link("https://vk.com/playlist/-1_9"), 50)
    assert excinfo.value.code == NOT_FOUND
    await resolver.close()


@pytest.mark.parametrize(
    ("cover", "expected"),
    [
        ("https://cdn.example/c.jpg", "https://cdn.example/c.jpg"),
        ("http://cdn.example/c.jpg", None),
        ("//cdn.example/c.jpg", None),
        ("", None),
        (None, None),
    ],
)
async def test_only_https_cover_urls_survive(cover: Any, expected: str | None) -> None:
    # The API drops non-https covers at the contract boundary; sending one that
    # will be dropped is noise. Every case here has a distinct outcome, so a
    # guard that accepted everything would fail this test rather than pass it
    # for want of a non-null fixture.
    info = video_info()
    if cover is not None:
        info["thumbnail"] = cover
    resolver, _ = resolver_with(info)
    resolved = await resolver.expand(parse_link("https://vk.com/video-1_2"), 50)
    assert resolved.items[0].cover_url == expected
    await resolver.close()


async def test_a_thumbnails_list_is_used_when_there_is_no_thumbnail_field() -> None:
    info = video_info(
        thumbnails=[{"url": "http://cdn.example/small.jpg"}, {"url": "https://cdn.example/big.jpg"}]
    )
    resolver, _ = resolver_with(info)
    resolved = await resolver.expand(parse_link("https://vk.com/video-1_2"), 50)
    assert resolved.items[0].cover_url == "https://cdn.example/big.jpg"
    await resolver.close()


@pytest.mark.parametrize(
    ("duration", "expected"),
    [(212.0, 212000), (0, 0), (None, 0), ("nope", 0), (-5, 0), (1.5, 1500)],
)
async def test_durations_degrade_to_zero_rather_than_crashing(
    duration: Any, expected: int
) -> None:
    resolver, _ = resolver_with(video_info(duration=duration))
    resolved = await resolver.expand(parse_link("https://vk.com/video-1_2"), 50)
    assert resolved.items[0].duration_ms == expected
    await resolver.close()


@pytest.mark.parametrize(
    ("info_extra", "expected"),
    [
        ({"artists": ["A", "B"]}, ("A", "B")),
        ({"artist": "A, B"}, ("A", "B")),
        ({"channel": "Chan", "uploader": "Up"}, ("Chan",)),
        ({"uploader": "Up"}, ("Up",)),
        ({}, ()),
    ],
)
async def test_artist_names_prefer_real_credits_over_the_channel(
    info_extra: dict[str, Any], expected: tuple[str, ...]
) -> None:
    resolver, _ = resolver_with(video_info(**info_extra))
    resolved = await resolver.expand(parse_link("https://vk.com/video-1_2"), 50)
    assert resolved.items[0].artists == expected
    await resolver.close()


# --------------------------------------------------------------- stream_url()


async def test_stream_url_processes_formats_and_asks_for_audio() -> None:
    resolver, calls = resolver_with(
        {"url": "https://cdn.example/audio.m4a", "title": "Song"}
    )
    url = await resolver.stream_url("vk:video:-1_2")

    assert url == "https://cdn.example/audio.m4a"
    assert calls[0]["url"] == "https://vkvideo.ru/video-1_2"
    assert calls[0]["process"] is True
    # Audio-only first, muxed only as a fallback. Dropping the `bestaudio` half
    # would pull a full video stream on every track.
    assert calls[0]["options"]["format"] == "bestaudio/best"
    await resolver.close()


def test_format_selection_prefers_audio_only_at_the_highest_bitrate() -> None:
    info = {
        "formats": [
            # First in the list, and the wrong answer: no audio at all.
            {"url": "https://cdn.example/video.mp4", "acodec": "none", "vcodec": "avc1"},
            {"url": "https://cdn.example/low.m4a", "acodec": "mp4a", "vcodec": "none", "abr": 64},
            {"url": "https://cdn.example/hi.m4a", "acodec": "mp4a", "vcodec": "none", "abr": 192},
            {"url": "https://cdn.example/mux.mp4", "acodec": "mp4a", "vcodec": "avc1", "tbr": 900},
        ]
    }
    assert pick_stream_url(info) == "https://cdn.example/hi.m4a"


def test_format_selection_falls_back_to_a_muxed_stream() -> None:
    # Rutube and VK often publish no audio-only format; ffmpeg drops the video
    # with `-vn`, so a muxed stream still plays.
    info = {
        "formats": [
            {"url": "https://cdn.example/video.mp4", "acodec": "none", "vcodec": "avc1"},
            {"url": "https://cdn.example/mux.mp4", "acodec": "mp4a", "vcodec": "avc1", "tbr": 900},
        ]
    }
    assert pick_stream_url(info) == "https://cdn.example/mux.mp4"


def test_format_selection_reports_nothing_when_no_format_carries_audio() -> None:
    info = {"formats": [{"url": "https://cdn.example/v.mp4", "acodec": "none", "vcodec": "avc1"}]}
    assert pick_stream_url(info) is None
    assert pick_stream_url({}) is None


async def test_stream_url_picks_a_format_when_yt_dlp_leaves_the_url_unset() -> None:
    resolver, _ = resolver_with(
        {
            "formats": [
                {"url": "https://cdn.example/v.mp4", "acodec": "none", "vcodec": "avc1"},
                {"url": "https://cdn.example/a.m4a", "acodec": "mp4a", "vcodec": "none", "abr": 96},
            ]
        }
    )
    assert await resolver.stream_url("rutube:video:" + "a" * 32) == "https://cdn.example/a.m4a"
    await resolver.close()


async def test_no_playable_format_degrades_instead_of_returning_nothing() -> None:
    resolver, _ = resolver_with({"formats": []})
    with pytest.raises(UnavailableError) as excinfo:
        await resolver.stream_url("vk:video:-1_2")
    assert excinfo.value.code == RESOLVE_FAILED
    await resolver.close()


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "http://169.254.169.254/latest/meta-data",
        "concat:a|b",
        "//cdn.example/a.m4a",
    ],
)
async def test_a_non_https_stream_url_is_refused(url: str) -> None:
    # This string goes straight to ffmpeg and comes from an upstream response,
    # not from us. `build_command` whitelists protocols on its side too; this is
    # the other half of that check.
    resolver, _ = resolver_with({"url": url})
    with pytest.raises(UnavailableError) as excinfo:
        await resolver.stream_url("vk:video:-1_2")
    assert excinfo.value.code == RESOLVE_FAILED
    await resolver.close()


async def test_a_playlist_id_has_no_stream_of_its_own() -> None:
    resolver, calls = resolver_with({"url": "https://cdn.example/a.m4a"})
    with pytest.raises(UnavailableError) as excinfo:
        await resolver.stream_url("vk:playlist:-1_9")
    assert excinfo.value.code == RESOLVE_FAILED
    assert calls == []
    await resolver.close()


async def test_the_proxy_is_passed_to_the_extractor_when_configured() -> None:
    resolver, calls = resolver_with({"url": "https://cdn.example/a.m4a"}, proxy="http://egress:3128")
    await resolver.stream_url("vk:video:-1_2")
    assert calls[0]["options"]["proxy"] == "http://egress:3128"
    await resolver.close()


async def test_no_proxy_option_is_set_when_none_is_configured() -> None:
    resolver, calls = resolver_with({"url": "https://cdn.example/a.m4a"})
    await resolver.stream_url("vk:video:-1_2")
    assert "proxy" not in calls[0]["options"]
    await resolver.close()


async def test_the_cache_is_disabled_because_the_container_is_read_only() -> None:
    resolver, calls = resolver_with({"url": "https://cdn.example/a.m4a"})
    await resolver.stream_url("vk:video:-1_2")
    assert calls[0]["options"]["cachedir"] is False
    await resolver.close()


# ------------------------------------------------------- threading and timing


async def test_extraction_does_not_run_on_the_event_loop() -> None:
    # yt-dlp is synchronous and slow. On the loop it would stall heartbeats and
    # the API's watchdog would tear down a room that is playing fine.
    def script(url: str) -> dict[str, Any]:
        time.sleep(0.2)
        return {"url": "https://cdn.example/a.m4a"}

    resolver, _ = resolver_with(script, timeout_s=5.0)
    ticks = 0

    async def ticker() -> None:
        nonlocal ticks
        while True:
            await asyncio.sleep(0.01)
            ticks += 1

    task = asyncio.ensure_future(ticker())
    try:
        await resolver.stream_url("vk:video:-1_2")
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        await resolver.close()

    assert ticks >= 5, f"the loop only ticked {ticks} times: extraction blocked it"


async def test_a_slow_extraction_is_fenced_by_the_resolve_timeout() -> None:
    def script(url: str) -> dict[str, Any]:
        time.sleep(2.0)
        return {"url": "https://cdn.example/a.m4a"}

    resolver, _ = resolver_with(script, timeout_s=0.1)
    with pytest.raises(UnavailableError) as excinfo:
        await resolver.stream_url("vk:video:-1_2")
    assert excinfo.value.code == SOURCE_UNAVAILABLE
    assert excinfo.value.status == 503
    await resolver.close()


async def test_close_marks_the_resolver_unavailable() -> None:
    resolver, _ = resolver_with({"url": "https://cdn.example/a.m4a"})
    assert resolver.available is True
    await resolver.close()
    assert resolver.available is False


# ------------------------------------------------------------- classification


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (GeoRestrictedError("blocked"), SOURCE_UNAVAILABLE),
        (DownloadError("The uploader has not made this video available in your country"),
         SOURCE_UNAVAILABLE),
        (DownloadError("Sign in to confirm you're not a bot"), SOURCE_UNAVAILABLE),
        (DownloadError("Video unavailable"), NOT_FOUND),
        (DownloadError("This video has been removed by the uploader"), NOT_FOUND),
        (DownloadError("HTTP Error 404: Not Found"), NOT_FOUND),
        (DownloadError("This video is private"), NOT_FOUND),
        (DownloadError("<urlopen error [Errno -3] Temporary failure in name resolution>"),
         SOURCE_UNAVAILABLE),
        (DownloadError("The read operation timed out"), SOURCE_UNAVAILABLE),
        (DownloadError("HTTP Error 429: Too Many Requests"), SOURCE_UNAVAILABLE),
        (DownloadError("something nobody has seen before"), RESOLVE_FAILED),
        (ValueError("weird"), RESOLVE_FAILED),
    ],
)
def test_failures_are_classified_by_what_the_operator_can_do_about_them(
    error: Exception, expected: str
) -> None:
    code, message = classify_failure(error)
    assert code == expected
    assert message


@pytest.mark.parametrize(
    "error",
    [
        DownloadError("Sign in to confirm you're not a bot"),
        DownloadError("Video unavailable"),
        DownloadError("<urlopen error getaddrinfo failed>"),
        RuntimeError("kaboom"),
    ],
)
async def test_every_extractor_failure_degrades_and_never_escapes(error: Exception) -> None:
    # VK in particular fails as ordinary operational noise. A failure that
    # escaped as anything other than an `UnavailableError` would surface as a
    # 500 and, in `session.play`, would take the room down with it.
    resolver, _ = resolver_with(error)
    for call in (
        resolver.expand(parse_link("https://vk.com/video-1_2"), 50),
        resolver.stream_url("vk:video:-1_2"),
    ):
        with pytest.raises(UnavailableError) as excinfo:
            await call
        assert excinfo.value.status == 503
    await resolver.close()
