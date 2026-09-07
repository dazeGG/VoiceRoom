from __future__ import annotations

import asyncio
from dataclasses import replace

import pytest

from conftest import (
    FakeApi,
    FakeProcess,
    FakePublisher,
    FakeResolver,
    SpawnRecorder,
    decoder_factory_from,
    play_body,
    silence,
)
from music_bot.config import Config
from music_bot.control_plane import CallbackResult
from music_bot.errors import (
    RESOLVER_UNAVAILABLE,
    STREAM_FAILED,
    InvalidRequestError,
    RoomCapacityExceededError,
    StaleEpochError,
    UnavailableError,
)
from music_bot.resolver import UnavailableResolver
from music_bot.session import PlayRequest, SessionManager


def request_from(body: dict, room_id: str = "room-1") -> PlayRequest:
    return PlayRequest.from_json(room_id, body, default_livekit_url="ws://livekit:7880")


def build_manager(
    config: Config,
    *,
    resolver: FakeResolver | None = None,
    api: FakeApi | None = None,
    recorder: SpawnRecorder | None = None,
    publisher: FakePublisher | None = None,
) -> tuple[SessionManager, FakeResolver, FakeApi, SpawnRecorder, list[FakePublisher]]:
    resolver = resolver or FakeResolver()
    api = api or FakeApi()
    recorder = recorder or SpawnRecorder()
    publishers: list[FakePublisher] = []

    def publisher_factory() -> FakePublisher:
        made = publisher if publisher is not None and not publishers else FakePublisher()
        publishers.append(made)
        return made

    manager = SessionManager(
        config,
        resolver,
        api,  # type: ignore[arg-type]
        publisher_factory=publisher_factory,
        decoder_factory=decoder_factory_from(recorder),
    )
    return manager, resolver, api, recorder, publishers


# --------------------------------------------------------------- request shape


def test_play_request_parses_the_agreed_body() -> None:
    request = request_from(
        play_body(
            epoch=4,
            item_id="q1",
            video_id="-1_7",
            source_url="https://vkvideo.ru/video-1_7",
        )
    )
    assert request.room_id == "room-1"
    assert request.session_epoch == 4
    assert request.item_id == "q1"
    assert request.source == "vk"
    assert request.video_id == "-1_7"
    # Derived from `sourceUrl`, and identical to the shared contract's
    # `MusicTrackRef.id` for the same item.
    assert request.track_id == "vk:video:-1_7"
    assert request.livekit_room == "vr_room-abc"
    assert request.livekit_token == "jwt-token"
    assert request.identity == "music-bot:room-abc"


def test_livekit_url_falls_back_to_the_configured_internal_url() -> None:
    body = play_body()
    del body["livekit"]["url"]
    assert request_from(body).livekit_url == "ws://livekit:7880"


@pytest.mark.parametrize(
    "mutate",
    [
        lambda body: body.pop("sessionEpoch"),
        lambda body: body.__setitem__("sessionEpoch", "1"),
        lambda body: body.__setitem__("sessionEpoch", -1),
        lambda body: body.pop("item"),
        lambda body: body.pop("livekit"),
        lambda body: body["item"].pop("itemId"),
        lambda body: body["item"].pop("source"),
        lambda body: body["item"].pop("videoId"),
        lambda body: body["item"].pop("sourceUrl"),
        lambda body: body["item"].__setitem__("source", "yandex"),
        lambda body: body["item"].__setitem__("source", "rutube"),
        # `sourceUrl` and the declared fields must agree: a disagreement means
        # the two ends of the control plane have drifted.
        lambda body: body["item"].__setitem__("videoId", "-9_9"),
        lambda body: body["item"].__setitem__(
            "sourceUrl", "https://vkvideo.ru/playlist/-1_2"
        ),
        lambda body: body["livekit"].pop("roomName"),
        lambda body: body["livekit"].pop("token"),
        lambda body: body["livekit"].__setitem__("roomName", "  "),
    ],
)
def test_malformed_play_bodies_are_rejected(mutate) -> None:
    body = play_body()
    mutate(body)
    with pytest.raises(InvalidRequestError):
        request_from(body)


def test_play_request_never_derives_the_room_name_itself() -> None:
    # The API applies LIVEKIT_ROOM_PREFIX; the bot must use the name verbatim.
    request = request_from(play_body(room_name="prod-prefix_room-1"))
    assert request.livekit_room == "prod-prefix_room-1"
    assert request.room_id == "room-1"


# ------------------------------------------------------------- unavailable path


async def test_unavailable_resolver_never_touches_the_network() -> None:
    resolver = UnavailableResolver()
    assert resolver.available is False
    with pytest.raises(UnavailableError) as excinfo:
        await resolver.stream_url("1")
    assert excinfo.value.code == RESOLVER_UNAVAILABLE
    assert excinfo.value.status == 503


async def test_play_degrades_to_unavailable_when_the_resolver_is_down(config: Config) -> None:
    resolver = FakeResolver(stream_error=UnavailableError("nope", code=STREAM_FAILED))
    manager, _, _, recorder, _ = build_manager(config, resolver=resolver)

    with pytest.raises(UnavailableError):
        await manager.play(request_from(play_body()))

    assert recorder.commands == []  # no ffmpeg was ever spawned
    assert manager.room_count == 0  # a failed start holds no room slot
    await manager.shutdown()


async def test_resolve_timeout_degrades_instead_of_hanging(config: Config) -> None:
    slow = FakeResolver(stream_delay_s=1.0)
    config = replace(config, resolve_timeout_ms=50)
    manager, _, _, recorder, _ = build_manager(config, resolver=slow)

    with pytest.raises(UnavailableError) as excinfo:
        await manager.play(request_from(play_body()))

    assert excinfo.value.code == STREAM_FAILED
    assert recorder.commands == []
    await manager.shutdown()


# ------------------------------------------------------------------- lifecycle


async def test_stream_url_is_resolved_at_play_time_with_the_requested_track(
    config: Config,
) -> None:
    manager, resolver, _, recorder, publishers = build_manager(
        config, recorder=SpawnRecorder(FakeProcess(silence(3)))
    )

    snapshot = await manager.play(
        request_from(
            play_body(video_id="-9_8", source_url="https://vkvideo.ru/video-9_8")
        )
    )

    # The resolver is asked for the canonical id, never for a URL the bot
    # reconstructed on its own.
    assert resolver.stream_calls == ["vk:video:-9_8"]
    assert recorder.commands[0][recorder.commands[0].index("-i") + 1] == (
        "https://stream.example/track.mp3"
    )
    assert publishers[0].connects == [("ws://livekit:7880", "jwt-token")]
    assert publishers[0].published is True
    assert snapshot["itemId"] == "item-1"
    await manager.shutdown()


async def test_playback_captures_every_frame_and_reports_track_ended(config: Config) -> None:
    manager, _, api, _, publishers = build_manager(
        config, recorder=SpawnRecorder(FakeProcess(silence(4)))
    )

    await manager.play(request_from(play_body(epoch=3, item_id="q7")))
    await _drain(manager, "room-1")

    assert publishers[0].captured == 4
    assert api.track_ended_calls == [
        {
            "roomId": "room-1",
            "session_epoch": 3,
            "item_id": "q7",
            "reason": "completed",
            "position_ms": 40,
            "error_code": None,
        }
    ]
    await manager.shutdown()


async def test_nonzero_ffmpeg_exit_is_reported_as_failed(config: Config) -> None:
    process = FakeProcess(silence(1), exit_code=1)
    manager, _, api, _, _ = build_manager(config, recorder=SpawnRecorder(process))

    await manager.play(request_from(play_body()))
    await _drain(manager, "room-1")

    assert api.track_ended_calls[0]["reason"] == "failed"
    assert api.track_ended_calls[0]["error_code"] == STREAM_FAILED
    await manager.shutdown()


async def test_a_new_item_terminates_the_previous_ffmpeg_before_spawning(
    config: Config,
) -> None:
    first = FakeProcess(silence(500), streaming=True)
    second = FakeProcess(silence(2))
    manager, _, api, recorder, publishers = build_manager(
        config, recorder=SpawnRecorder(first, second)
    )

    await manager.play(request_from(play_body(epoch=1, item_id="a")))
    await manager.play(request_from(play_body(epoch=2, item_id="b")))

    assert first.terminated is True
    assert first.returncode is not None
    assert len(recorder.processes) == 2
    # Skipping must not report the skipped item as finished.
    assert [call["item_id"] for call in api.track_ended_calls] == []
    # The LiveKit connection is reused across items in the same room.
    assert len(publishers) == 1
    assert publishers[0].closes == 0

    await _drain(manager, "room-1")
    assert [call["item_id"] for call in api.track_ended_calls] == ["b"]
    await manager.shutdown()


async def test_older_epoch_is_rejected_as_stale(config: Config) -> None:
    manager, _, _, _, _ = build_manager(
        config, recorder=SpawnRecorder(FakeProcess(silence(200), streaming=True))
    )

    await manager.play(request_from(play_body(epoch=5, item_id="a")))
    with pytest.raises(StaleEpochError):
        await manager.play(request_from(play_body(epoch=4, item_id="b")))

    await manager.shutdown()


async def test_stop_closes_the_room_and_kills_ffmpeg(config: Config) -> None:
    process = FakeProcess(silence(500), streaming=True)
    manager, _, _, _, publishers = build_manager(config, recorder=SpawnRecorder(process))

    await manager.play(request_from(play_body()))
    assert manager.room_count == 1

    assert await manager.stop("room-1") is True

    assert process.terminated is True
    assert publishers[0].closes == 1
    assert manager.room_count == 0
    # Idempotent: stopping an unknown room is not an error.
    assert await manager.stop("room-1") is False


async def test_stop_with_an_older_epoch_is_rejected(config: Config) -> None:
    manager, _, _, _, _ = build_manager(
        config, recorder=SpawnRecorder(FakeProcess(silence(200), streaming=True))
    )
    await manager.play(request_from(play_body(epoch=9)))

    with pytest.raises(StaleEpochError):
        await manager.stop("room-1", 8)

    assert manager.room_count == 1
    await manager.shutdown()


async def test_room_ceiling_is_enforced(config: Config) -> None:
    assert config.max_rooms == 2
    recorder = SpawnRecorder(
        FakeProcess(silence(200), streaming=True),
        FakeProcess(silence(200), streaming=True),
    )
    manager, _, _, _, _ = build_manager(config, recorder=recorder)

    await manager.play(request_from(play_body(), room_id="a"))
    await manager.play(request_from(play_body(), room_id="b"))

    with pytest.raises(RoomCapacityExceededError) as excinfo:
        await manager.play(request_from(play_body(), room_id="c"))

    assert excinfo.value.status == 429
    assert manager.room_count == 2
    await manager.shutdown()


async def test_a_dropped_livekit_connection_is_rebuilt_not_reused(config: Config) -> None:
    # A server-side drop leaves a publisher object that looks usable but swallows
    # every frame. The room must notice and rebuild, or the listener gets silence
    # until the API's watchdog eventually advances the queue.
    recorder = SpawnRecorder(
        FakeProcess(silence(500), streaming=True),
        FakeProcess(silence(2)),
    )
    manager, _, _, _, publishers = build_manager(config, recorder=recorder)

    await manager.play(request_from(play_body(epoch=1, item_id="a")))
    assert len(publishers) == 1

    publishers[0].drop()
    await manager.play(request_from(play_body(epoch=2, item_id="b")))

    assert len(publishers) == 2, "a disconnected publisher must not be reused"
    assert publishers[0].closes == 1, "the dead publisher must be closed, not leaked"
    assert publishers[1].connects == [("ws://livekit:7880", "jwt-token")]
    assert publishers[1].published is True

    await _drain(manager, "room-1")
    assert publishers[1].captured == 2
    await manager.shutdown()


# ------------------------------------------------------------------- heartbeat


async def test_heartbeat_carries_epoch_item_and_position(config: Config) -> None:
    manager, _, api, _, _ = build_manager(
        config, recorder=SpawnRecorder(FakeProcess(silence(400), streaming=True))
    )
    await manager.play(request_from(play_body(epoch=2, item_id="q3")))

    await asyncio.sleep(config.heartbeat_interval_s * 1.5)

    assert api.heartbeats, "expected at least one heartbeat"
    first = api.heartbeats[0]
    assert first["roomId"] == "room-1"
    assert first["session_epoch"] == 2
    assert first["item_id"] == "q3"
    assert isinstance(first["position_ms"], int)
    await manager.shutdown()


async def test_bot_leaves_the_room_after_the_heartbeat_failure_limit(config: Config) -> None:
    api = FakeApi(heartbeat_results=[CallbackResult.FAILED] * 5)
    process = FakeProcess(silence(1000), streaming=True)
    manager, _, _, _, publishers = build_manager(
        config, api=api, recorder=SpawnRecorder(process)
    )

    await manager.play(request_from(play_body()))
    assert manager.room_count == 1

    deadline = config.heartbeat_interval_s * (config.heartbeat_failure_limit + 2)
    await _wait_until(lambda: manager.room_count == 0, deadline)

    assert len(api.heartbeats) == config.heartbeat_failure_limit
    assert process.terminated is True
    assert publishers[0].closes == 1
    assert manager.room_count == 0


async def test_a_single_stale_heartbeat_ends_the_session_immediately(config: Config) -> None:
    api = FakeApi(heartbeat_results=[CallbackResult.STALE])
    process = FakeProcess(silence(1000), streaming=True)
    manager, _, _, _, publishers = build_manager(
        config, api=api, recorder=SpawnRecorder(process)
    )

    await manager.play(request_from(play_body()))
    await _wait_until(lambda: manager.room_count == 0, config.heartbeat_interval_s * 4)

    assert len(api.heartbeats) == 1
    assert process.terminated is True
    assert publishers[0].closes == 1


async def test_an_acknowledged_heartbeat_resets_the_failure_streak(config: Config) -> None:
    api = FakeApi(
        heartbeat_results=[
            CallbackResult.FAILED,
            CallbackResult.FAILED,
            CallbackResult.ACK,
            CallbackResult.FAILED,
            CallbackResult.FAILED,
        ]
    )
    manager, _, _, _, _ = build_manager(
        config, api=api, recorder=SpawnRecorder(FakeProcess(silence(1000), streaming=True))
    )
    await manager.play(request_from(play_body()))

    await asyncio.sleep(config.heartbeat_interval_s * 5.5)

    # Without the reset, three of these five failures in a row would have ended
    # the session before the fifth heartbeat was ever sent.
    assert len(api.heartbeats) >= 5
    assert manager.room_count == 1, "streak must reset on an acknowledged heartbeat"
    session = manager.get("room-1")
    assert session is not None
    assert session.heartbeat_failures < config.heartbeat_failure_limit
    await manager.shutdown()


async def test_a_finished_item_stops_heartbeating_until_the_next_play(
    config: Config,
) -> None:
    # The API answers `track-ended` before it advances the queue, so between the
    # ACK and the next `play` its `sessionEpoch`/current item have already moved
    # on. Any heartbeat sent in that window comes back stale and would take the
    # bot out of the room in the middle of the queue - the listener hears music
    # cut out between songs. Every heartbeat here is scripted STALE so a single
    # stray tick would end the session and fail this test.
    api = FakeApi(heartbeat_results=[CallbackResult.STALE] * 5)
    manager, _, _, _, publishers = build_manager(
        config, api=api, recorder=SpawnRecorder(FakeProcess(silence(2)), FakeProcess(silence(2)))
    )

    await manager.play(request_from(play_body(epoch=1, item_id="a")))
    await _drain(manager, "room-1")

    session = manager.get("room-1")
    assert session is not None
    assert [call["item_id"] for call in api.track_ended_calls] == ["a"]
    assert session.item_id is None

    # Well past several heartbeat ticks: the bot stays put and stays quiet.
    await asyncio.sleep(config.heartbeat_interval_s * 3.5)

    assert api.heartbeats == []
    assert manager.room_count == 1
    assert publishers[0].closes == 0

    # The next item re-arms the heartbeat against the new epoch and item.
    await manager.play(request_from(play_body(epoch=2, item_id="b")))
    assert session.item_id == "b"
    assert session.session_epoch == 2

    await manager.shutdown()


# ----------------------------------------------------------------------- utils


async def _drain(manager: SessionManager, room_id: str, timeout: float = 2.0) -> None:
    """Wait until the room's pump task has finished."""

    session = manager.get(room_id)
    assert session is not None
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while session.playing and loop.time() < deadline:
        await asyncio.sleep(0.005)
    assert not session.playing, "playback did not finish in time"


async def _wait_until(predicate, timeout: float) -> None:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while loop.time() < deadline:
        if predicate():
            return
        await asyncio.sleep(0.01)
    raise AssertionError("condition not reached within the timeout")
