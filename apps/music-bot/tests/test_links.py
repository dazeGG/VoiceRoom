"""Link parsing.

The expectations here are taken from `packages/shared/src/room-music.mjs`: each
canonical URL below is what `buildTrackRef` produces for the same input, and
each `track_id` is its `MusicTrackRef.id`. That is the equivalence the bot
depends on - the API stores the shared module's ids and hands them back here -
so it is asserted directly rather than described in a comment.
"""

from __future__ import annotations

import pytest

from music_bot.errors import InvalidLinkError
from music_bot.links import parse_link, parse_track_id

# (link, source, kind, entity id, canonical url) - the canonical url column is
# `buildTrackRef(...).sourceUrl` for the same ref in the shared module.
ACCEPTED = [
    # -- VK ---------------------------------------------------------------
    ("https://vk.com/video-1_2", "vk", "video", "-1_2", "https://vkvideo.ru/video-1_2"),
    ("https://vkvideo.ru/video1_2", "vk", "video", "1_2", "https://vkvideo.ru/video1_2"),
    ("https://m.vk.com/clip-1_2", "vk", "video", "-1_2", "https://vkvideo.ru/video-1_2"),
    ("https://vk.ru/video-1_2", "vk", "video", "-1_2", "https://vkvideo.ru/video-1_2"),
    ("https://vkvideo.com/video-1_2", "vk", "video", "-1_2", "https://vkvideo.ru/video-1_2"),
    (
        "https://vk.com/playlist/-1_9",
        "vk",
        "playlist",
        "-1_9",
        "https://vkvideo.ru/playlist/-1_9",
    ),
    (
        "https://vkvideo.ru/video/playlist/-1_9",
        "vk",
        "playlist",
        "-1_9",
        "https://vkvideo.ru/playlist/-1_9",
    ),
    (
        "https://vk.com/feed?z=video-1_2%2Fpl_cat_updates",
        "vk",
        "video",
        "-1_2",
        "https://vkvideo.ru/video-1_2",
    ),
    # -- Rutube -----------------------------------------------------------
    (
        "https://rutube.ru/video/" + "a" * 32 + "/",
        "rutube",
        "video",
        "a" * 32,
        "https://rutube.ru/video/" + "a" * 32 + "/",
    ),
    (
        "https://rutube.ru/shorts/" + "0" * 32 + "/",
        "rutube",
        "video",
        "0" * 32,
        "https://rutube.ru/video/" + "0" * 32 + "/",
    ),
    (
        "https://rutube.ru/play/embed/" + "f" * 32,
        "rutube",
        "video",
        "f" * 32,
        "https://rutube.ru/video/" + "f" * 32 + "/",
    ),
    ("https://rutube.ru/plst/123/", "rutube", "playlist", "123", "https://rutube.ru/plst/123/"),
    # -- YouTube ----------------------------------------------------------
    (
        "https://youtu.be/dQw4w9WgXcQ",
        "youtube",
        "video",
        "dQw4w9WgXcQ",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ),
    (
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "youtube",
        "video",
        "dQw4w9WgXcQ",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ),
    (
        "https://m.youtube.com/shorts/dQw4w9WgXcQ",
        "youtube",
        "video",
        "dQw4w9WgXcQ",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ),
    (
        "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
        "youtube",
        "video",
        "dQw4w9WgXcQ",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ),
    (
        "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
        "youtube",
        "video",
        "dQw4w9WgXcQ",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ),
    (
        "https://www.youtube.com/live/dQw4w9WgXcQ",
        "youtube",
        "video",
        "dQw4w9WgXcQ",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ),
    (
        "https://www.youtube.com/playlist?list=PLabcdefghijklmnop",
        "youtube",
        "playlist",
        "PLabcdefghijklmnop",
        "https://www.youtube.com/playlist?list=PLabcdefghijklmnop",
    ),
]


@pytest.mark.parametrize(("link", "source", "kind", "entity_id", "canonical"), ACCEPTED)
def test_accepted_shapes_match_the_shared_contract(
    link: str, source: str, kind: str, entity_id: str, canonical: str
) -> None:
    parsed = parse_link(link)
    assert parsed.source == source
    assert parsed.kind == kind
    assert parsed.entity_id == entity_id
    assert parsed.track_id == f"{source}:{kind}:{entity_id}"
    assert parsed.canonical_url == canonical
    if kind == "video":
        assert parsed.video_id == entity_id
        assert parsed.playlist_id is None
    else:
        assert parsed.playlist_id == entity_id
        assert parsed.video_id is None


def test_a_watch_link_with_a_list_normalizes_to_the_video() -> None:
    # Deliberate, and shared with `parseYouTubeLink`: that list is almost always
    # an auto-generated `RD...` mix from the address bar, not an intent to queue
    # a playlist. Losing this would silently enqueue 50 unrelated tracks.
    parsed = parse_link("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ")
    assert parsed.kind == "video"
    assert parsed.video_id == "dQw4w9WgXcQ"


@pytest.mark.parametrize(
    "link",
    [
        "vk.com/video-1_2",
        "https://www.vk.com/video-1_2",
        "http://vk.com/video-1_2",
        "  https://vk.com/video-1_2#anchor  ",
        "https://vk.com/video-1_2?from=feed",
    ],
)
def test_tolerated_variations(link: str) -> None:
    assert parse_link(link).track_id == "vk:video:-1_2"


@pytest.mark.parametrize(
    "link",
    [
        "",
        "   ",
        "not a link",
        # Right shape, wrong site.
        "https://example.com/video-1_2",
        "https://vk.com.evil.com/video-1_2",
        "https://rutube.ru.evil.com/video/" + "a" * 32,
        # Right site, wrong shape.
        "https://vk.com/audio-1_2",
        "https://vk.com/video-1",
        "https://vk.com/video-1_2/extra",
        "https://vk.com/playlist/nope",
        "https://rutube.ru/video/tooshort/",
        "https://rutube.ru/video/" + "A" * 32,  # hex ids are lowercase
        "https://rutube.ru/video/" + "a" * 33,
        "https://rutube.ru/plst/abc/",
        "https://www.youtube.com/watch?v=short",
        "https://www.youtube.com/watch?v=twelve_chars",
        "https://youtu.be/dQw4w9WgXcQ/extra",
        "https://www.youtube.com/playlist?list=" + "a" * 65,
        "https://www.youtube.com/channel/UCabc",
        # Wrong scheme.
        "javascript:alert(1)",
        "ftp://vk.com/video-1_2",
        "file:///etc/passwd",
        # Oversized.
        "https://vk.com/video-1_2?" + "a" * 4000,
    ],
)
def test_rejected_links(link: str) -> None:
    with pytest.raises(InvalidLinkError):
        parse_link(link)


@pytest.mark.parametrize("value", [None, 12345, [], {}, True])
def test_non_string_values_are_rejected(value: object) -> None:
    with pytest.raises(InvalidLinkError):
        parse_link(value)


# ------------------------------------------------------------------ track ids


@pytest.mark.parametrize(("link", "source", "kind", "entity_id", "canonical"), ACCEPTED)
def test_canonical_urls_are_stable_under_reparsing(
    link: str, source: str, kind: str, entity_id: str, canonical: str
) -> None:
    # The API sends `sourceUrl` and the bot resolves the canonical URL rebuilt
    # from the id it derived. Those are only the same address if canonicalizing
    # is idempotent, so that is asserted rather than assumed.
    assert parse_link(canonical).canonical_url == canonical
    assert parse_link(canonical).track_id == f"{source}:{kind}:{entity_id}"


@pytest.mark.parametrize(("link", "source", "kind", "entity_id", "canonical"), ACCEPTED)
def test_track_ids_round_trip(
    link: str, source: str, kind: str, entity_id: str, canonical: str
) -> None:
    parsed = parse_link(link)
    assert parse_track_id(parsed.track_id) == parsed


@pytest.mark.parametrize(
    "track_id",
    [
        "",
        "12345",  # a bare Yandex-era id: must fail loudly, not be guessed at
        "vk:-1_2",
        "vk:video",
        "vk:video:-1_2:extra",
        "spotify:video:abc",
        "vk:track:-1_2",
        "vk:video:not-a-pair",
        "youtube:video:short",
        "rutube:video:" + "A" * 32,
    ],
)
def test_malformed_track_ids_are_rejected(track_id: str) -> None:
    with pytest.raises(InvalidLinkError):
        parse_track_id(track_id)


@pytest.mark.parametrize("value", [None, 42, [], {}])
def test_non_string_track_ids_are_rejected(value: object) -> None:
    with pytest.raises(InvalidLinkError):
        parse_track_id(value)
