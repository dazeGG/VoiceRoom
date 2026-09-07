from __future__ import annotations

import asyncio

import pytest

from conftest import FakeProcess, SpawnRecorder, silence
from music_bot.ffmpeg import (
    BYTES_PER_SECOND,
    CHANNELS,
    FRAME_BYTES,
    SAMPLE_RATE,
    FfmpegDecoder,
    build_command,
    redact_urls,
)


def test_command_asks_for_48k_stereo_s16le_on_stdout() -> None:
    command = build_command("ffmpeg", "https://stream.example/a.mp3")
    assert command[0] == "ffmpeg"
    assert command[-1] == "pipe:1"
    assert "-f" in command and command[command.index("-f") + 1] == "s16le"
    assert command[command.index("-ar") + 1] == str(SAMPLE_RATE)
    assert command[command.index("-ac") + 1] == str(CHANNELS)
    assert command[command.index("-i") + 1] == "https://stream.example/a.mp3"
    assert "-vn" in command


def test_command_whitelists_the_protocols_the_demuxer_may_use() -> None:
    # The URL comes from an upstream response, not from us. Without this ffmpeg
    # would honour whatever protocol it names - `file:`, `concat:`, or an
    # internal plain-http host.
    command = build_command("ffmpeg", "https://stream.example/a.mp3")
    whitelist = command[command.index("-protocol_whitelist") + 1]
    assert whitelist == "https,tls,tcp"
    # It is an input option: it must precede `-i` to apply to that input.
    assert command.index("-protocol_whitelist") < command.index("-i")


def test_redact_urls_keeps_the_host_and_drops_the_signature() -> None:
    signed = "https://s42.storage.yandex.net/get-mp3/abc/1?sign=SECRET&ts=99"
    assert redact_urls(f"403 for {signed}") == (
        "403 for https://s42.storage.yandex.net/<redacted>"
    )
    # The whole argv of a spawn failure, not just a bare URL.
    argv = "FileNotFoundError: ['ffmpeg', '-i', '" + signed + "', 'pipe:1']"
    assert "sign=SECRET" not in redact_urls(argv)
    assert "s42.storage.yandex.net" in redact_urls(argv)
    # `user:password@` is a credential too.
    assert redact_urls("https://u:pw@cdn.example/x") == "https://cdn.example/<redacted>"
    # A host-only URL keeps its shape, and non-URL text is untouched.
    assert redact_urls("https://cdn.example") == "https://cdn.example"
    assert redact_urls("no url here") == "no url here"


async def test_frames_are_fixed_size_and_position_tracks_bytes() -> None:
    recorder = SpawnRecorder(FakeProcess(silence(5)))
    decoder = FfmpegDecoder("ffmpeg", "url", spawn=recorder)
    await decoder.start()

    frames = [frame async for frame in decoder.frames()]

    assert len(frames) == 5
    assert all(len(frame.data) == FRAME_BYTES for frame in frames)
    assert decoder.bytes_decoded == FRAME_BYTES * 5
    assert decoder.position_ms == int(FRAME_BYTES * 5 * 1000 / BYTES_PER_SECOND) == 50
    await decoder.stop()


async def test_trailing_partial_frame_is_padded_with_silence() -> None:
    payload = silence(1) + b"\x01\x02\x03\x04"
    recorder = SpawnRecorder(FakeProcess(payload))
    decoder = FfmpegDecoder("ffmpeg", "url", spawn=recorder)
    await decoder.start()

    frames = [frame async for frame in decoder.frames()]

    assert len(frames) == 2
    assert len(frames[1].data) == FRAME_BYTES
    assert frames[1].data[:4] == b"\x01\x02\x03\x04"
    assert frames[1].data[4:] == bytes(FRAME_BYTES - 4)
    await decoder.stop()


async def test_stop_terminates_the_process_and_is_idempotent() -> None:
    process = FakeProcess(silence(2))
    recorder = SpawnRecorder(process)
    decoder = FfmpegDecoder("ffmpeg", "url", spawn=recorder)
    await decoder.start()

    await decoder.stop()
    await decoder.stop()

    assert process.terminated is True
    assert process.returncode is not None


async def test_stop_kills_a_process_that_ignores_terminate() -> None:
    process = FakeProcess(silence(1), ignore_terminate=True)
    recorder = SpawnRecorder(process)
    decoder = FfmpegDecoder("ffmpeg", "url", spawn=recorder)
    await decoder.start()

    # Do not wait the real 2s grace period.
    import music_bot.ffmpeg as ffmpeg_module

    original = ffmpeg_module._TERMINATE_GRACE_S
    ffmpeg_module._TERMINATE_GRACE_S = 0.01
    try:
        await decoder.stop()
    finally:
        ffmpeg_module._TERMINATE_GRACE_S = original

    assert process.terminated is True
    assert process.killed is True
    assert process.returncode == -9


async def test_stop_before_start_is_a_no_op() -> None:
    decoder = FfmpegDecoder("ffmpeg", "url", spawn=SpawnRecorder())
    await decoder.stop()
    assert decoder.started is False


async def test_frames_before_start_is_an_error() -> None:
    decoder = FfmpegDecoder("ffmpeg", "url", spawn=SpawnRecorder())
    with pytest.raises(RuntimeError):
        await anext(decoder.frames())


async def test_starting_twice_is_an_error() -> None:
    decoder = FfmpegDecoder("ffmpeg", "url", spawn=SpawnRecorder(FakeProcess(b"")))
    await decoder.start()
    with pytest.raises(RuntimeError):
        await decoder.start()
    await decoder.stop()


async def test_stderr_tail_is_captured_for_diagnostics() -> None:
    process = FakeProcess(b"")
    process.stderr = type(process.stdout)(b"boom: stream not found")
    process.stderr.eof()
    recorder = SpawnRecorder(process)
    decoder = FfmpegDecoder("ffmpeg", "url", spawn=recorder)
    await decoder.start()
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    await decoder.stop()

    assert "stream not found" in decoder.stderr_tail
