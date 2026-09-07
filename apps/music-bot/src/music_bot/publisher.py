"""LiveKit publishing, behind a protocol so the pipeline is testable headless.

The bot never mints a token and never derives a room name: the API hands it a
room-scoped `AccessToken` and the fully-resolved LiveKit room name in the play
request (plan Step 2.4). This module therefore takes both as plain arguments and
has no LiveKit API key or secret anywhere in its configuration.

`livekit-rtc` has no "music" track source, so the bot publishes as
`SOURCE_SCREENSHARE_AUDIO` (plan Step 4.3a); the web client discriminates by
bot identity *before* any source predicate.

`connected` must reflect the *server's* view of the connection, not merely the
fact that we once built a `Room`: a LiveKit-side drop leaves a live-looking
handle that silently swallows every captured frame. It is therefore answered
from the SDK's own `Room.isconnected()` plus the terminal `disconnected` event,
so `RoomSession._ensure_connected` rebuilds a dead publisher instead of reusing
it. A reconnecting room still counts as connected: the SDK is recovering on its
own and tearing it down would turn a blip into an outage.
"""

from __future__ import annotations

import logging
from typing import Any, Protocol

from .ffmpeg import CHANNELS, SAMPLE_RATE, PcmFrame

LOGGER = logging.getLogger(__name__)

TRACK_NAME = "room-music"
# One second of buffered audio: enough to absorb decode jitter, short enough
# that a skip is not audibly delayed.
QUEUE_SIZE_MS = 1000


class Publisher(Protocol):
    @property
    def connected(self) -> bool: ...

    async def connect(self, url: str, token: str) -> None: ...

    async def publish(self) -> None: ...

    async def capture(self, frame: PcmFrame) -> None: ...

    async def close(self) -> None: ...


class LiveKitPublisher:
    """Real publisher. Imports `livekit.rtc` lazily, on first connect."""

    def __init__(self) -> None:
        self._room: Any | None = None
        self._source: Any | None = None
        self._track: Any | None = None
        self._publication: Any | None = None
        self._dropped = False

    @property
    def connected(self) -> bool:
        room = self._room
        if room is None or self._dropped:
            return False
        return bool(room.isconnected())

    def _on_disconnected(self, *args: Any) -> None:
        # Terminal: `livekit-rtc` emits this only once it has given up
        # reconnecting, so the handle is dead and must not be reused.
        LOGGER.warning("livekit dropped the music-bot connection: %s", args or "no reason given")
        self._dropped = True

    async def connect(self, url: str, token: str) -> None:
        from livekit import rtc

        if self._room is not None:
            await self.close()
        room = rtc.Room()
        self._dropped = False
        # Subscribed before `connect` so a drop during the handshake is not missed.
        room.on("disconnected", self._on_disconnected)
        await room.connect(url, token, rtc.RoomOptions(auto_subscribe=False))
        self._room = room

    async def publish(self) -> None:
        from livekit import rtc

        if self._room is None:
            raise RuntimeError("publisher is not connected")
        if self._publication is not None:
            return
        source = rtc.AudioSource(SAMPLE_RATE, CHANNELS, queue_size_ms=QUEUE_SIZE_MS)
        track = rtc.LocalAudioTrack.create_audio_track(TRACK_NAME, source)
        options = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_SCREENSHARE_AUDIO)
        self._publication = await self._room.local_participant.publish_track(track, options)
        self._source = source
        self._track = track

    async def capture(self, frame: PcmFrame) -> None:
        from livekit import rtc

        if self._source is None:
            raise RuntimeError("nothing published")
        if not self.connected:
            # Fail the pump instead of writing frames nobody receives: the pump
            # turns this into a `track-ended`/`failed` callback, so the API
            # advances now rather than after the whole track's duration.
            raise RuntimeError("livekit connection lost")
        await self._source.capture_frame(
            rtc.AudioFrame(
                data=frame.data,
                sample_rate=frame.sample_rate,
                num_channels=frame.channels,
                samples_per_channel=frame.samples_per_channel,
            )
        )

    async def close(self) -> None:
        room, self._room = self._room, None
        self._dropped = False
        self._source = None
        self._track = None
        self._publication = None
        if room is None:
            return
        try:
            await room.disconnect()
        except Exception:
            LOGGER.warning("livekit disconnect failed", exc_info=True)
