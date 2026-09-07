"""`LiveKitPublisher` against a fake `livekit.rtc`.

The real SDK is never reachable in CI, and these cases are all about what the
publisher believes about a connection it can no longer use, so the fake room
models exactly the three states `livekit-rtc` exposes: connected, reconnecting,
and the terminal `disconnected` event.
"""

from __future__ import annotations

import sys
import types
from typing import Any

import pytest

from music_bot.ffmpeg import PcmFrame
from music_bot.publisher import TRACK_NAME, LiveKitPublisher

CONN_DISCONNECTED = 0
CONN_CONNECTED = 1
CONN_RECONNECTING = 2


class FakeRoom:
    def __init__(self) -> None:
        self.connection_state = CONN_DISCONNECTED
        self.handlers: dict[str, list[Any]] = {}
        self.connects: list[tuple[str, str]] = []
        self.disconnects = 0
        self.local_participant = FakeLocalParticipant()

    def on(self, event: str, handler: Any) -> None:
        self.handlers.setdefault(event, []).append(handler)

    def isconnected(self) -> bool:
        # Mirrors `rtc.Room.isconnected`: reconnecting is still connected.
        return self.connection_state != CONN_DISCONNECTED

    async def connect(self, url: str, token: str, options: Any) -> None:
        self.connects.append((url, token))
        self.connection_state = CONN_CONNECTED

    async def disconnect(self) -> None:
        self.disconnects += 1
        self.connection_state = CONN_DISCONNECTED

    def drop(self, reason: str = "SERVER_SHUTDOWN") -> None:
        """A LiveKit-side drop: state flips and the terminal event fires."""

        self.connection_state = CONN_DISCONNECTED
        for handler in self.handlers.get("disconnected", []):
            handler(reason)


class FakeLocalParticipant:
    def __init__(self) -> None:
        self.published: list[Any] = []

    async def publish_track(self, track: Any, options: Any) -> str:
        self.published.append((track, options))
        return "pub-1"


class FakeAudioSource:
    def __init__(self, sample_rate: int, channels: int, queue_size_ms: int = 0) -> None:
        self.sample_rate = sample_rate
        self.channels = channels
        self.captured: list[Any] = []

    async def capture_frame(self, frame: Any) -> None:
        self.captured.append(frame)


@pytest.fixture
def rooms(monkeypatch: pytest.MonkeyPatch) -> list[FakeRoom]:
    """Install a fake `livekit` package and hand back every room it builds."""

    made: list[FakeRoom] = []

    def room_factory() -> FakeRoom:
        room = FakeRoom()
        made.append(room)
        return room

    rtc = types.SimpleNamespace(
        Room=room_factory,
        RoomOptions=lambda **kwargs: kwargs,
        AudioSource=FakeAudioSource,
        LocalAudioTrack=types.SimpleNamespace(
            create_audio_track=lambda name, source: {"name": name, "source": source}
        ),
        TrackPublishOptions=lambda **kwargs: kwargs,
        TrackSource=types.SimpleNamespace(SOURCE_SCREENSHARE_AUDIO="screenshare_audio"),
        AudioFrame=lambda **kwargs: kwargs,
        ConnectionState=types.SimpleNamespace(
            CONN_DISCONNECTED=CONN_DISCONNECTED,
            CONN_CONNECTED=CONN_CONNECTED,
            CONN_RECONNECTING=CONN_RECONNECTING,
        ),
    )
    package = types.ModuleType("livekit")
    package.rtc = rtc  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "livekit", package)
    monkeypatch.setitem(sys.modules, "livekit.rtc", rtc)  # type: ignore[arg-type]
    return made


def frame() -> PcmFrame:
    return PcmFrame(data=b"\x00\x00" * 960)


async def connected_publisher(rooms: list[FakeRoom]) -> LiveKitPublisher:
    publisher = LiveKitPublisher()
    await publisher.connect("ws://livekit:7880", "jwt-token")
    await publisher.publish()
    return publisher


# ------------------------------------------------------------------ happy path


async def test_connect_publishes_as_screenshare_audio(rooms: list[FakeRoom]) -> None:
    publisher = await connected_publisher(rooms)

    assert rooms[0].connects == [("ws://livekit:7880", "jwt-token")]
    assert publisher.connected is True
    track, options = rooms[0].local_participant.published[0]
    assert track["name"] == TRACK_NAME
    assert options["source"] == "screenshare_audio"

    await publisher.capture(frame())
    assert len(track["source"].captured) == 1


# --------------------------------------------------------------- lost handles


async def test_connected_goes_false_when_livekit_drops_the_room(
    rooms: list[FakeRoom],
) -> None:
    # Before the fix `connected` was `self._room is not None`, so a server-side
    # drop left a live-looking handle that the session happily reused.
    publisher = await connected_publisher(rooms)
    assert publisher.connected is True

    rooms[0].drop()

    assert publisher.connected is False


async def test_a_reconnecting_room_still_counts_as_connected(rooms: list[FakeRoom]) -> None:
    # The SDK recovers from a blip by itself; tearing the room down here would
    # turn a recoverable hiccup into a rebuild and an audible gap.
    publisher = await connected_publisher(rooms)

    rooms[0].connection_state = CONN_RECONNECTING

    assert publisher.connected is True


async def test_capture_fails_fast_instead_of_publishing_into_a_dead_room(
    rooms: list[FakeRoom],
) -> None:
    publisher = await connected_publisher(rooms)
    rooms[0].drop()

    with pytest.raises(RuntimeError):
        await publisher.capture(frame())

    track, _ = rooms[0].local_participant.published[0]
    assert track["source"].captured == []


async def test_reconnecting_builds_a_fresh_room_and_clears_the_drop(
    rooms: list[FakeRoom],
) -> None:
    publisher = await connected_publisher(rooms)
    rooms[0].drop()
    assert publisher.connected is False

    await publisher.connect("ws://livekit:7880", "jwt-token-2")
    await publisher.publish()

    assert len(rooms) == 2
    assert rooms[0].disconnects == 1  # the dead room was closed, not leaked
    assert publisher.connected is True
    await publisher.capture(frame())
    track, _ = rooms[1].local_participant.published[0]
    assert len(track["source"].captured) == 1


async def test_close_forgets_the_room(rooms: list[FakeRoom]) -> None:
    publisher = await connected_publisher(rooms)

    await publisher.close()

    assert publisher.connected is False
    assert rooms[0].disconnects == 1
    # Idempotent: closing twice must not raise.
    await publisher.close()
