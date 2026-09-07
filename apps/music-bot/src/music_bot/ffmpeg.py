"""ffmpeg-backed PCM decoding with a guaranteed process lifecycle.

One decoder owns exactly one ffmpeg process. `stop()` is idempotent and always
reaches a terminated process (terminate, then kill after a grace period), which
is what keeps rapid skips from accumulating processes (plan risk table).
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import re
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any

LOGGER = logging.getLogger(__name__)

# Signed CDN links are short-lived credentials: anyone holding one can
# pull the audio until it expires. ffmpeg prints the input URL on failure even
# at `-loglevel error`, and a spawn error carries the whole argv, so both are
# scrubbed before they reach a log line or an error message.
_URL_PATTERN = re.compile(r"([a-zA-Z][a-zA-Z0-9+.\-]*)://([^\s/?#'\"]*)([^\s'\"]*)")


def redact_urls(text: str) -> str:
    """Reduce every URL in `text` to scheme + host, dropping path, query and userinfo."""

    def replace(match: re.Match[str]) -> str:
        scheme, authority, rest = match.group(1), match.group(2), match.group(3)
        host = authority.rsplit("@", 1)[-1]  # a `user:password@` prefix is a secret too
        if not rest or rest == "/":
            return f"{scheme}://{host}"
        return f"{scheme}://{host}/<redacted>"

    return _URL_PATTERN.sub(replace, text)

SAMPLE_RATE = 48000
CHANNELS = 2
BYTES_PER_SAMPLE = 2
FRAME_DURATION_MS = 10
SAMPLES_PER_FRAME = SAMPLE_RATE * FRAME_DURATION_MS // 1000  # 480
FRAME_BYTES = SAMPLES_PER_FRAME * CHANNELS * BYTES_PER_SAMPLE  # 1920
BYTES_PER_SECOND = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE

_TERMINATE_GRACE_S = 2.0
_STDERR_TAIL_BYTES = 2048


@dataclass(frozen=True)
class PcmFrame:
    data: bytes
    samples_per_channel: int = SAMPLES_PER_FRAME
    sample_rate: int = SAMPLE_RATE
    channels: int = CHANNELS


def build_command(binary: str, url: str, *, proxy: str | None = None) -> list[str]:
    command = [
        binary,
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        # The input is always a signed HTTPS CDN link (`Resolver.stream_url`
        # enforces the scheme). Without a whitelist ffmpeg would honour whatever
        # protocol the URL names, so a compromised or spoofed upstream response
        # could point it at `file:`, `concat:`, or an internal plain-http host.
        # There is no injection risk here - `create_subprocess_exec`, no shell -
        # but the demuxer itself is the reachable surface.
        "-protocol_whitelist",
        "https,tls,tcp",
        # Every source serves over HTTPS; short drop-outs should not end the
        # track, but reconnect attempts are bounded.
        "-reconnect",
        "1",
        "-reconnect_streamed",
        "1",
        "-reconnect_delay_max",
        "5",
        "-i",
        url,
        "-vn",
        "-f",
        "s16le",
        "-acodec",
        "pcm_s16le",
        "-ar",
        str(SAMPLE_RATE),
        "-ac",
        str(CHANNELS),
        "pipe:1",
    ]
    if proxy:
        # The media host is blocked wherever the site is: a YouTube URL fetched
        # without the proxy that resolved it fails at the CDN. Inserted before
        # `-i` so it applies to the input, and never logged unredacted - a proxy
        # URL can carry credentials.
        index = command.index("-i")
        command[index:index] = ["-http_proxy", proxy]
    return command


async def _default_spawn(command: list[str]) -> Any:
    return await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        stdin=asyncio.subprocess.DEVNULL,
    )


class FfmpegDecoder:
    """Decodes one stream URL into 10 ms PCM frames."""

    def __init__(
        self,
        binary: str,
        url: str,
        *,
        proxy: str | None = None,
        spawn: Callable[[list[str]], Any] | None = None,
    ) -> None:
        self._command = build_command(binary, url, proxy=proxy)
        self._spawn = spawn or _default_spawn
        self._process: Any | None = None
        self._stderr_task: asyncio.Task[None] | None = None
        self._stderr_tail = b""
        self._stopped = False
        self.bytes_decoded = 0

    @property
    def started(self) -> bool:
        return self._process is not None

    @property
    def returncode(self) -> int | None:
        return None if self._process is None else self._process.returncode

    @property
    def stderr_tail(self) -> str:
        return self._stderr_tail.decode("utf-8", "replace").strip()

    @property
    def position_ms(self) -> int:
        return int(self.bytes_decoded * 1000 / BYTES_PER_SECOND)

    async def start(self) -> None:
        if self._process is not None:
            raise RuntimeError("decoder already started")
        self._process = await self._spawn(list(self._command))
        stderr = getattr(self._process, "stderr", None)
        if stderr is not None:
            self._stderr_task = asyncio.ensure_future(self._drain_stderr(stderr))

    async def _drain_stderr(self, stream: Any) -> None:
        try:
            while True:
                chunk = await stream.read(1024)
                if not chunk:
                    return
                self._stderr_tail = (self._stderr_tail + chunk)[-_STDERR_TAIL_BYTES:]
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - stderr drain must never break playback
            return

    async def frames(self) -> AsyncIterator[PcmFrame]:
        """Yield fixed-size PCM frames until the stream ends or `stop()` is called.

        A trailing partial frame is padded with silence so the consumer never
        has to special-case frame size.
        """

        if self._process is None:
            raise RuntimeError("decoder not started")
        stdout = self._process.stdout
        buffer = bytearray()
        while not self._stopped:
            chunk = await stdout.read(FRAME_BYTES)
            if not chunk:
                break
            buffer.extend(chunk)
            while len(buffer) >= FRAME_BYTES:
                frame = bytes(buffer[:FRAME_BYTES])
                del buffer[:FRAME_BYTES]
                self.bytes_decoded += FRAME_BYTES
                yield PcmFrame(frame)
        if buffer and not self._stopped:
            self.bytes_decoded += len(buffer)
            padded = bytes(buffer) + bytes(FRAME_BYTES - len(buffer))
            yield PcmFrame(padded)

    async def wait(self) -> int:
        if self._process is None:
            return 0
        return await self._process.wait()

    async def stop(self) -> None:
        """Terminate the process. Safe to call repeatedly and before `start()`."""

        self._stopped = True
        process = self._process
        if process is None:
            return
        if process.returncode is None:
            try:
                process.terminate()
            except ProcessLookupError:
                pass
            except Exception:
                LOGGER.warning("ffmpeg terminate failed", exc_info=True)
            try:
                await asyncio.wait_for(process.wait(), timeout=_TERMINATE_GRACE_S)
            except TimeoutError:
                try:
                    process.kill()
                except ProcessLookupError:
                    pass
                except Exception:
                    LOGGER.warning("ffmpeg kill failed", exc_info=True)
                await process.wait()
        if self._stderr_task is not None:
            self._stderr_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._stderr_task
            self._stderr_task = None
