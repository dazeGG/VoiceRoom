"""Shared fakes.

Nothing here touches a real site, LiveKit, or a real ffmpeg binary: the whole
point of the plan's isolation is that the bot's own logic is testable without
any of them, and none of them are reachable in CI.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from music_bot.config import Config
from music_bot.control_plane import CallbackResult
from music_bot.errors import RESOLVE_FAILED, UnavailableError
from music_bot.ffmpeg import FRAME_BYTES, FfmpegDecoder
from music_bot.links import ParsedLink
from music_bot.resolver import ResolvedLink, ResolvedTrack

# At least `SECRET_MIN_LENGTH`: `load_config` refuses anything shorter, so a
# toy secret here would fail at boot rather than in the assertion under test.
SECRET = "test-secret-0123456789abcdefghij"


@pytest.fixture
def config() -> Config:
    return Config(
        secret=SECRET,
        host="127.0.0.1",
        port=0,
        livekit_url="ws://livekit:7880",
        api_base_url="http://api:3000",
        sources=("vk", "rutube"),
        max_rooms=2,
        heartbeat_interval_ms=250,
        heartbeat_failure_limit=3,
        callback_timeout_ms=200,
        resolve_timeout_ms=500,
        ffmpeg_binary="ffmpeg",
    )


class FakeStream:
    """Async byte stream that hands out at most `n` bytes per read."""

    def __init__(self, payload: bytes = b"") -> None:
        self._buffer = bytearray(payload)
        self._closed = False
        self.reads = 0

    def feed(self, payload: bytes) -> None:
        self._buffer.extend(payload)

    def eof(self) -> None:
        self._closed = True

    async def read(self, n: int) -> bytes:
        while not self._buffer and not self._closed:
            await asyncio.sleep(0)
        chunk = bytes(self._buffer[:n])
        del self._buffer[: len(chunk)]
        self.reads += 1
        return chunk


class FakeProcess:
    """Stands in for an `asyncio.subprocess.Process`."""

    def __init__(
        self,
        payload: bytes = b"",
        *,
        exit_code: int = 0,
        ignore_terminate: bool = False,
        streaming: bool = False,
    ):
        self.stdout = FakeStream(payload)
        # `streaming=True` keeps stdout open after the payload is drained, so the
        # pump stays alive the way it would for a real, still-playing track.
        if not streaming:
            self.stdout.eof()
        self.stderr = FakeStream(b"")
        self.stderr.eof()
        self.returncode: int | None = None
        self.terminated = False
        self.killed = False
        self._exit_code = exit_code
        self._ignore_terminate = ignore_terminate
        self._exited = asyncio.Event()

    def exit_now(self, code: int | None = None) -> None:
        if self.returncode is None:
            self.returncode = self._exit_code if code is None else code
            self._exited.set()

    def terminate(self) -> None:
        self.terminated = True
        if not self._ignore_terminate:
            self.exit_now(0)

    def kill(self) -> None:
        self.killed = True
        self.exit_now(-9)

    async def wait(self) -> int:
        if self.returncode is None and not self.stdout._buffer:
            # Stream drained: a real ffmpeg would exit here.
            self.exit_now()
        await self._exited.wait()
        assert self.returncode is not None
        return self.returncode


class SpawnRecorder:
    """`spawn` hook for `FfmpegDecoder` that records commands and hands out processes."""

    def __init__(self, *processes: FakeProcess) -> None:
        self._queue = list(processes)
        self.commands: list[list[str]] = []
        self.processes: list[FakeProcess] = []

    async def __call__(self, command: list[str]) -> FakeProcess:
        self.commands.append(command)
        process = self._queue.pop(0) if self._queue else FakeProcess(b"")
        self.processes.append(process)
        return process


def decoder_factory_from(recorder: SpawnRecorder):
    def factory(binary: str, url: str) -> FfmpegDecoder:
        return FfmpegDecoder(binary, url, spawn=recorder)

    return factory


def silence(frames: int) -> bytes:
    return bytes(FRAME_BYTES * frames)


class FakeResolver:
    """Resolver that records calls and answers from canned data."""

    def __init__(
        self,
        *,
        available: bool = True,
        stream_url: str = "https://stream.example/track.mp3",
        expand: ResolvedLink | None = None,
        expand_error: Exception | None = None,
        stream_error: Exception | None = None,
        stream_delay_s: float = 0.0,
    ) -> None:
        self._available = available
        self._stream_url = stream_url
        self._expand = expand
        self._expand_error = expand_error
        self._stream_error = stream_error
        self._stream_delay_s = stream_delay_s
        self.stream_calls: list[str] = []
        self.expand_calls: list[tuple[ParsedLink, int]] = []
        self.closed = False

    @property
    def available(self) -> bool:
        return self._available

    async def expand(self, link: ParsedLink, limit: int) -> ResolvedLink:
        self.expand_calls.append((link, limit))
        if self._expand_error is not None:
            raise self._expand_error
        if self._expand is None:
            raise UnavailableError("no canned answer", code=RESOLVE_FAILED)
        return self._expand

    async def stream_url(self, track_id: str) -> str:
        self.stream_calls.append(track_id)
        if self._stream_delay_s:
            await asyncio.sleep(self._stream_delay_s)
        if self._stream_error is not None:
            raise self._stream_error
        return self._stream_url

    async def close(self) -> None:
        self.closed = True


class FakePublisher:
    def __init__(self) -> None:
        self._connected = False
        self.connects: list[tuple[str, str]] = []
        self.captured = 0
        self.published = False
        self.closes = 0

    @property
    def connected(self) -> bool:
        return self._connected

    async def connect(self, url: str, token: str) -> None:
        self.connects.append((url, token))
        self._connected = True

    async def publish(self) -> None:
        self.published = True

    def drop(self) -> None:
        """A LiveKit-side disconnect: the handle survives, the connection does not."""

        self._connected = False

    async def capture(self, frame: Any) -> None:
        self.captured += 1

    async def close(self) -> None:
        self.closes += 1
        self._connected = False


class FakeApi:
    """Records callbacks and replays a scripted sequence of results."""

    def __init__(self, *, heartbeat_results: list[CallbackResult] | None = None) -> None:
        self.heartbeats: list[dict[str, Any]] = []
        self.track_ended_calls: list[dict[str, Any]] = []
        self._heartbeat_results = list(heartbeat_results or [])
        self.track_ended_result = CallbackResult.ACK
        self.closed = False

    async def heartbeat(self, room_id: str, **payload: Any) -> CallbackResult:
        self.heartbeats.append({"roomId": room_id, **payload})
        if self._heartbeat_results:
            return self._heartbeat_results.pop(0)
        return CallbackResult.ACK

    async def track_ended(self, room_id: str, **payload: Any) -> CallbackResult:
        self.track_ended_calls.append({"roomId": room_id, **payload})
        return self.track_ended_result

    async def close(self) -> None:
        self.closed = True


def play_body(
    *,
    epoch: int = 1,
    item_id: str = "item-1",
    source: str = "vk",
    video_id: str = "-1_2",
    # Written out rather than rebuilt from `video_id`, so that a canonical-URL
    # bug in `links.py` cannot be papered over by the fixture that exercises it.
    source_url: str = "https://vkvideo.ru/video-1_2",
    room_name: str = "vr_room-abc",
    token: str = "jwt-token",
    duration_ms: int = 1000,
) -> dict[str, Any]:
    """The item shape the API's `buildPlayRequest` sends."""

    return {
        "sessionEpoch": epoch,
        "item": {
            "itemId": item_id,
            "source": source,
            "videoId": video_id,
            "sourceUrl": source_url,
            "title": "Song",
            "durationMs": duration_ms,
        },
        "livekit": {
            "url": "ws://livekit:7880",
            "roomName": room_name,
            "token": token,
            "identity": "music-bot:room-abc",
        },
    }


def resolved_playlist(count: int = 3) -> ResolvedLink:
    items = tuple(
        ResolvedTrack(
            track_id=f"vk:video:-1_{index}",
            title=f"Track {index}",
            artists=("Artist",),
            duration_ms=180000,
            source="vk",
            video_id=f"-1_{index}",
            cover_url="https://cdn.example/cover.jpg",
        )
        for index in range(count)
    )
    return ResolvedLink(
        kind="playlist",
        source="vk",
        source_id="vk:playlist:-1_9",
        title="Playlist",
        items=items,
        total_available=count,
        truncated=False,
    )
