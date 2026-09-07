from __future__ import annotations

from dataclasses import replace

import pytest
from aiohttp.test_utils import TestClient, TestServer

from conftest import (
    SECRET,
    FakeApi,
    FakeProcess,
    FakePublisher,
    FakeResolver,
    SpawnRecorder,
    decoder_factory_from,
    play_body,
    resolved_playlist,
    silence,
)
from music_bot.config import Config, load_config
from music_bot.control_plane import SECRET_HEADER
from music_bot.errors import (
    INVALID_LINK,
    INVALID_REQUEST,
    RESOLVER_UNAVAILABLE,
    ROOM_CAPACITY_EXCEEDED,
    SOURCE_UNAVAILABLE,
    STALE_EPOCH,
    UNAUTHORIZED,
    UnavailableError,
)
from music_bot.resolver import UnavailableResolver
from music_bot.server import build_app

AUTH = {SECRET_HEADER: SECRET}


async def make_client(
    config: Config,
    *,
    resolver: FakeResolver | None = None,
    api: FakeApi | None = None,
    recorder: SpawnRecorder | None = None,
) -> TestClient:
    app = build_app(
        config,
        resolver=resolver if resolver is not None else FakeResolver(expand=resolved_playlist()),
        api=api or FakeApi(),  # type: ignore[arg-type]
        publisher_factory=FakePublisher,
        decoder_factory=decoder_factory_from(recorder or SpawnRecorder()),
    )
    client = TestClient(TestServer(app))
    await client.start_server()
    return client


@pytest.fixture
async def client(config: Config):
    created = await make_client(config)
    yield created
    await created.close()


# ------------------------------------------------------------------- /healthz


async def test_healthz_needs_no_secret_and_reports_readiness(client: TestClient) -> None:
    response = await client.get("/healthz")
    assert response.status == 200
    assert await response.json() == {
        "status": "ok",
        "resolver": "ready",
        # Which sources this deployment serves is an operational fact the bot
        # owns; the wire contract lists all three regardless.
        "sources": ["vk", "rutube"],
        "proxy": False,
        "rooms": 0,
        "maxRooms": 2,
    }


async def test_healthz_reports_the_configured_sources_and_proxy() -> None:
    config = load_config(
        {
            "MUSIC_BOT_SECRET": SECRET,
            "MUSIC_BOT_MAX_ROOMS": "2",
            "MUSIC_BOT_PROXY": "http://egress:3128",
        }
    )
    client = await make_client(config)
    try:
        body = await (await client.get("/healthz")).json()
    finally:
        await client.close()
    assert body["sources"] == ["vk", "rutube", "youtube"]
    # The proxy URL itself never leaves the process: it can carry credentials.
    assert body["proxy"] is True
    assert "3128" not in str(body)


async def test_healthz_still_answers_when_the_resolver_is_unavailable(
    config: Config,
) -> None:
    client = await make_client(config, resolver=UnavailableResolver())
    try:
        body = await (await client.get("/healthz")).json()
    finally:
        await client.close()
    assert body["status"] == "ok"
    assert body["resolver"] == "unavailable"


# ---------------------------------------------------------------------- auth


@pytest.mark.parametrize(
    ("method", "path"),
    [("POST", "/resolve"), ("POST", "/sessions/room-1/play"), ("DELETE", "/sessions/room-1")],
)
async def test_control_routes_require_the_shared_secret(
    client: TestClient, method: str, path: str
) -> None:
    response = await client.request(method, path, json={})
    assert response.status == 401
    assert (await response.json())["error"] == UNAUTHORIZED


async def test_a_wrong_secret_is_rejected(client: TestClient) -> None:
    response = await client.post(
        "/resolve", json={"link": "x"}, headers={SECRET_HEADER: "wrong"}
    )
    assert response.status == 401


async def test_a_non_ascii_secret_is_a_clean_401_not_a_500(client: TestClient) -> None:
    # aiohttp hands header values back latin-1-decoded, and `hmac.compare_digest`
    # raises TypeError on a `str` holding any codepoint above U+007F. Comparing
    # the decoded strings would turn this crafted header into an unhandled 500,
    # which both looks like a crash and tells the caller something about the
    # secret it should not learn from a status code.
    for raw in ("ééé", "ÿ" * 40, "секрет".encode().decode("latin-1")):
        response = await client.post(
            "/resolve", json={"link": "x"}, headers={SECRET_HEADER: raw}
        )
        assert response.status == 401, f"{raw!r} should be rejected, not crash"
        assert (await response.json())["error"] == UNAUTHORIZED


async def test_the_configured_secret_still_authenticates(client: TestClient) -> None:
    # The byte comparison must not break the happy path: a resolve with the real
    # secret gets past auth (and fails later, on the link, with a 4xx that is
    # not 401).
    response = await client.post(
        "/resolve", json={"link": "https://vk.com/video-1_2"}, headers=AUTH
    )
    assert response.status != 401


# ------------------------------------------------------------------- /resolve


async def test_resolve_expands_a_playlist(config: Config) -> None:
    resolver = FakeResolver(expand=resolved_playlist(3))
    client = await make_client(config, resolver=resolver)
    try:
        response = await client.post(
            "/resolve",
            json={"link": "https://vk.com/playlist/-1_9"},
            headers=AUTH,
        )
        body = await response.json()
    finally:
        await client.close()

    assert response.status == 200
    assert body["kind"] == "playlist"
    assert body["source"] == "vk"
    assert body["sourceId"] == "vk:playlist:-1_9"
    assert body["truncated"] is False
    assert len(body["items"]) == 3
    # `trackId` is the shared contract's `MusicTrackRef.id`, so the API can
    # dedupe on it and hand the same string back in a play request.
    assert body["items"][0] == {
        "trackId": "vk:video:-1_0",
        "title": "Track 0",
        "artists": ["Artist"],
        "durationMs": 180000,
        "source": "vk",
        "videoId": "-1_0",
        "coverUrl": "https://cdn.example/cover.jpg",
    }
    assert resolver.expand_calls[0][0].source == "vk"
    assert resolver.expand_calls[0][1] == config.expand_limit


async def test_resolve_clamps_the_limit_to_the_configured_ceiling(config: Config) -> None:
    resolver = FakeResolver(expand=resolved_playlist(1))
    client = await make_client(config, resolver=resolver)
    try:
        await client.post(
            "/resolve",
            json={"link": "https://vk.com/playlist/-1_9", "limit": 5000},
            headers=AUTH,
        )
    finally:
        await client.close()
    assert resolver.expand_calls[0][1] == config.expand_limit


@pytest.mark.parametrize(
    "link",
    [
        "https://example.com/video-1_2",
        "",
        "https://vk.com/audio-1_2",
        "https://rutube.ru/video/tooshort/",
    ],
)
async def test_resolve_rejects_a_bad_link_with_invalid_link(
    client: TestClient, link: str
) -> None:
    response = await client.post("/resolve", json={"link": link}, headers=AUTH)
    assert response.status == 400
    assert (await response.json())["error"] == INVALID_LINK


async def test_resolve_rejects_a_non_object_body(client: TestClient) -> None:
    response = await client.post("/resolve", json=["nope"], headers=AUTH)
    assert response.status == 400
    assert (await response.json())["error"] == INVALID_REQUEST


async def test_resolve_answers_unavailable_when_the_resolver_is_missing(
    config: Config,
) -> None:
    client = await make_client(config, resolver=UnavailableResolver())
    try:
        response = await client.post(
            "/resolve", json={"link": "https://vk.com/video-1_2"}, headers=AUTH
        )
        body = await response.json()
    finally:
        await client.close()

    assert response.status == 503
    assert body["status"] == "unavailable"
    assert body["error"] == RESOLVER_UNAVAILABLE


async def test_a_link_from_a_disabled_source_is_not_an_invalid_link(
    config: Config,
) -> None:
    # End to end: the link parses, so it must not come back as `invalid_link`.
    # The resolver is what knows which sources this deployment can reach, and
    # `source_unavailable` is the code the client renders as "not reachable from
    # here" rather than "you pasted a bad link".
    resolver = FakeResolver(
        expand_error=UnavailableError("youtube is not enabled", code=SOURCE_UNAVAILABLE)
    )
    client = await make_client(config, resolver=resolver)
    try:
        response = await client.post(
            "/resolve", json={"link": "https://youtu.be/dQw4w9WgXcQ"}, headers=AUTH
        )
        body = await response.json()
    finally:
        await client.close()

    assert response.status == 503
    assert body["status"] == "unavailable"
    assert body["error"] == SOURCE_UNAVAILABLE
    assert body["error"] != INVALID_LINK


# ---------------------------------------------------------------------- /play


async def test_play_starts_a_session(config: Config) -> None:
    recorder = SpawnRecorder(FakeProcess(silence(2)))
    client = await make_client(config, recorder=recorder)
    try:
        response = await client.post(
            "/sessions/room-1/play", json=play_body(epoch=3, item_id="q1"), headers=AUTH
        )
        body = await response.json()
    finally:
        await client.close()

    assert response.status == 202
    assert body["status"] == "playing"
    assert body["roomId"] == "room-1"
    assert body["sessionEpoch"] == 3
    assert body["itemId"] == "q1"
    assert body["identity"] == "music-bot:room-abc"
    assert body["roomName"] == "vr_room-abc"


async def test_play_answers_unavailable_when_the_resolver_is_missing(
    config: Config,
) -> None:
    client = await make_client(config, resolver=UnavailableResolver())
    try:
        response = await client.post("/sessions/room-1/play", json=play_body(), headers=AUTH)
        body = await response.json()
    finally:
        await client.close()

    assert response.status == 503
    assert body["status"] == "unavailable"
    assert body["error"] == RESOLVER_UNAVAILABLE


async def test_play_rejects_a_malformed_body(client: TestClient) -> None:
    body = play_body()
    del body["livekit"]["token"]
    response = await client.post("/sessions/room-1/play", json=body, headers=AUTH)
    assert response.status == 400
    assert (await response.json())["error"] == INVALID_REQUEST


async def test_play_rejects_a_non_json_body(client: TestClient) -> None:
    response = await client.post(
        "/sessions/room-1/play",
        data="not json",
        headers={**AUTH, "Content-Type": "application/json"},
    )
    assert response.status == 400
    assert (await response.json())["error"] == INVALID_REQUEST


async def test_play_with_an_older_epoch_is_rejected_as_stale(config: Config) -> None:
    recorder = SpawnRecorder(FakeProcess(silence(400), streaming=True))
    client = await make_client(config, recorder=recorder)
    try:
        await client.post("/sessions/room-1/play", json=play_body(epoch=5), headers=AUTH)
        response = await client.post(
            "/sessions/room-1/play", json=play_body(epoch=4), headers=AUTH
        )
        body = await response.json()
    finally:
        await client.close()

    assert response.status == 409
    assert body["error"] == STALE_EPOCH


async def test_room_ceiling_returns_429(config: Config) -> None:
    config = replace(config, max_rooms=1)
    recorder = SpawnRecorder(FakeProcess(silence(400), streaming=True))
    client = await make_client(config, recorder=recorder)
    try:
        await client.post("/sessions/room-1/play", json=play_body(), headers=AUTH)
        response = await client.post("/sessions/room-2/play", json=play_body(), headers=AUTH)
        body = await response.json()
    finally:
        await client.close()

    assert response.status == 429
    assert body["error"] == ROOM_CAPACITY_EXCEEDED


# -------------------------------------------------------------------- /delete


async def test_delete_stops_a_session_and_is_idempotent(config: Config) -> None:
    process = FakeProcess(silence(400), streaming=True)
    client = await make_client(config, recorder=SpawnRecorder(process))
    try:
        await client.post("/sessions/room-1/play", json=play_body(), headers=AUTH)

        first = await client.delete("/sessions/room-1", headers=AUTH)
        second = await client.delete("/sessions/room-1", headers=AUTH)
        first_body = await first.json()
        second_body = await second.json()
    finally:
        await client.close()

    assert first.status == 200
    assert first_body == {"status": "idle", "roomId": "room-1", "stopped": True}
    assert second_body["stopped"] is False
    assert process.terminated is True


async def test_delete_with_an_older_epoch_is_rejected(config: Config) -> None:
    client = await make_client(
        config, recorder=SpawnRecorder(FakeProcess(silence(400), streaming=True))
    )
    try:
        await client.post("/sessions/room-1/play", json=play_body(epoch=9), headers=AUTH)
        response = await client.delete("/sessions/room-1?sessionEpoch=8", headers=AUTH)
        body = await response.json()
    finally:
        await client.close()

    assert response.status == 409
    assert body["error"] == STALE_EPOCH


async def test_delete_with_a_non_numeric_epoch_is_rejected(client: TestClient) -> None:
    response = await client.delete("/sessions/room-1?sessionEpoch=abc", headers=AUTH)
    assert response.status == 400
    assert (await response.json())["error"] == INVALID_REQUEST


async def test_unknown_route_is_404(client: TestClient) -> None:
    response = await client.get("/nope", headers=AUTH)
    assert response.status == 404


async def test_an_unexpected_crash_becomes_a_500_and_not_a_dead_service(
    config: Config,
) -> None:
    # An error the code does not model at all - not a MusicBotError.
    resolver = FakeResolver(stream_error=RuntimeError("kaboom"))
    client = await make_client(config, resolver=resolver)
    try:
        response = await client.post("/sessions/room-1/play", json=play_body(), headers=AUTH)
        body = await response.json()
        # The service is still answering afterwards.
        health = await client.get("/healthz")
    finally:
        await client.close()

    assert response.status == 500
    assert body["error"] == "internal_error"
    assert health.status == 200
