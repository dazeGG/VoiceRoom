from __future__ import annotations

import pytest

from conftest import SECRET
from music_bot.config import DEFAULT_SOURCES, SECRET_MIN_LENGTH, ConfigError, load_config


def test_secret_is_mandatory() -> None:
    with pytest.raises(ConfigError, match="MUSIC_BOT_SECRET"):
        load_config({})


def test_a_short_secret_is_a_boot_failure() -> None:
    # The API refuses a secret under `MUSIC_BOT_SECRET_MIN_LENGTH` and disables
    # music entirely. Without the same floor here the bot would boot and serve
    # its control plane against a secret its own peer considers invalid, so the
    # two ends would disagree about what a valid deployment is.
    with pytest.raises(ConfigError, match="at least 32 characters"):
        load_config({"MUSIC_BOT_SECRET": "x"})
    with pytest.raises(ConfigError, match="MUSIC_BOT_SECRET"):
        load_config({"MUSIC_BOT_SECRET": "a" * (SECRET_MIN_LENGTH - 1)})

    # Exactly at the floor is valid.
    assert load_config({"MUSIC_BOT_SECRET": "a" * SECRET_MIN_LENGTH}).secret == (
        "a" * SECRET_MIN_LENGTH
    )


def test_surrounding_whitespace_does_not_pad_a_short_secret() -> None:
    with pytest.raises(ConfigError, match="at least 32 characters"):
        load_config({"MUSIC_BOT_SECRET": "  short  "})


def test_defaults_are_the_sources_reachable_from_russia() -> None:
    config = load_config({"MUSIC_BOT_SECRET": SECRET})
    assert config.sources == DEFAULT_SOURCES == ("vk", "rutube")
    assert config.proxy is None
    # YouTube is in the wire contract unconditionally, but unreachable here.
    assert config.source_enabled("youtube") is False
    assert config.port == 8080
    assert config.livekit_url == "ws://livekit:7880"
    assert config.api_base_url == "http://api:3000"


def test_a_proxy_turns_youtube_back_on() -> None:
    # The single switch: a Russian host can only reach YouTube through egress,
    # so configuring that egress is what makes enabling it meaningful.
    config = load_config({"MUSIC_BOT_SECRET": SECRET, "MUSIC_BOT_PROXY": "http://egress:3128"})
    assert config.sources == ("vk", "rutube", "youtube")
    assert config.proxy == "http://egress:3128"
    assert config.source_enabled("youtube") is True


def test_a_blank_proxy_is_treated_as_absent() -> None:
    config = load_config({"MUSIC_BOT_SECRET": SECRET, "MUSIC_BOT_PROXY": "   "})
    assert config.proxy is None
    assert config.sources == DEFAULT_SOURCES


def test_an_explicit_source_list_wins_over_the_proxy_default() -> None:
    config = load_config(
        {
            "MUSIC_BOT_SECRET": SECRET,
            "MUSIC_BOT_PROXY": "http://egress:3128",
            "MUSIC_BOT_SOURCES": "vk",
        }
    )
    assert config.sources == ("vk",)
    assert config.source_enabled("rutube") is False


def test_youtube_can_be_enabled_without_a_proxy() -> None:
    # A deployment outside Russia reaches it directly; the proxy default must
    # not become a requirement.
    config = load_config({"MUSIC_BOT_SECRET": SECRET, "MUSIC_BOT_SOURCES": "youtube"})
    assert config.sources == ("youtube",)
    assert config.proxy is None


def test_the_source_list_is_normalized() -> None:
    config = load_config(
        {"MUSIC_BOT_SECRET": SECRET, "MUSIC_BOT_SOURCES": " RuTube , vk ,, vk "}
    )
    assert config.sources == ("rutube", "vk")


def test_an_unknown_source_is_a_boot_failure() -> None:
    # A typo that silently disabled a source would surface weeks later as "that
    # link just stopped working", with nothing in the logs pointing at it.
    with pytest.raises(ConfigError, match="unknown source"):
        load_config({"MUSIC_BOT_SECRET": SECRET, "MUSIC_BOT_SOURCES": "vk,yandex"})
    with pytest.raises(ConfigError, match="unknown source"):
        load_config({"MUSIC_BOT_SECRET": SECRET, "MUSIC_BOT_SOURCES": "youtube.com"})


def test_a_source_list_that_names_nothing_is_a_boot_failure() -> None:
    with pytest.raises(ConfigError, match="MUSIC_BOT_SOURCES"):
        load_config({"MUSIC_BOT_SECRET": SECRET, "MUSIC_BOT_SOURCES": " , , "})


def test_an_unset_source_list_is_not_an_empty_one() -> None:
    assert load_config({"MUSIC_BOT_SECRET": SECRET, "MUSIC_BOT_SOURCES": ""}).sources == (
        DEFAULT_SOURCES
    )


def test_compose_environment_is_read() -> None:
    config = load_config(
        {
            "MUSIC_BOT_SECRET": SECRET,
            "HOST": "0.0.0.0",
            "PORT": "8080",
            "LOG_LEVEL": "debug",
            "LIVEKIT_INTERNAL_URL": "ws://livekit:7880",
            "MUSIC_BOT_API_URL": "http://api:3000/",
            "MUSIC_BOT_SOURCES": "vk,rutube,youtube",
            "MUSIC_BOT_MAX_ROOMS": "12",
        }
    )
    assert config.max_rooms == 12
    assert config.log_level == "debug"
    assert config.api_base_url == "http://api:3000"
    assert config.sources == ("vk", "rutube", "youtube")


def test_heartbeat_defaults_match_the_contract() -> None:
    config = load_config({"MUSIC_BOT_SECRET": SECRET})
    assert config.heartbeat_interval_ms == 2000
    assert config.heartbeat_interval_s == 2.0
    assert config.heartbeat_failure_limit == 5
    assert config.expand_limit == 50


def test_invalid_numeric_env_is_a_boot_failure() -> None:
    with pytest.raises(ConfigError, match="PORT"):
        load_config({"MUSIC_BOT_SECRET": SECRET, "PORT": "not-a-number"})
    with pytest.raises(ConfigError, match="MUSIC_BOT_MAX_ROOMS"):
        load_config({"MUSIC_BOT_SECRET": SECRET, "MUSIC_BOT_MAX_ROOMS": "0"})
