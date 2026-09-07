from __future__ import annotations

from typing import Any

import pytest

from music_bot.control_plane import SECRET_HEADER, ApiClient, CallbackResult


class _Response:
    def __init__(self, status: int) -> None:
        self.status = status

    async def __aenter__(self) -> _Response:
        return self

    async def __aexit__(self, *exc: Any) -> bool:
        return False


class FakeSession:
    def __init__(self, *, status: int = 200, error: Exception | None = None) -> None:
        self.status = status
        self.error = error
        self.calls: list[dict[str, Any]] = []
        self.closed = False

    def post(self, url: str, *, json: Any, headers: dict[str, str]) -> _Response:
        self.calls.append({"url": url, "json": json, "headers": headers})
        if self.error is not None:
            raise self.error
        return _Response(self.status)

    async def close(self) -> None:
        self.closed = True


def client(session: FakeSession) -> ApiClient:
    return ApiClient("http://api:3000/", "s3cret", session_factory=lambda: session)


async def test_heartbeat_posts_the_agreed_shape_with_the_shared_secret() -> None:
    session = FakeSession()
    result = await client(session).heartbeat(
        "room-1", session_epoch=7, item_id="item-9", position_ms=4321
    )

    assert result is CallbackResult.ACK
    call = session.calls[0]
    assert call["url"] == "http://api:3000/internal/rooms/room-1/music/heartbeat"
    assert call["headers"][SECRET_HEADER] == "s3cret"
    assert call["json"] == {
        "sessionEpoch": 7,
        "itemId": "item-9",
        "positionMs": 4321,
        "status": "playing",
    }


async def test_track_ended_posts_the_agreed_shape() -> None:
    session = FakeSession()
    result = await client(session).track_ended(
        "room-1",
        session_epoch=7,
        item_id="item-9",
        reason="completed",
        position_ms=180000,
    )

    assert result is CallbackResult.ACK
    call = session.calls[0]
    assert call["url"] == "http://api:3000/internal/rooms/room-1/music/track-ended"
    assert call["json"] == {
        "sessionEpoch": 7,
        "itemId": "item-9",
        "reason": "completed",
        "positionMs": 180000,
        "errorCode": None,
    }


@pytest.mark.parametrize("status", [409, 410])
async def test_server_rejecting_a_stale_epoch_is_reported_as_stale(status: int) -> None:
    session = FakeSession(status=status)
    result = await client(session).heartbeat(
        "room-1", session_epoch=1, item_id="i", position_ms=0
    )
    assert result is CallbackResult.STALE


@pytest.mark.parametrize("status", [400, 401, 404, 500, 502])
async def test_other_non_2xx_is_reported_as_failed(status: int) -> None:
    session = FakeSession(status=status)
    result = await client(session).heartbeat(
        "room-1", session_epoch=1, item_id="i", position_ms=0
    )
    assert result is CallbackResult.FAILED


async def test_transport_failure_is_reported_as_failed_not_raised() -> None:
    session = FakeSession(error=OSError("connection refused"))
    result = await client(session).heartbeat(
        "room-1", session_epoch=1, item_id="i", position_ms=0
    )
    assert result is CallbackResult.FAILED


async def test_close_closes_the_underlying_session() -> None:
    session = FakeSession()
    api = client(session)
    await api.heartbeat("room-1", session_epoch=1, item_id="i", position_ms=0)
    await api.close()
    assert session.closed is True
