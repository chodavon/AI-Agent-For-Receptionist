"""Tests for the explicit Gemini prompt cache registry."""

import asyncio
from unittest.mock import AsyncMock, MagicMock

from google.genai import types

from receptionist.agent.prompt_cache import PromptCacheRegistry


def _fake_client():
    client = MagicMock()
    cache_obj = MagicMock()
    cache_obj.name = "cachedContents/abc123"
    client.aio.caches.create = AsyncMock(return_value=cache_obj)
    client.caches.delete = MagicMock()
    return client


def _dummy_args(**overrides):
    defaults = dict(
        model="gemini-3.5-flash-lite",
        skill="fees",
        fast_path=True,
        skills_version=1,
        system_instruction="You are a receptionist.",
        tools=[],
        contents=[types.Content(role="user", parts=[types.Part.from_text(text="hi")])],
    )
    defaults.update(overrides)
    return defaults


def test_create_and_hit():
    client = _fake_client()
    reg = PromptCacheRegistry(lambda: client, ttl_seconds=600)
    name = asyncio.run(reg.get_or_create(**_dummy_args()))
    assert name == "cachedContents/abc123"
    assert reg.creates == 1
    assert reg.hits == 0
    # Second call with same key should be a hit, not a create.
    name2 = asyncio.run(reg.get_or_create(**_dummy_args()))
    assert name2 == name
    assert reg.hits == 1
    assert reg.creates == 1
    assert client.aio.caches.create.await_count == 1


def test_different_skill_creates_separate_cache():
    client = _fake_client()
    reg = PromptCacheRegistry(lambda: client, ttl_seconds=600)
    asyncio.run(reg.get_or_create(**_dummy_args(skill="fees")))
    asyncio.run(reg.get_or_create(**_dummy_args(skill="admissions")))
    assert reg.creates == 2


def test_flush_clears_and_deletes():
    client = _fake_client()
    reg = PromptCacheRegistry(lambda: client, ttl_seconds=600)
    asyncio.run(reg.get_or_create(**_dummy_args()))
    assert reg.stats()["entries"] == 1
    reg.flush()
    assert reg.stats()["entries"] == 0
    client.caches.delete.assert_called_once_with(name="cachedContents/abc123")


def test_version_change_triggers_flush():
    client = _fake_client()
    reg = PromptCacheRegistry(lambda: client, ttl_seconds=600)
    asyncio.run(reg.get_or_create(**_dummy_args(skills_version=1)))
    assert reg.stats()["entries"] == 1
    # Changing skills_version auto-flushes.
    asyncio.run(reg.get_or_create(**_dummy_args(skills_version=2)))
    assert reg.creates == 2
    assert client.caches.delete.call_count == 1


def test_create_failure_returns_none():
    client = _fake_client()
    client.aio.caches.create = AsyncMock(side_effect=Exception("too small"))
    reg = PromptCacheRegistry(lambda: client, ttl_seconds=600)
    name = asyncio.run(reg.get_or_create(**_dummy_args()))
    assert name is None
    assert reg.failures == 1
    assert reg.stats()["entries"] == 0


def test_stats_shape():
    reg = PromptCacheRegistry(lambda: None, ttl_seconds=600)
    s = reg.stats()
    assert set(s.keys()) == {"entries", "hits", "creates", "failures", "hit_rate"}
    assert s["hit_rate"] == 0.0
