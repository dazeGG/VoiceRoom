"""Outbound half of the API <-> bot control plane.

The bot posts two things back to `apps/api`, both authenticated with the same
shared secret as the inbound API and both carrying the `(sessionEpoch, itemId)`
pair so the server can drop callbacks from a session it has already replaced:

    POST {api}/internal/rooms/{roomId}/music/heartbeat     every 2s
    POST {api}/internal/rooms/{roomId}/music/track-ended    once per item

An explicit `STALE` result (HTTP 409/410) tells the bot the server no longer
owns this session and it must leave the room immediately. Repeated `FAILED`
results are what trip the self-termination counter in `session.py`.
"""

from __future__ import annotations

import asyncio
import logging
from enum import Enum
from typing import Any

import aiohttp

LOGGER = logging.getLogger(__name__)

#: Shared-secret header, used in both directions. Matches the repo's `x-vr-*`
#: convention (compare `x-vr-gate-credential` in the LiveKit auth gate).
SECRET_HEADER = "x-vr-music-secret"

HEARTBEAT_PATH = "/internal/rooms/{room_id}/music/heartbeat"
TRACK_ENDED_PATH = "/internal/rooms/{room_id}/music/track-ended"


class CallbackResult(Enum):
    ACK = "ack"
    STALE = "stale"
    FAILED = "failed"


class ApiClient:
    """Small aiohttp client for the two internal callbacks."""

    def __init__(
        self,
        base_url: str,
        secret: str,
        *,
        timeout_s: float = 3.0,
        session_factory: Any | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._secret = secret
        self._timeout_s = timeout_s
        self._session_factory = session_factory
        self._session: Any | None = None
        self._lock = asyncio.Lock()

    async def _ensure_session(self) -> Any:
        if self._session is not None:
            return self._session
        async with self._lock:
            if self._session is None:
                if self._session_factory is not None:
                    self._session = self._session_factory()
                else:
                    self._session = aiohttp.ClientSession(
                        timeout=aiohttp.ClientTimeout(total=self._timeout_s)
                    )
        return self._session

    async def _post(self, path: str, payload: dict[str, Any]) -> CallbackResult:
        session = await self._ensure_session()
        url = f"{self._base_url}{path}"
        try:
            async with session.post(
                url, json=payload, headers={SECRET_HEADER: self._secret}
            ) as response:
                status = response.status
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - transport failure is a normal outcome
            LOGGER.warning("callback %s failed: %s", path, exc)
            return CallbackResult.FAILED
        if 200 <= status < 300:
            return CallbackResult.ACK
        if status in (409, 410):
            LOGGER.info("callback %s rejected as stale (%s)", path, status)
            return CallbackResult.STALE
        LOGGER.warning("callback %s returned %s", path, status)
        return CallbackResult.FAILED

    async def heartbeat(
        self,
        room_id: str,
        *,
        session_epoch: int,
        item_id: str,
        position_ms: int,
        status: str = "playing",
    ) -> CallbackResult:
        return await self._post(
            HEARTBEAT_PATH.format(room_id=room_id),
            {
                "sessionEpoch": session_epoch,
                "itemId": item_id,
                "positionMs": position_ms,
                "status": status,
            },
        )

    async def track_ended(
        self,
        room_id: str,
        *,
        session_epoch: int,
        item_id: str,
        reason: str,
        position_ms: int,
        error_code: str | None = None,
    ) -> CallbackResult:
        return await self._post(
            TRACK_ENDED_PATH.format(room_id=room_id),
            {
                "sessionEpoch": session_epoch,
                "itemId": item_id,
                "reason": reason,
                "positionMs": position_ms,
                "errorCode": error_code,
            },
        )

    async def close(self) -> None:
        session, self._session = self._session, None
        if session is None:
            return
        close = getattr(session, "close", None)
        if close is None:
            return
        result = close()
        if asyncio.iscoroutine(result):
            await result
