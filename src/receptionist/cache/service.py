"""Semantic answer cache: skip the LLM when a near-identical question was just answered.

A caller asks "how much is grade 7 tuition?" and the agent answers. The next caller asks
"what's the fee for grade 7?" — same question, different wording. The cache embeds every
reply's question and, on a cosine match >= threshold (default 0.95), returns the earlier
answer instantly without touching Gemini.

In-memory only: survives one process, flushes on skills/knowledge changes. Not persisted
to disk because stale answers after a skill edit would be worse than a 2 s re-generation.
"""

import asyncio
import logging
import time
from dataclasses import dataclass

from receptionist.router.embeddings import GeminiEmbedder, Vector, cosine, query_text

logger = logging.getLogger(__name__)


@dataclass
class CachedAnswer:
    question: str
    answer: str
    lang: str
    vector: Vector
    created_at: float
    hits: int = 0


class AnswerCache:
    def __init__(
        self,
        embedder: GeminiEmbedder | None,
        threshold: float = 0.95,
        max_entries: int = 500,
    ):
        self.embedder = embedder
        self.threshold = threshold
        self.max_entries = max_entries
        self._entries: list[CachedAnswer] = []
        self._lock = asyncio.Lock()
        self.hits = 0
        self.misses = 0

    def flush(self) -> None:
        """Drop all entries. Call when skills, knowledge, or routing examples change."""
        if self._entries:
            logger.info("answer cache flushed (%d entries)", len(self._entries))
        self._entries.clear()

    def size(self) -> int:
        return len(self._entries)

    def stats(self) -> dict:
        total = self.hits + self.misses
        return {
            "entries": len(self._entries),
            "hits": self.hits,
            "misses": self.misses,
            "hit_rate": round(self.hits / total, 3) if total else 0.0,
        }

    async def _embed(self, question: str) -> Vector | None:
        if self.embedder is None:
            return None
        try:
            (vec,) = await self.embedder.embed([query_text(question)])
            return vec
        except Exception as exc:
            logger.warning("answer cache embedding failed (%s)", exc)
            return None

    async def lookup(self, question: str, qvec: Vector | None = None) -> CachedAnswer | None:
        """Return a cached answer if any entry matches >= threshold, else None."""
        if self.embedder is None or not self._entries:
            self.misses += 1
            return None
        if qvec is None:
            qvec = await self._embed(question)
            if qvec is None:
                self.misses += 1
                return None
        best, best_score = None, -1.0
        for entry in self._entries:
            s = cosine(qvec, entry.vector)
            if s > best_score:
                best, best_score = entry, s
        if best is not None and best_score >= self.threshold:
            best.hits += 1
            self.hits += 1
            logger.info("answer cache HIT score=%.3f for %r", best_score, question[:60])
            return best
        self.misses += 1
        return None

    async def store(
        self, question: str, answer: str, lang: str, qvec: Vector | None = None
    ) -> None:
        """Add a new entry. Caller must ensure the answer is safe to replay
        (no tool errors, no log_unanswered, no block)."""
        if self.embedder is None or not question.strip() or not answer.strip():
            return
        async with self._lock:
            if qvec is None:
                qvec = await self._embed(question)
                if qvec is None:
                    return
            self._entries.append(
                CachedAnswer(
                    question=question,
                    answer=answer,
                    lang=lang,
                    vector=qvec,
                    created_at=time.monotonic(),
                )
            )
            if len(self._entries) > self.max_entries:
                # Evict least-useful: lowest hits, then oldest.
                self._entries.sort(key=lambda e: (e.hits, e.created_at))
                self._entries = self._entries[-self.max_entries :]
