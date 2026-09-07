"""Per-room playback session and the manager that owns them all.

Invariants enforced here:

* **One active ffmpeg process per room.** Starting a new item stops the previous
  decoder before spawning the next one, and a generation counter makes a
  stale pump unable to report `track-ended` for an item that was skipped.
* **Resolve happens immediately before playing.** Media URLs from every source
  expire, so the URL is fetched inside `play()`, never at enqueue time.
* **Self-termination on control-plane loss.** After `heartbeat_failure_limit`
  consecutive unacknowledged heartbeats - or one explicit stale rejection - the
  bot leaves the LiveKit room by itself, so an API restart cannot leave music
  playing that the server knows nothing about. The flip side: the bot never
  heartbeats for an item whose completion the API has already acknowledged, or
  the queue advancing between two tracks would look like control-plane loss.
* **A hard ceiling on concurrent rooms per container.**
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from .config import Config
from .control_plane import ApiClient, CallbackResult
from .errors import (
    PUBLISH_FAILED,
    STREAM_FAILED,
    InvalidRequestError,
    RoomCapacityExceededError,
    StaleEpochError,
    UnavailableError,
)
from .ffmpeg import FfmpegDecoder, redact_urls
from .links import SOURCES, parse_link
from .publisher import LiveKitPublisher, Publisher
from .resolver import Resolver

LOGGER = logging.getLogger(__name__)

REASON_COMPLETED = "completed"
REASON_FAILED = "failed"
REASON_STOPPED = "stopped"


@dataclass(frozen=True)
class PlayRequest:
    """One `POST /sessions/{roomId}/play` body, validated.

    The API sends the item as `{itemId, source, videoId, sourceUrl, title,
    durationMs}`. All three of `source`, `videoId` and `sourceUrl` describe the
    same thing, and `from_json` checks that they agree rather than picking one
    and hoping: a disagreement means the two ends of the control plane have
    drifted, and finding that out here - once, loudly, before anything is
    published into a room - is much cheaper than finding it out as a room that
    plays the wrong track.
    """

    room_id: str
    session_epoch: int
    item_id: str
    #: Canonical `<source>:video:<id>`, derived from `sourceUrl`. This is what
    #: the resolver is asked for; it rebuilds the same canonical URL from it.
    track_id: str
    source: str
    video_id: str
    livekit_url: str
    livekit_room: str
    livekit_token: str
    identity: str | None = None
    duration_ms: int = 0
    title: str = ""

    @staticmethod
    def from_json(room_id: str, body: Any, *, default_livekit_url: str) -> PlayRequest:
        if not isinstance(body, dict):
            raise InvalidRequestError("request body must be a JSON object")

        def text(container: dict[str, Any], key: str, *, required: bool = True) -> str:
            value = container.get(key)
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                value = str(value)
            if not isinstance(value, str) or not value.strip():
                if required:
                    raise InvalidRequestError(f"missing or empty field {key!r}")
                return ""
            return value.strip()

        epoch = body.get("sessionEpoch")
        if not isinstance(epoch, int) or isinstance(epoch, bool) or epoch < 0:
            raise InvalidRequestError("sessionEpoch must be a non-negative integer")

        item = body.get("item")
        if not isinstance(item, dict):
            raise InvalidRequestError("missing 'item' object")

        livekit = body.get("livekit")
        if not isinstance(livekit, dict):
            raise InvalidRequestError("missing 'livekit' object")

        duration = item.get("durationMs", 0)
        if not isinstance(duration, int) or isinstance(duration, bool) or duration < 0:
            duration = 0

        source = text(item, "source")
        if source not in SOURCES:
            raise InvalidRequestError(f"item.source must be one of {', '.join(SOURCES)}")
        video_id = text(item, "videoId")
        # `sourceUrl` is canonical and was built by the shared contract, so it is
        # the field parsed; the other two are checked against what it says.
        ref = parse_link(text(item, "sourceUrl"))
        if ref.kind != "video":
            raise InvalidRequestError("item.sourceUrl must address a video, not a playlist")
        if ref.source != source or ref.video_id != video_id:
            raise InvalidRequestError(
                f"item.sourceUrl addresses {ref.source}:{ref.video_id} but the item "
                f"declares {source}:{video_id}"
            )

        return PlayRequest(
            room_id=room_id,
            session_epoch=epoch,
            item_id=text(item, "itemId"),
            track_id=ref.track_id,
            source=ref.source,
            video_id=video_id,
            duration_ms=duration,
            title=text(item, "title", required=False),
            # The room name is always taken from the request: the API applies
            # LIVEKIT_ROOM_PREFIX server-side and the bot must never rebuild it.
            livekit_room=text(livekit, "roomName"),
            livekit_token=text(livekit, "token"),
            livekit_url=text(livekit, "url", required=False) or default_livekit_url,
            identity=text(livekit, "identity", required=False) or None,
        )


class RoomSession:
    """Playback state for a single room."""

    def __init__(
        self,
        room_id: str,
        config: Config,
        resolver: Resolver,
        api: ApiClient,
        *,
        publisher_factory: Callable[[], Publisher] = LiveKitPublisher,
        decoder_factory: Callable[[str, str], FfmpegDecoder] | None = None,
        on_terminated: Callable[[str], Any] | None = None,
    ) -> None:
        self.room_id = room_id
        self._config = config
        self._resolver = resolver
        self._api = api
        self._publisher_factory = publisher_factory
        self._decoder_factory = decoder_factory or (
            lambda binary, url: FfmpegDecoder(binary, url, proxy=config.proxy)
        )
        self._on_terminated = on_terminated

        self._lock = asyncio.Lock()
        self._publisher: Publisher | None = None
        self._decoder: FfmpegDecoder | None = None
        self._pump_task: asyncio.Task[None] | None = None
        self._heartbeat_task: asyncio.Task[None] | None = None
        self._generation = 0
        self._closed = False

        self.session_epoch = -1
        self.item_id: str | None = None
        self.livekit_room: str | None = None
        self.identity: str | None = None
        self.position_ms = 0
        self.heartbeat_failures = 0

    # ------------------------------------------------------------------ state

    @property
    def playing(self) -> bool:
        return self._pump_task is not None and not self._pump_task.done()

    def snapshot(self) -> dict[str, Any]:
        return {
            "roomId": self.room_id,
            "sessionEpoch": self.session_epoch,
            "itemId": self.item_id,
            "identity": self.identity,
            "roomName": self.livekit_room,
            "positionMs": self.current_position_ms,
            "playing": self.playing,
        }

    @property
    def current_position_ms(self) -> int:
        return self._decoder.position_ms if self._decoder is not None else self.position_ms

    # ------------------------------------------------------------------- play

    async def play(self, request: PlayRequest) -> dict[str, Any]:
        async with self._lock:
            if self._closed:
                raise StaleEpochError("session is closing")
            if request.session_epoch < self.session_epoch:
                raise StaleEpochError(
                    f"epoch {request.session_epoch} is older than {self.session_epoch}"
                )

            await self._stop_playback()

            self.session_epoch = request.session_epoch
            self.item_id = request.item_id
            self.identity = request.identity
            self.position_ms = 0
            self.heartbeat_failures = 0

            # Resolved here, not at enqueue time: media URLs expire.
            try:
                stream_url = await asyncio.wait_for(
                    self._resolver.stream_url(request.track_id),
                    timeout=self._config.resolve_timeout_s,
                )
            except TimeoutError as exc:
                raise UnavailableError(
                    "timed out resolving the stream URL", code=STREAM_FAILED
                ) from exc

            await self._ensure_connected(request)

            decoder = self._decoder_factory(self._config.ffmpeg_binary, stream_url)
            try:
                await decoder.start()
            except Exception as exc:
                await decoder.stop()
                raise UnavailableError(
                    f"ffmpeg failed to start: {redact_urls(str(exc))}", code=STREAM_FAILED
                ) from exc

            self._decoder = decoder
            self._generation += 1
            generation = self._generation
            self._pump_task = asyncio.ensure_future(
                self._pump(decoder, generation, request.session_epoch, request.item_id)
            )
            self._start_heartbeat()
            return self.snapshot()

    async def _ensure_connected(self, request: PlayRequest) -> None:
        if self._publisher is not None and self.livekit_room == request.livekit_room:
            if self._publisher.connected:
                return
        if self._publisher is not None:
            await self._publisher.close()
            self._publisher = None
        publisher = self._publisher_factory()
        try:
            await publisher.connect(request.livekit_url, request.livekit_token)
            await publisher.publish()
        except Exception as exc:
            with contextlib.suppress(Exception):
                await publisher.close()
            raise UnavailableError(
                f"failed to join the LiveKit room: {exc}", code=PUBLISH_FAILED
            ) from exc
        self._publisher = publisher
        self.livekit_room = request.livekit_room

    async def _pump(
        self, decoder: FfmpegDecoder, generation: int, epoch: int, item_id: str
    ) -> None:
        reason = REASON_COMPLETED
        error_code: str | None = None
        try:
            publisher = self._publisher
            assert publisher is not None
            async for frame in decoder.frames():
                if generation != self._generation:
                    return
                await publisher.capture(frame)
            returncode = await decoder.wait()
            if returncode not in (0, None):
                reason = REASON_FAILED
                error_code = STREAM_FAILED
                LOGGER.warning(
                    "ffmpeg exited %s for room %s: %s",
                    returncode,
                    self.room_id,
                    redact_urls(decoder.stderr_tail),
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            # The message is redacted; `exc_info` stays because this blind catch
            # is the only report of a pump failure, and what reaches it comes
            # from the pipe and the publisher - the URL-carrying spawn error is
            # raised in `play`, not here.
            LOGGER.warning(
                "playback failed for room %s: %s",
                self.room_id,
                redact_urls(str(exc)),
                exc_info=True,
            )
            reason = REASON_FAILED
            error_code = PUBLISH_FAILED
        finally:
            await decoder.stop()

        if generation != self._generation:
            return
        self.position_ms = decoder.position_ms
        result = await self._api.track_ended(
            self.room_id,
            session_epoch=epoch,
            item_id=item_id,
            reason=reason,
            position_ms=decoder.position_ms,
            error_code=error_code,
        )
        if result is CallbackResult.STALE:
            await self._self_terminate("track-ended rejected as stale")
            return
        if result is CallbackResult.ACK and generation == self._generation:
            # The API owns this item from here: it answers `track-ended` first and
            # only then advances the queue, bumping `sessionEpoch` and clearing
            # its current item. A heartbeat landing in that window would be
            # rejected as stale and would self-terminate the bot mid-queue, so we
            # stop heartbeating for an item whose completion is already
            # acknowledged and wait to be told what plays next. An unacknowledged
            # `track-ended` deliberately keeps heartbeating: the server has not
            # heard us, and those heartbeats are how the failure limit trips.
            self.item_id = None

    # -------------------------------------------------------------- heartbeat

    def _start_heartbeat(self) -> None:
        if self._heartbeat_task is not None and not self._heartbeat_task.done():
            return
        self._heartbeat_task = asyncio.ensure_future(self._heartbeat_loop())

    async def _heartbeat_loop(self) -> None:
        try:
            while not self._closed:
                await asyncio.sleep(self._config.heartbeat_interval_s)
                if self._closed or self.item_id is None:
                    continue
                result = await self._api.heartbeat(
                    self.room_id,
                    session_epoch=self.session_epoch,
                    item_id=self.item_id,
                    position_ms=self.current_position_ms,
                    status="playing" if self.playing else "idle",
                )
                if result is CallbackResult.ACK:
                    self.heartbeat_failures = 0
                    continue
                if result is CallbackResult.STALE:
                    await self._self_terminate("heartbeat rejected as stale")
                    return
                self.heartbeat_failures += 1
                if self.heartbeat_failures >= self._config.heartbeat_failure_limit:
                    await self._self_terminate(
                        f"{self.heartbeat_failures} consecutive heartbeats unacknowledged"
                    )
                    return
        except asyncio.CancelledError:
            raise

    async def _self_terminate(self, reason: str) -> None:
        LOGGER.warning("music-bot leaving room %s: %s", self.room_id, reason)
        # Detach from the manager first so a shutdown racing with us is a no-op.
        callback = self._on_terminated
        self._on_terminated = None
        await self.close(cancel_heartbeat=False)
        if callback is not None:
            result = callback(self.room_id)
            if asyncio.iscoroutine(result):
                await result

    # ------------------------------------------------------------------- stop

    async def _stop_playback(self) -> None:
        """Kill the current decoder and pump. Caller must hold `_lock`."""

        self._generation += 1
        task, self._pump_task = self._pump_task, None
        decoder, self._decoder = self._decoder, None
        if decoder is not None:
            self.position_ms = decoder.position_ms
            await decoder.stop()
        # `_self_terminate` runs inside the pump task; cancelling ourselves here
        # would deadlock on the await below.
        if task is not None and task is not asyncio.current_task() and not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task

    async def close(self, *, cancel_heartbeat: bool = True) -> None:
        self._closed = True
        if cancel_heartbeat:
            task, self._heartbeat_task = self._heartbeat_task, None
            if task is not None and not task.done():
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await task
        else:
            task, self._heartbeat_task = self._heartbeat_task, None
            if task is not None and task is not asyncio.current_task() and not task.done():
                task.cancel()
        async with self._lock:
            await self._stop_playback()
            publisher, self._publisher = self._publisher, None
        if publisher is not None:
            with contextlib.suppress(Exception):
                await publisher.close()
        self.item_id = None
        self.livekit_room = None


class SessionManager:
    """Owns every room session in this container and enforces the room ceiling."""

    def __init__(
        self,
        config: Config,
        resolver: Resolver,
        api: ApiClient,
        *,
        publisher_factory: Callable[[], Publisher] = LiveKitPublisher,
        decoder_factory: Callable[[str, str], FfmpegDecoder] | None = None,
    ) -> None:
        self._config = config
        self._resolver = resolver
        self._api = api
        self._publisher_factory = publisher_factory
        self._decoder_factory = decoder_factory
        self._sessions: dict[str, RoomSession] = {}
        self._lock = asyncio.Lock()

    @property
    def room_count(self) -> int:
        return len(self._sessions)

    def get(self, room_id: str) -> RoomSession | None:
        return self._sessions.get(room_id)

    def _forget(self, room_id: str) -> None:
        self._sessions.pop(room_id, None)

    async def play(self, request: PlayRequest) -> dict[str, Any]:
        async with self._lock:
            session = self._sessions.get(request.room_id)
            if session is None:
                if len(self._sessions) >= self._config.max_rooms:
                    raise RoomCapacityExceededError(
                        f"this container already serves {len(self._sessions)} rooms "
                        f"(MUSIC_BOT_MAX_ROOMS={self._config.max_rooms})"
                    )
                session = RoomSession(
                    request.room_id,
                    self._config,
                    self._resolver,
                    self._api,
                    publisher_factory=self._publisher_factory,
                    decoder_factory=self._decoder_factory,
                    on_terminated=self._forget,
                )
                self._sessions[request.room_id] = session
        try:
            return await session.play(request)
        except Exception:
            # A room that never managed to start playing must not hold a slot.
            if not session.playing:
                self._forget(request.room_id)
                with contextlib.suppress(Exception):
                    await session.close()
            raise

    async def stop(self, room_id: str, session_epoch: int | None = None) -> bool:
        session = self._sessions.get(room_id)
        if session is None:
            return False
        if session_epoch is not None and session_epoch < session.session_epoch:
            raise StaleEpochError(
                f"epoch {session_epoch} is older than {session.session_epoch}"
            )
        self._forget(room_id)
        await session.close()
        return True

    async def shutdown(self) -> None:
        sessions = list(self._sessions.values())
        self._sessions.clear()
        for session in sessions:
            with contextlib.suppress(Exception):
                await session.close()

    def snapshot(self) -> list[dict[str, Any]]:
        return [session.snapshot() for session in self._sessions.values()]
