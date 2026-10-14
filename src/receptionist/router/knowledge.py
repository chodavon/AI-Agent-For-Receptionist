"""Match a question against staff-approved answers before calling the LLM.

If a caller asks something staff have already answered (via the review queue), that
approved answer is attached to the request, so the fast model can reply in one call
instead of searching. The model still writes the reply in the caller's own words and
language; it is never returned word for word.

Approved entries never change (an edit creates a new version with a new id), so their
embeddings are cached by id and never go stale.
"""

import asyncio
import logging
import time

from sqlalchemy.orm import Session

from receptionist.knowledge import service as knowledge
from receptionist.knowledge.models import KnowledgeEntry
from receptionist.router.embeddings import cosine, document_text
from receptionist.router.service import SkillRouter

logger = logging.getLogger(__name__)

_ENTRIES_CACHE_TTL = 30.0


class KnowledgeMatcher:
    def __init__(self, router: SkillRouter, threshold: float, lexical_threshold: float):
        self.router = router  # reuses its embedder and query-embedding cache
        self.threshold = threshold
        self.lexical_threshold = lexical_threshold
        self._vectors: dict[int, list[float]] = {}
        self._entries_cache: list[KnowledgeEntry] | None = None
        self._entries_cached_at: float = 0.0

    async def _embed_new(self, entries: list[KnowledgeEntry]) -> None:
        missing = [e for e in entries if e.id not in self._vectors]
        if not missing:
            return
        texts = [document_text(e.skill, e.question) for e in missing]
        vectors = await self.router.embedder.embed(texts)
        for entry, vec in zip(missing, vectors, strict=True):
            self._vectors[entry.id] = vec

    async def _get_entries(self, db: Session) -> list[KnowledgeEntry]:
        if (
            self._entries_cache is not None
            and time.monotonic() - self._entries_cached_at < _ENTRIES_CACHE_TTL
        ):
            return self._entries_cache
        entries = await asyncio.to_thread(knowledge.list_active, db)
        self._entries_cache = entries
        self._entries_cached_at = time.monotonic()
        return entries

    async def match(self, db: Session, question: str) -> tuple[KnowledgeEntry, float] | None:
        entries = await self._get_entries(db)
        if not entries:
            return None

        # 1) Keyword overlap: free, catches near-identical wording.
        score, entry = max(((knowledge.similarity(question, e.question), e) for e in entries),
                           key=lambda pair: pair[0])  # fmt: skip
        if score >= self.lexical_threshold:
            return entry, score

        # 2) Semantic similarity (paraphrases, other language).
        if self.router.embedder is None:
            return None
        try:
            await self._embed_new(entries)
            qvec = await self.router._query_vector(question)
        except Exception as exc:
            logger.warning("knowledge embeddings unavailable (%s)", exc)
            return None
        score, entry = max(((cosine(qvec, self._vectors[e.id]), e) for e in entries
                            if e.id in self._vectors), key=lambda pair: pair[0])  # fmt: skip
        return (entry, score) if score >= self.threshold else None
