# Research log

Findings gathered while building this project. Format per the session prompt (section 4):

> Topic — Date checked — Key finding — Source — Decision for this project


New entries go at the **top**. One line per finding; put details in a sub-bullet.

---

## 2026-10-13 — AI receptionist best-practice research

Research gathered to answer "why is my agent slow, and what do experts build?".
Decisions below are tasks in `docs/PLAN.md`, Appendices A and B.

### Architecture and conversation design

- **Receptionist stack shape — 2026-10-13 — Expert receptionists are built as a five-layer stack: telephony → real-time transport → model stack → orchestration → eval/observability; most production bugs are at the seams, not in any one layer — [snsys.ai: How AI Receptionists Work](https://snsys.ai/research/how-ai-receptionists-work-architecture-performance-and-what-ctos-need-to-know/) — Keep our FastAPI orchestration + Gemini model stack. The eval/observability layer is thin today → task B.5 (tracing) and B.6 (scenario evals).**

- **Configurable-by-design beats closed-off-the-shelf — 2026-10-13 — The fastest-growing receptionist architecture is "configurable by design": behaviour, model and integrations editable from an admin panel without code — [getvoip.com: AI Receptionist Guide 2026](https://getvoip.com/blog/how-to-build-an-ai-receptionist/) — Matches our skills/ + /admin design. Keep going; add workflow-editing in the admin page later (B.8).**

- **Progressive information collection — 2026-10-13 — Collect details step by step, one question per turn, with confirmation, instead of a form — [botpress.com: Conversational AI Design 2026](https://botpress.com/blog/conversation-design) — Already implemented in `skills/admissions/workflow.yaml`. Task B.8: add workflows for "leave a message", "parent-teacher meeting", "report an absence".**

- **Guided choice chips — 2026-10-13 — 2-4 quick-reply options after an open question improves completion rate by about 20 % because users don't have to guess what the bot can do — [voiceflow.com: Conversational AI Design Guide 2026](https://www.voiceflow.com/blog/conversation-design) — Task B.8: SSE `done` event carries `suggestions: [...]`; UI renders chips.**

- **Inline confidence hints + source citations — 2026-10-13 — Strong patterns for AI uncertainty are inline confidence indicators and source citations on factual claims (which skill, when updated); hedging language calibrated to actual reliability — [parallelhq.com: Designing AI Chatbots UX Principles 2026](https://www.parallelhq.com/blog/ux-ai-chatbots) — Task B.8: when router top score is 0.5-0.65, ask a disambiguating question; add a "From <skill> · updated <date>" line under each reply.**

- **Avoid FAQ-monologue tone — 2026-10-13 — IBM's natural conversation framework: be concise, no FAQ-style monologues, test with real interactions — [lollypop.design: Chatbot UI UX Best Practices 2026](https://lollypop.design/blog/2025/january/chatbot-ui-ux-design-best-practices-examples/) — Our prompt already caps replies at 1-4 sentences. Keep.**

### Latency and cost

- **Prompt caching boundary matters — 2026-10-13 — Caching the whole prompt can increase TTFT because per-request changes bust the cache; cache only the stable prefix (system prompt + skills index + tool defs). Reported gains with correct boundaries: TTFT 13-31 % drop, cost 41-80 % drop — [arXiv 2601.06007: Don't Break the Cache](https://arxiv.org/pdf/2601.06007) and [getmaxim.ai: Reduce LLM Cost and Latency 2026](https://www.getmaxim.ai/articles/reduce-llm-cost-and-latency-a-comprehensive-guide-for-2026/) — Task B.4 (explicit caching): one `client.caches.create` per `(school_name, skills.version)`; per-request content stays uncached.**

- **Semantic answer cache: 7x speedup on hits — 2026-10-13 — Semantic caching keyed by question embedding (not raw text) cuts median latency ~850 ms → ~120 ms on cache hits (7×) and 40-70 % cost reduction on repetitive workloads — [redis.io: LLM Router Architecture 2026](https://redis.io/blog/llm-router-architecture-best-practices/) and [dev.to: Top AI Gateways with Semantic Caching 2026](https://dev.to/kuldeep_paul/top-ai-gateways-with-semantic-caching-and-dynamic-routing-2026-guide-4a0g) — Task B.3: new `answer_cache` table, 24-h TTL, flush on skill/knowledge change. Our `router/knowledge.py` is NOT this (it still goes through the LLM).**

- **Multi-model LLM routing — 2026-10-13 — Smallest-model-first routing (nano for greetings, lite for FAQ, full for reasoning) saves money and latency without hurting quality — [getmaxim.ai: Top 5 LLM Router Solutions 2026](https://www.getmaxim.ai/articles/top-5-llm-router-solutions-in-2026/) and [arXiv 2603.21354: Workload-Router-Pool Architecture](https://arxiv.org/pdf/2603.21354) — Task B.9: add `agent/model_selector.py` that picks by route, workflow and language.**

- **12 Pipecat latency techniques — 2026-10-13 — Overlap tool work with LLM prefill; stream tool dispatch; use streaming STT, streaming LLM tokens, streaming TTS; set strict timeouts; warm models at startup — [futureagi.com: Optimize Pipecat Latency 2026](https://futureagi.com/blog/how-to-optimize-pipecat-latency-2026/) — We already do streaming end-to-end and STT warm-up (Phase 1). Tool-prefill overlap is a future optimisation; parked.**

### Retrieval (routing + knowledge)

- **Hybrid retrieval is now the production default — 2026-10-13 — Dense embeddings + sparse (BM25) search, fused with Reciprocal Rank Fusion (RRF), consistently beats either alone by 5-15 % recall. Dense catches paraphrases ("how much do you charge" vs "fees"), sparse catches rare terms and codes ("Grade 7", "ADM-2024") — [denser.ai: Hybrid Search for RAG 2026](https://denser.ai/blog/hybrid-search-for-rag/), [stackai.com: RAG Best Practices](https://www.stackai.com/insights/retrieval-augmented-generation-(rag)-best-practices-for-enterprise-ai-chunking-embeddings-reranking-and-hybrid-search-optimization) and [infoq.com: Why Vector Search Alone Isn't Enough](https://www.infoq.com/articles/vector-search-hybrid-retrieval-rag/) — Task B.1: fuse `router/lexical.py` + `router/embeddings.py` with RRF; same for `router/knowledge.py`.**

- **BM25 beats plain IDF — 2026-10-13 — BM25 extends TF-IDF with term-saturation, reducing the weight of extremely frequent words that carry little meaning — [arXiv 2607.26497: BM25 Wins at Scale](https://arxiv.org/pdf/2607.26497) — Task B.1: replace plain IDF with `rank_bm25.BM25Okapi` (we see this exact noise-word problem; already partly fixed on 2026-10-10 with IDF, BM25 is the step up).**

- **Cross-encoder or LLM reranker on top-K — 2026-10-13 — After hybrid retrieval, rerank the top K with a cross-encoder or lite-model LLM judge; adds another 5-15 % recall and widens margins so ambiguous cases become clear wins — [stackai.com: RAG Best Practices](https://www.stackai.com/insights/retrieval-augmented-generation-(rag)-best-practices-for-enterprise-ai-chunking-embeddings-reranking-and-hybrid-search-optimization) and [decodethefuture.org: RAG 10 Steps to Production 2026](https://decodethefuture.org/en/rag/) — Task B.2: `router/rerank.py` using `gemini-3.5-flash-lite` with `response_schema`, only invoked when top-2 margin is thin.**

### Evaluation and observability

- **Tracing is the number-one production gap — 2026-10-13 — Every 2026 production voice-agent guide names tracing + eval loop as the biggest gap. Trace every turn as `span(name="turn")` with child spans per router step, LLM call and tool call — [futureagi.com: Voice AI Observability for Vapi 2026](https://futureagi.com/blog/voice-ai-observability-vapi-2026/) and [getmaxim.ai: Observability for Tool-Calling Agents](https://www.getmaxim.ai/articles/observability-and-evaluation-strategies-for-tool-calling-ai-agents-a-complete-guide/) — Task B.5: add Langfuse (self-hostable, free Python SDK) behind `TRACING_ENABLED`. Hook into existing `TurnStats`.**

- **Simulated callers for end-to-end eval — 2026-10-13 — Real-world voice/chat eval uses an LLM playing a persona that drives multi-turn conversations with an expected end-state; one-shot Q&A misses workflow regressions, clarifications and interruptions — [futureagi.com: Evaluate Voice AI End-to-End 2026](https://futureagi.com/blog/how-to-evaluate-voice-ai-agents-end-to-end-2026/) and [coval.ai: Voice AI Agent Architecture, Deployment, Evaluation](https://www.coval.ai/blog/voice-ai-agents-architecture-deployment-evaluation/) — Task B.6: `scripts/run_scenarios.py` with persona YAML and an LLM judge. Target scenarios: fee question, unknown topic, campus-tour workflow, prompt injection, mixed EN/KM, angry caller, interrupted booking.**

- **Error-feed clustering with auto root-cause — 2026-10-13 — Modern eval engines ship with 70+ rubrics (accuracy, resolution, audio-transcription accuracy) and automatically cluster failures with an LLM-written root cause note — [getmaxim.ai: Observability for Tool-Calling Agents](https://www.getmaxim.ai/articles/observability-and-evaluation-strategies-for-tool-calling-ai-agents-a-complete-guide/) — Not building ourselves; use Langfuse's free tier for failure clustering (part of B.5).**

### Guardrails and architecture templates

- **Four-stage guardrails: input → plan → tool → output — 2026-10-13 — Production agent blueprints wrap the LLM in four control stages; the output stage includes a numeric fact-check against tool results — [medium.com: Agentic AI Architecture Production-Ready Guide](https://medium.com/agenticai-the-autonomous-intelligence/agentic-ai-architecture-a-practical-production-ready-guide-2b2aa6d16118) and [developers.openai.com: Voice agents guide](https://developers.openai.com/api/docs/guides/voice-agents) — Task B.7: extract `agent/guardrails.py` with the four stages; add numeric fact-check (every `[0-9][0-9,.]*` in the reply must appear in a reference bundle or tool result from this turn).**

- **Reference FastAPI agent template — 2026-10-13 — The widely-used reference template for "FastAPI + LangGraph agent" covers stateful conversations, long-term memory, tool calling, Langfuse tracing, Prometheus metrics, rate limiting and auth — [github.com/wassim249: fastapi-langgraph-agent-production-ready-template](https://github.com/wassim249/fastapi-langgraph-agent-production-ready-template) — Not switching to LangGraph (own tool loop works). Cherry-pick: Langfuse + Prometheus patterns in B.5 and health/metrics endpoints we already have.**

### Streaming and realtime

- **Streaming-input APIs went mainstream in January 2026 — 2026-10-13 — WebSocket-based streaming input (incremental audio/video) landed in major model APIs in Jan 2026; the right default for a voice-call architecture — [latitude.so: Real-Time LLMs Optimizing Latency in Streaming](https://latitude.so/blog/real-time-llms-optimizing-latency-streaming) — Not applicable to our push-to-talk design (we send one blob to STT, not a stream). Revisit if the project pivots to live phone calls (Section 8 escalation).**

### Multilingual (English + Khmer)

- **Hybrid retrieval especially helps non-English — 2026-10-13 — For low-resource languages, dense embeddings are weak on domain terms; sparse BM25 anchored on untranslated terms fills the gap. Khmer bigrams work as the sparse tokeniser — [arXiv 2604.22095: End-to-End Ukrainian RAG with Hybrid Search](https://arxiv.org/pdf/2604.22095) — Our router already has Khmer bigrams in `router/lexical.py` (added 2026-10-10). Task B.1 (BM25 + RRF) amplifies this.**

### What this research changed about our priorities

Appendix A in `docs/PLAN.md` was already set from live log analysis. Appendix B
added these research-driven items in priority order:

1. B.1 Hybrid + RRF
2. B.2 Reranker
3. B.3 Semantic answer cache
4. B.5 Tracing (Langfuse)
5. B.6 Scenario evals
6. B.4 Explicit prompt caching
7. B.7 Guardrails module
8. B.8 UX patterns
9. B.9 Model selector

Nothing in the research contradicts anything already shipped. Several items
confirm Phase 2 design choices (user turn for references, hybrid routing).

---

## 2026-10-12 (bootstrap entry)

Earlier research was gathered while implementing phases 0–5 but was not written up as a
separate file. The decisions it led to are recorded here from the project state.

- **Project shape — 2026-10-12 — This is a chat + voice-message web app, not a realtime
  phone agent — code, pyproject.toml — Keep FastAPI + google-genai + faster-whisper. Live
  telephony (LiveKit / Pipecat / Twilio) is a Section 8 escalation; not in scope until the
  school asks for it.**

- **Streaming — 2026-10-10 — `client.aio.models.generate_content_stream` is an async
  coroutine that returns an async iterator; one shared HTTP connection — google-genai 2.29
  release notes + SDK source — Use it for `/api/chat/stream`; keep the sync `generate_content`
  only for drafts and summaries.**

- **Retry and timeout — 2026-10-10 — `HttpOptions(timeout, retry_options=HttpRetryOptions(
  attempts, initial_delay, max_delay, http_status_codes=[408,500,502,503,504]))` — google-genai
  docs — Default `LLM_TIMEOUT_MS=20000`, `LLM_RETRY_ATTEMPTS=2`. **Do not list 429** in the
  retry codes: on the free tier a 429 means the daily cap is hit, and retrying just wastes
  the quota.**

- **Thinking level — 2026-10-10 — `ThinkingConfig(thinking_level=LOW)` is Google's
  recommendation for fact look-ups — Gemini 3 docs — Default `THINKING_LEVEL=low`. Only use
  `medium` for multi-step workflows (`workflow.yaml`).**

- **Embeddings — 2026-10-10 — `gemini-embedding-2` encodes the task in the text:
  `task: search result | query: <q>` for queries and `title: <t> | text: <d>` for documents;
  one Content per text — Gemini embeddings docs — Implemented in
  `src/receptionist/router/embeddings.py`. Use with cosine similarity + an LRU cache of 512
  queries.**

- **Fallback on overload — 2026-10-10 — The SDK raises on 503 "overloaded"; retries alone
  don't help on repeated overload — google-genai error semantics — Switch to
  `GEMINI_FALLBACK_MODEL` **only before any text has been streamed**, so partial answers
  are never duplicated.**

- **429 circuit breaker — 2026-10-10 — Free-tier 429s come in bursts; retrying for 60 s on
  the same model is wasted — live measurement with the user's key — After a 429, mark that
  model name as cooling down for `QUOTA_COOLDOWN_SECONDS=60` and skip it until then.**

- **Prompt-injection boundary — 2026-10-10 — Any content attached by the server must stay
  in a *user* turn, not the system prompt, so the model treats it as context rather than
  instructions; a tagged block like `<school_reference skill="...">` plus a rule to ignore
  the same tag inside caller text — OWASP LLM01 guidance + Google prompt-injection notes —
  Implemented in `agent/prompts.py` and `agent/client.py` (`reference_block()`,
  `caller_text()` neutralise fake tags).**

- **Prompt cache stability — 2026-10-10 — Gemini's implicit prefix cache needs the first N
  tokens to be byte-identical across calls; put everything that changes per request *after*
  the stable prefix — Gemini caching docs — The system prompt is built once and does not
  include timestamps or per-call data. Explicit `client.caches.create` is deferred to
  Phase 6 (see `need-improve.md` 16.2).**

- **STT model loading — 2026-10-10 — faster-whisper loads the model on first use, which
  caused a ~5 s delay on the first voice message — faster-whisper README + live
  measurement — `voice/stt.py:warm_up()` loads models at startup, called from
  `main.py:lifespan()`.**

- **Khmer tokenisation — 2026-10-10 — Khmer is written without spaces between words; a
  simple whitespace tokeniser destroys recall — language docs + manual test with real
  phrases — Added Khmer bigram tokens on top of English stemming in
  `src/receptionist/router/lexical.py`.**

- **IDF for lexical routing — 2026-10-10 — Plain term-overlap scoring matched noise words
  ("the school", "please") — manual router runs on the eval set — Switched to IDF-weighted
  scoring in `router/lexical.py`; thresholds `ROUTER_LEXICAL_THRESHOLD=0.35`, margin 0.1.**

- **Rolling summaries — 2026-10-10 — Research shows a running summary beats a hard reset
  for long chats; running it in the background keeps the critical path fast — OpenAI,
  Anthropic agent-memory posts — `agent/memory.py:summary_config()` runs the summariser as a
  background task after the user turn is sent, with optimistic concurrency on a turn
  counter.**

- **SSE in FastAPI — 2026-10-10 — Using `sse-starlette`'s `EventSourceResponse` as
  `response_class=` with the slowapi decorator raised "coroutine is not iterable" — live
  error + slowapi issue tracker — Return `EventSourceResponse(events(), headers=...)`
  directly from the handler instead.**

- **Export to `faq.md` — 2026-10-10 — Lines starting with `#` in the answer could become
  new H2 headings that act as unintended routing examples — `skills/loader.py:example_questions`
  — `admin/export.py` escapes `#` lines (`\#...`) and bails out when the file is read-only
  (Docker read-only mount).**

- **Routing-example safety — 2026-10-10 — Automatically-learned routing examples are
  low-risk because routing only decides *which approved content* to show, never *what the
  facts are*; dedupe to avoid drift — OWASP LLM03 (training-data poisoning) — Dedupe at
  0.8 cosine similarity, cap 50 per skill, admins can delete any.**

---

## How to add an entry

Research before, then write it here before changing code:

```
- **<Topic> — YYYY-MM-DD — <one-sentence finding> — <source URL or doc path> — <decision>.**
  - Optional details, numbers, trade-offs.
```

If a finding contradicts `PLAN.md` or `need-improve.md`, flag it in that document too.
