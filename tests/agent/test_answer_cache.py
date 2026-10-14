"""Semantic answer cache: identical questions hit the cache instead of the LLM."""

import asyncio

from receptionist.cache.service import AnswerCache
from receptionist.router.embeddings import normalize


class FakeEmbedder:
    """Deterministic: same text -> same vector."""

    def __init__(self):
        self.calls = 0

    async def embed(self, texts):
        import hashlib

        self.calls += len(texts)
        # Hash the text to a stable slot in a 1024-dim one-hot vector.
        # Identical text -> identical vector; different text -> near-orthogonal.
        dim = 1024
        vectors = []
        for t in texts:
            vec = [0.0] * dim
            slot = int.from_bytes(hashlib.sha256(t.encode()).digest()[:4], "big") % dim
            vec[slot] = 1.0
            vectors.append(normalize(vec))
        return vectors


def test_cache_hit_on_exact_question():
    async def run():
        cache = AnswerCache(FakeEmbedder(), threshold=0.95, max_entries=10)
        await cache.store("How much is tuition?", "USD 2900/year.", "en")
        hit = await cache.lookup("How much is tuition?")
        assert hit is not None
        assert hit.answer == "USD 2900/year."
        assert cache.hits == 1

    asyncio.run(run())


def test_cache_miss_on_unrelated_question():
    async def run():
        cache = AnswerCache(FakeEmbedder(), threshold=0.95, max_entries=10)
        await cache.store("Tell me about scholarships", "Available for grades 7+.", "en")
        hit = await cache.lookup("How do I register a bus route??")
        assert hit is None
        assert cache.misses == 1

    asyncio.run(run())


def test_flush_drops_all_entries():
    async def run():
        cache = AnswerCache(FakeEmbedder(), threshold=0.95, max_entries=10)
        await cache.store("q1", "a1", "en")
        await cache.store("q2", "a2", "en")
        assert cache.size() == 2
        cache.flush()
        assert cache.size() == 0

    asyncio.run(run())


def test_stats_shape():
    cache = AnswerCache(FakeEmbedder(), threshold=0.95, max_entries=10)
    stats = cache.stats()
    assert set(stats) == {"entries", "hits", "misses", "hit_rate"}


def test_disabled_without_embedder():
    async def run():
        cache = AnswerCache(None, threshold=0.95, max_entries=10)
        await cache.store("q", "a", "en")
        assert cache.size() == 0
        hit = await cache.lookup("q")
        assert hit is None

    asyncio.run(run())


def test_eviction_when_over_max_entries():
    async def run():
        cache = AnswerCache(FakeEmbedder(), threshold=0.95, max_entries=3)
        for i in range(5):
            await cache.store(f"question {i}", f"answer {i}", "en")
        assert cache.size() == 3

    asyncio.run(run())
