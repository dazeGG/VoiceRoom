"""Process entry point.

A missing `MUSIC_BOT_SECRET` is fatal, because starting without it would expose
an unauthenticated control plane, and an unknown name in `MUSIC_BOT_SOURCES` is
fatal because it is a deployment typo that would otherwise surface much later as
"that link stopped working". Everything else degrades: a source this deployment
cannot reach answers `source_unavailable` per link, and the rest of the stack
keeps working (AC-9).
"""

from __future__ import annotations

import logging
import sys

from aiohttp import web

from .config import ConfigError, load_config
from .server import build_app


def _configure_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


def main() -> int:
    try:
        config = load_config()
    except ConfigError as exc:
        print(f"music-bot: {exc}", file=sys.stderr)
        return 2

    _configure_logging(config.log_level)
    logger = logging.getLogger("music_bot")

    logger.info(
        "music-bot sources: %s (proxy %s)",
        ", ".join(config.sources),
        "configured" if config.proxy else "not configured",
    )

    app = build_app(config)
    logger.info("music-bot listening on %s:%s", config.host, config.port)
    web.run_app(app, host=config.host, port=config.port, print=None)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
