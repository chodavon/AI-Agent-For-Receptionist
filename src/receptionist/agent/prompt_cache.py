"""Explicit Gemini prompt caching.

Gemini already does implicit caching when prefixes match (free, best-effort). This
adds **explicit** caches via `client.caches.create()` which:
- give a predictable cache hit (not best-effort),
- cost ~25% of normal input tokens on cached content,
- let us bundle the skill content once per TTL and reuse it across many callers.

Opt-in via `PROMPT_CACHE_ENABLED=true`. The content being cached must be large enough
(≥ 1024 tokens for Flash family). The skill bundle usually clears that bar; a small
skill will silently fail to create a cache and the normal path is used instead.
"""

import logging
import threading
from typing import Any

from google.genai import types

logger = logging.getLogger(__name__)


class PromptCacheRegistry:
    """Lazily create and track explicit Gemini caches per (model, skill, fast_path).

    All caches are deleted when flush() is called (on skills reload) so stale skill
    content never ends up on a live cache.
    """

    def __init__(self, get_client: Any, ttl_seconds: int = 3600):
        self._get_client = get_client
        self._ttl_seconds = ttl_seconds
        self._caches: dict[tuple[str, str, bool], str] = {}
        self._skills_version: int = -1
        self._lock = threading.Lock()
        self.hits = 0
        self.creates = 0
        self.failures = 0

    def stats(self) -> dict:
        total = self.hits + self.creates
        return {
            "entries": len(self._caches),
            "hits": self.hits,
            "creates": self.creates,
            "failures": self.failures,
            "hit_rate": round(self.hits / total, 3) if total else 0.0,
        }

    def flush(self) -> None:
        """Delete every cache we created. Safe to call even when nothing was created."""
        with self._lock:
            if not self._caches:
                return
            try:
                client = self._get_client()
            except Exception:
                self._caches.clear()
                return
            for name in list(self._caches.values()):
                try:
                    client.caches.delete(name=name)
                except Exception as exc:
                    logger.warning("could not delete cache %s: %s", name, exc)
            logger.info("prompt cache registry flushed (%d entries)", len(self._caches))
            self._caches.clear()

    async def get_or_create(
        self,
        *,
        model: str,
        skill: str,
        fast_path: bool,
        skills_version: int,
        system_instruction: str,
        tools: list[types.Tool],
        contents: list[types.Content],
    ) -> str | None:
        """Return a cache name for this (model, skill, fast_path), creating it if needed.

        Returns None on failure (common: content too small for the model's minimum
        cache size). Caller must then use the uncached path.
        """
        if skills_version != self._skills_version:
            self.flush()
            self._skills_version = skills_version
        key = (model, skill, fast_path)
        if key in self._caches:
            self.hits += 1
            return self._caches[key]
        try:
            client = self._get_client()
            cache = await client.aio.caches.create(
                model=model,
                config=types.CreateCachedContentConfig(
                    contents=contents,
                    system_instruction=system_instruction,
                    tools=tools,
                    ttl=f"{self._ttl_seconds}s",
                ),
            )
        except Exception as exc:
            self.failures += 1
            logger.info("prompt cache create skipped for %s/%s: %s", model, skill, exc)
            return None
        name = getattr(cache, "name", None)
        if not name:
            self.failures += 1
            return None
        with self._lock:
            self._caches[key] = name
        self.creates += 1
        logger.info("prompt cache created %s for %s/%s (fast=%s)", name, model, skill, fast_path)
        return name
