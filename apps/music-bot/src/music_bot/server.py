"""Inbound control API.

    GET    /healthz                     unauthenticated liveness probe
    POST   /resolve                     link -> queue metadata
    POST   /sessions/{roomId}/play      start (or replace) the playing item
    DELETE /sessions/{roomId}           leave the room

Every route except `/healthz` requires the shared secret in the
`x-vr-music-secret` header. `/healthz` is exempt so the container healthcheck
does not need the secret; it returns nothing but counters and a readiness flag.

Network placement is containment, not authorisation: the port is unpublished in
production compose and loopback-bound in dev, but neither fact is what makes a
request safe to serve - the secret check is. Treat every request as reachable.
"""

from __future__ import annotations

import hmac
import logging
from typing import Any

from aiohttp import web

from .config import Config
from .control_plane import SECRET_HEADER, ApiClient
from .errors import (
    RESOLVER_UNAVAILABLE,
    UNAUTHORIZED,
    InvalidRequestError,
    MusicBotError,
    UnavailableError,
)
from .links import parse_link
from .publisher import LiveKitPublisher
from .resolver import Resolver, build_resolver
from .session import PlayRequest, SessionManager

LOGGER = logging.getLogger(__name__)

CONFIG_KEY = web.AppKey("music_bot_config", Config)
RESOLVER_KEY = web.AppKey("music_bot_resolver", Resolver)  # type: ignore[type-abstract]
API_KEY = web.AppKey("music_bot_api", ApiClient)
MANAGER_KEY = web.AppKey("music_bot_manager", SessionManager)


def _error_response(exc: MusicBotError) -> web.Response:
    body: dict[str, Any] = {
        "status": "unavailable" if isinstance(exc, UnavailableError) else "error",
        "error": exc.code,
        "message": exc.message,
    }
    return web.json_response(body, status=exc.status)


@web.middleware
async def auth_middleware(request: web.Request, handler: Any) -> web.StreamResponse:
    if request.path == "/healthz":
        return await handler(request)
    config = request.app[CONFIG_KEY]
    provided = request.headers.get(SECRET_HEADER, "")
    # Compared as bytes: aiohttp hands header values back latin-1-decoded, and
    # `compare_digest` raises `TypeError` on a `str` with any codepoint above
    # U+007F. Comparing the decoded strings directly would turn a crafted header
    # into a 500 from `error_middleware` instead of a clean 401 - and would make
    # "is this secret non-ASCII?" observable in the status code. latin-1 is the
    # exact inverse of aiohttp's decode, so it never raises here.
    if not provided or not hmac.compare_digest(
        provided.encode("latin-1", "replace"), config.secret.encode("utf-8")
    ):
        return web.json_response(
            {"status": "error", "error": UNAUTHORIZED, "message": "invalid or missing secret"},
            status=401,
        )
    return await handler(request)


@web.middleware
async def error_middleware(request: web.Request, handler: Any) -> web.StreamResponse:
    try:
        return await handler(request)
    except MusicBotError as exc:
        return _error_response(exc)
    except web.HTTPException:
        raise
    except Exception:
        LOGGER.exception("unhandled error in %s %s", request.method, request.path)
        return web.json_response(
            {"status": "error", "error": "internal_error", "message": "unhandled error"},
            status=500,
        )


async def _json_body(request: web.Request) -> Any:
    try:
        return await request.json()
    except Exception as exc:
        raise InvalidRequestError("request body is not valid JSON") from exc


def _require_resolver(resolver: Resolver) -> None:
    """Refuse work the resolver cannot do, without taking the service down.

    Note what this does *not* cover: a link from a source that is simply not in
    `MUSIC_BOT_SOURCES`. That is not a resolver outage - the resolver is fine and
    every other source still works - so it is refused per-link with
    `source_unavailable` inside the resolver itself, where the enabled set lives.
    """

    if not resolver.available:
        raise UnavailableError("the media resolver is not available", code=RESOLVER_UNAVAILABLE)


async def handle_healthz(request: web.Request) -> web.Response:
    config = request.app[CONFIG_KEY]
    resolver = request.app[RESOLVER_KEY]
    manager = request.app[MANAGER_KEY]
    return web.json_response(
        {
            "status": "ok",
            "resolver": "ready" if resolver.available else "unavailable",
            # Which sources this deployment will actually serve. Operational
            # fact, reported rather than guessed: the wire contract lists all
            # three unconditionally and the client must not be rebuilt to
            # change what is reachable.
            "sources": list(config.sources),
            "proxy": bool(config.proxy),
            "rooms": manager.room_count,
            "maxRooms": config.max_rooms,
        }
    )


async def handle_resolve(request: web.Request) -> web.Response:
    config = request.app[CONFIG_KEY]
    resolver = request.app[RESOLVER_KEY]
    body = await _json_body(request)
    if not isinstance(body, dict):
        raise InvalidRequestError("request body must be a JSON object")

    _require_resolver(resolver)

    link = parse_link(body.get("link"))

    raw_limit = body.get("limit", config.expand_limit)
    if not isinstance(raw_limit, int) or isinstance(raw_limit, bool) or raw_limit < 1:
        limit = config.expand_limit
    else:
        limit = min(raw_limit, config.expand_limit)

    resolved = await resolver.expand(link, limit)
    return web.json_response({"status": "ok", **resolved.to_json()})


async def handle_play(request: web.Request) -> web.Response:
    config = request.app[CONFIG_KEY]
    resolver = request.app[RESOLVER_KEY]
    manager = request.app[MANAGER_KEY]

    room_id = request.match_info["roomId"]
    body = await _json_body(request)
    play_request = PlayRequest.from_json(room_id, body, default_livekit_url=config.livekit_url)

    _require_resolver(resolver)

    snapshot = await manager.play(play_request)
    return web.json_response({"status": "playing", **snapshot}, status=202)


async def handle_stop(request: web.Request) -> web.Response:
    manager = request.app[MANAGER_KEY]
    room_id = request.match_info["roomId"]

    raw_epoch = request.query.get("sessionEpoch")
    epoch: int | None = None
    if raw_epoch is not None:
        try:
            epoch = int(raw_epoch)
        except ValueError as exc:
            raise InvalidRequestError("sessionEpoch must be an integer") from exc

    stopped = await manager.stop(room_id, epoch)
    return web.json_response({"status": "idle", "roomId": room_id, "stopped": stopped})


def build_app(
    config: Config,
    *,
    resolver: Resolver | None = None,
    api: ApiClient | None = None,
    manager: SessionManager | None = None,
    publisher_factory: Any = LiveKitPublisher,
    decoder_factory: Any = None,
) -> web.Application:
    resolver = resolver if resolver is not None else build_resolver(
        config.sources, proxy=config.proxy, timeout_s=config.resolve_timeout_s
    )
    api = api if api is not None else ApiClient(
        config.api_base_url, config.secret, timeout_s=config.callback_timeout_s
    )
    manager = manager if manager is not None else SessionManager(
        config,
        resolver,
        api,
        publisher_factory=publisher_factory,
        decoder_factory=decoder_factory,
    )

    app = web.Application(middlewares=[error_middleware, auth_middleware])
    app[CONFIG_KEY] = config
    app[RESOLVER_KEY] = resolver
    app[API_KEY] = api
    app[MANAGER_KEY] = manager

    app.router.add_get("/healthz", handle_healthz)
    app.router.add_post("/resolve", handle_resolve)
    app.router.add_post("/sessions/{roomId}/play", handle_play)
    app.router.add_delete("/sessions/{roomId}", handle_stop)

    async def _cleanup(app: web.Application) -> None:
        await app[MANAGER_KEY].shutdown()
        await app[API_KEY].close()
        await app[RESOLVER_KEY].close()

    app.on_cleanup.append(_cleanup)
    return app
