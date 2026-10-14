# Plan: Faster, Smarter Receptionist Responses

> Copy of the original plan (from C:\Users\ASUS\.claude\plans\i-wanna-build-an-goofy-noodle.md).
> **Status (2026-10-10):** Phases 0-5 ✅ done · Phase 6 ⏳ not started.
> For what was actually built, the files changed and the next steps, see [PROGRESS.md](PROGRESS.md).
> Line numbers in the "file-by-file map" refer to the code *before* the work started.


## Context
The agent works, but every answer is slow, and it only "learns" when staff approve an
unanswered question. You want answers that feel as fast as ChatGPT, Gemini or Claude apps:
- known questions and workflows are answered straight from `skills/`;
- the agent uses the caller's context within a conversation;
- the system learns from what callers ask and how good the answers were.

### Why it is slow today (from the current code)
In `src/receptionist/agent/client.py`, a typical question costs **three model calls, one after
another**:

```
call 1: model picks a skill   → load_skill
call 2: model needs details   → read_skill_file (e.g. fees.yaml)
call 3: model writes answer
```

On top of that:
- The reply is only sent once all three calls are finished. Nothing is streamed.
- Speech-to-text loads the Whisper model on the first voice message, so that message waits
  for it.
- Spoken audio (TTS) only starts after the full text is ready.
- Nothing is cached, not even for a question asked 100 times a day.

**Target:** the first words appear in under 1 second, and a typical answer finishes in about
1.5-2.5 s. Today each answer needs three model calls plus waiting for the whole reply. Quality
must not drop; the eval in Phase 0 proves it.

---

## Phase 0: Measure first (needed to prove every later gain)
- Add timing for every stage to each request: `stt_ms, route_ms, llm_ms[round], tool_ms, tts_ms,
  total_ms`, plus token counts from `response.usage_metadata`. Store one row per turn in a new
  `turn_metrics` table, and log it.
- Turn docs/GUIDE.md section 6.2 into `tests/evals/questions.yaml`: 40+ questions in English and
  Khmer, each with the expected skill and expected facts. Write `tests/evals/run_eval.py` to score
  accuracy, the routing hit rate and p50/p95 latency.
- Files: new `src/receptionist/metrics/` (model + service), `agent/client.py` (timers),
  `tests/evals/run_eval.py`.

## Phase 1: Quick wins (no change in how the agent behaves)
1. **Stream the reply.** Add a `POST /api/chat/stream` endpoint (Server-Sent Events) built on
   `client.aio.models.generate_content_stream`. `web/js/app.js` shows the words as they arrive.
   This makes the biggest difference to how fast it *feels*.
2. **Speak sentence by sentence.** Start text-to-speech on the first complete sentence instead
   of waiting for the whole answer.
3. **Use the async client** (`client.aio`) with one shared connection, and make the chat
   endpoints `async`.
4. **Pick the thinking level per question.** Use `ThinkingConfig(thinking_level=LOW)` for FAQ
   questions and `MEDIUM` only for multi-step workflows. Thinking tokens are the hidden latency.
5. **Keep the cached prefix stable.** The system prompt and tool list are already deterministic.
   Put anything that changes per question *after* them, so Gemini's implicit caching can reuse
   the prefix. Check `cached_content_token_count` in the Phase 0 metrics.
6. **Load the speech model at startup.** Load the Whisper model(s) when the server starts, not
   on the first voice message.
- Files: `chat/router.py`, `chat/schemas.py`, `agent/client.py`, `voice/stt.py`, `voice/tts.py`,
  `web/js/app.js`, `main.py` (warm-up in `lifespan`).

## Phase 2: Skill router (3 model calls → usually 1). The biggest real speed-up
Choose the skill **on our server, before calling Gemini**, then put its content into the first
request.

```
question ─► [Router] ──match (score ≥ threshold)──► insert SKILL.md + small data files
              │                                       into the request ─► 1 Gemini call
              └──no clear match──► today's tool loop (load_skill / read_skill_file)
```

- **How the router matches:** it compares the question with the skill descriptions plus
  routing examples, using Gemini embeddings (`client.models.embed_content`). Each skill's
  embeddings are computed once, when skills load or reload.
- **Fallback:** the existing similarity function in `knowledge/service.py` keeps the router
  working without the embeddings API.
- **What gets inserted:** the matched skill's `SKILL.md`, plus its data files if they are under
  roughly 8 KB. Use the existing `SkillRegistry.load()` / `read_file()` in `skills/loader.py`.
  The content goes in the **user turn**, tagged as reference data, never into the system
  prompt. This keeps the prompt-injection boundary in place.
- **Tools stay available.** If the router picked the wrong skill, the model can still call
  `load_skill`, so accuracy can't get worse. It just costs one extra call.
- **Expected result:** most FAQ questions answered in 1 call instead of 3, about 2-3× faster.
- Files: new `src/receptionist/router/` (`embeddings.py`, `service.py`), `agent/client.py`,
  `skills/loader.py` (compute embeddings when skills reload).

## Phase 3: Answer fast paths
1. **Cache approved answers.** If a question closely matches an approved knowledge entry
   (embedding similarity ≥ 0.92, same language), answer with **one fast call to the `-lite`
   model** that rephrases the approved answer. Don't return the cached text word for word; the
   caller's wording and context differ. Clear the cache whenever knowledge changes or skills
   reload.
2. **Workflow skills.** For multi-step tasks (admission steps, leaving a message, booking a
   tour), add a `workflow.yaml` to the skill. It lists the steps and the details to collect.
   The router inserts it, and the agent follows the steps one turn at a time instead of working
   them out each time. `take_message` is the first workflow: name, then contact, then message,
   then confirm.
3. **Choose the model by question type.** Use the `-lite` model for routed FAQ answers and
   rephrasing cached answers, and the main Flash model for workflows and anything unrouted.
   Make both settings in `config.py`.
- Files: `knowledge/service.py` (embedding search), `agent/client.py` (choose the path),
  `config.py` (`GEMINI_MODEL_FAST`, `ANSWER_CACHE_THRESHOLD`), skill folders (`workflow.yaml`),
  and the loader (allow `workflow.yaml`, which it already does because `.yaml` is permitted).

## Phase 4: Use the caller's context (this conversation only, privacy-safe)
- **Session facts:** keep a small set of facts per session: preferred language, role
  (parent/student/visitor), and the program or grade they're asking about. The model reads
  them from a short "known so far" note sent with each turn. They are **never** stored after
  the session ends.
- **Long conversations:** once a chat is past about 10 turns, summarise the older turns into
  one short note, instead of resetting at 20 turns as it does now. This keeps requests small
  and fast.
- **Follow-up questions:** the router also looks at the previous turn's skill, so "and for
  grade 10?" stays on the fees skill.
- Files: `agent/client.py` (`SessionStore` stores facts + a summary), `agent/prompts.py`.

## Phase 5: Learning loop upgrades (always with staff approval)
| Signal | What the system learns | Approval |
|---|---|---|
| 👍/👎 buttons under each answer | 👎 answers go to the review queue with the full context | Staff fix → knowledge |
| Questions the router got wrong (the model called `load_skill` on a different skill) | A **routing example** is added to that skill | Automatic. Low risk: routing only decides which approved content to load, never what the facts are |
| Unanswered questions | The **LLM drafts an answer** from the existing skills, shown in `/admin` | Staff edit and approve |
| A knowledge entry used often | An **"Export to faq.md"** button moves it into the skill file | Staff click; committed to Git |
| Slow turns (p95 above target) | Shown on `/admin` with their stage timings | Developer investigates |

- Callers still can never change facts. Only routing examples are learned automatically.
- Files: new `feedback` table + endpoint, `learning/service.py` (drafts, routing examples),
  `admin/router.py` + `web/js/admin.js` (feedback list, export, latency panel), and `web/js/app.js`
  (👍/👎 buttons).

## Phase 6: Infrastructure (when traffic grows)
- Use Redis for sessions, the answer cache and the rate limiter, with several uvicorn workers.
- Use explicit Gemini context caching (`client.caches.create`) for skill content once the
  combined skills are large.
- Host the server in a region close to Gemini's servers, and keep HTTP connections open
  between requests.

---

## File-by-file map: where each problem is in your project today

Open these spots first. Line numbers are from the current code.

### Problem A: three model calls per answer (the main cause of slowness)
| File | Where | What you'll see | Change |
|---|---|---|---|
| `src/receptionist/agent/client.py` | `reply()` L132, loop L146-147 | `for _ in range(agent_max_tool_rounds)`, where each round is one blocking `generate_content` call | Run the router before the loop and add the matched skill's content to the first user turn, so most questions finish in round 1 |
| `src/receptionist/skills/loader.py` | `reload()` L82, `load()` L114, `read_file()` L122 | Skill text is only available through tools | Add `bundle(name)`, which returns SKILL.md + small data files in one string. Compute skill embeddings in `reload()` |
| `src/receptionist/agent/prompts.py` | L40 "Skills available" | Only names + descriptions; the model must call tools to see facts | Add a rule: "If a REFERENCE block is in the message, answer from it first" |
| `src/receptionist/agent/tools.py` | `tool_definitions()` L37 | 5 tools, always sent | No change. They stay as the fallback when the router misses |
| **new** `src/receptionist/router/service.py` | — | — | `route(question, prev_skill) → (skill, score)` using embeddings, with a fallback to `knowledge.similarity` |

### Problem B: the reply is only sent when it is 100% finished
| File | Where | What you'll see | Change |
|---|---|---|---|
| `src/receptionist/chat/router.py` | `_answer()` L30, `chat()` L55, `voice()` L61 | Sync endpoints return one JSON object at the end | Add an `async` `POST /api/chat/stream` that returns Server-Sent Events, using `client.aio.models.generate_content_stream` |
| `src/receptionist/chat/schemas.py` | `ChatResponse` L11 | One final object | Add the stream event shapes (`delta`, `done`, `error`) |
| `web/js/app.js` | `handleResponse()` L44, `addBubble("bot"...)` L54, submit L59-72 | Waits for `res.json()` | Read the stream and add text to the bubble as it arrives (still `textContent` only) |
| `src/receptionist/agent/client.py` | L147 | `generate_content` | Add a streaming variant of `reply()` that yields text pieces |

### Problem C: the model settings are not tuned for speed
| File | Where | What you'll see | Change |
|---|---|---|---|
| `src/receptionist/agent/client.py` | `_config()` L107-123 | `temperature=0.3`, no thinking setting | Add `thinking_config=ThinkingConfig(thinking_level=LOW)` for FAQ questions and `MEDIUM` for workflows. Choose the model per path |
| `src/receptionist/config.py` | L10-40 `Settings` | One `gemini_model` | Add `gemini_model_fast` (lite), `thinking_level`, `router_threshold`, `answer_cache_threshold` |

### Problem D: voice is slow, especially the first voice message
| File | Where | What you'll see | Change |
|---|---|---|---|
| `src/receptionist/voice/stt.py` | `_model()` L36-45 | Whisper loads on the first request | Add `warm_up()`, which loads the models up front |
| `src/receptionist/main.py` | `lifespan()` L32-33 | Only `init_db()` | Call `stt.warm_up()` here when `STT_ENABLED=true` |
| `web/js/app.js` | `speak()` L31-41 | Speaks only after the full reply arrives | Speak each sentence as it finishes streaming |
| `src/receptionist/voice/tts.py` | `synthesize()` L18 / L48 | Whole-text synthesis | (Server TTS only) synthesize sentence by sentence |

### Problem E: no caching, so the same question costs the same every time
| File | Where | What you'll see | Change |
|---|---|---|---|
| `src/receptionist/knowledge/service.py` | `similarity()` L33, `search()` L40, `MIN_SCORE` L11 | Word/bigram overlap only, scanning every row | Add embedding-based `best_match()` for the answer cache. Keep `similarity()` as the fallback |
| `src/receptionist/learning/service.py` | `approve()` L52 | Creates knowledge | Also clear the answer cache |
| `src/receptionist/admin/router.py` | `update_knowledge()` L67, `delete_knowledge()` L76, `reload_skills()` L109 | Change content | Also clear the cache and rebuild the router embeddings |

### Problem F: weak use of the caller's context
| File | Where | What you'll see | Change |
|---|---|---|---|
| `src/receptionist/agent/client.py` | `SessionStore` L51-81, reset L136-137 | Stores raw history and wipes it after 20 turns | Store `facts` (language, role, program/grade, last skill) + a `summary`. Summarise older turns instead of wiping them |
| `src/receptionist/config.py` | `max_history_turns` L36 | 20 | Add `summarize_after_turns` (~10) |
| `src/receptionist/agent/prompts.py` | — | — | Rule: use the "Known so far" note, but never store personal data |

### Problem G: the agent learns only from approved unanswered questions
| File | Where | What you'll see | Change |
|---|---|---|---|
| `web/js/app.js` | `addBubble()` / L54 | No feedback | Add 👍/👎 under each bot reply, which calls `POST /api/feedback` |
| `src/receptionist/learning/models.py` | L15 | `UnansweredQuestion` only | Add `Feedback`, `RoutingExample`, and `draft_answer` on the question |
| `src/receptionist/learning/service.py` | `log_unanswered()` L23 | Logs the question | Also write an LLM draft answer from the skills (for staff). Learn routing examples from router misses |
| `src/receptionist/admin/router.py` + `web/js/admin.js` | — | Queue / knowledge / messages | Add a 👎 feedback list, an "Export to faq.md" button and a latency panel |
| `src/receptionist/database.py` | `init_db()` L30 | Imports models | Import the new models (feedback, metrics) |

### Problem H: nothing measures speed
| File | Where | Change |
|---|---|---|
| **new** `src/receptionist/metrics/` | — | `TurnMetric` table + `record()`: stt/route/llm/tool/tts ms + tokens |
| `src/receptionist/agent/client.py` | around L147 and the tool loop | Time each call; read `response.usage_metadata` |
| `src/receptionist/chat/router.py` | `voice()` L61 | Time STT and TTS |
| **new** `tests/evals/questions.yaml` + `tests/evals/run_eval.py` | — | Accuracy + p50/p95 before and after each phase |

### Tests to update or add
- `tests/conftest.py`: `FakeGemini` also needs `aio.models.generate_content_stream` and `embed_content`.
- New: `tests/test_router.py`, `tests/test_stream.py`, `tests/test_cache.py`, `tests/test_feedback.py`.

## Priority order (most effect for the work)
1. Phase 0 (measure) → 2. Phase 1 (streaming and quick wins) → 3. **Phase 2 (router)** →
4. Phase 3.1 + 3.3 (cache + lite model) → 5. Phase 5 (feedback and learning) → 6. Phase 4 → 7. Phase 6

## Verification (for every phase)
- `pytest` stays green. Add tests for the router (correct skill for EN and KM questions, falls
  back below the threshold), the cache (cleared on reload), streaming (SSE chunks in order) and
  workflows.
- Run `tests/evals/run_eval.py` before and after each phase. Accuracy must not drop; compare p50/p95
  latency and the router hit rate.
- Manual: ask a fee question and check that the logged `llm_ms` shows **1 call** where it used
  to be 3. Also check that the first words appear in under 1 s in the browser.
- Security: the prompt-injection tests in USEIT 6.4 must still pass. Content inserted by the
  router stays in the user turn, marked as data.

---

# Appendix A: Fix the live-test slowness (2026-10-13)

Added after a live test showed answers taking 18–34 s. Three stacking causes were
identified from the server log — none of them was a code bug.

**Status: ⏳ Not started. Priority: high.**

## A.1 Fill the skills with real school data (biggest fix)

**Symptom:** router logs `route None score=0.66 via none` and `score=0.73 via none`,
even though the score is above the 0.65 threshold. The second-best skill is within
0.03, so the router refuses to guess, and the agent falls through to the slow
`path=tools` branch (main model + full tool loop + no attached content).

**Why:** every data file in `skills/` is still full of placeholder TODOs
(`fee: "TODO: e.g. 600 USD per year"`, 14 TODOs in `calendar.yaml`, etc.). Every
skill looks about the same to the embedder, so no skill wins by a clear margin.

**Fix (no code, just content), in order of impact:**
1. Replace all TODOs in `skills/fees-and-payments/fees.yaml` with real prices,
   terms and discounts.
2. Replace all TODOs in `skills/admissions/` (requirements, timeline, documents).
3. Replace all TODOs in `skills/campus-and-contact/` (address, phone, hours).
4. Replace all TODOs in `skills/class-schedule/`, `academic-calendar/`.
5. Delete any skill folder for things the school does not offer, e.g. remove
   `skills/transport/` if there is no school bus. An unused skill still competes
   in routing and dilutes margins.
6. For each skill, add 3–8 `## question` headings to its `faq.md`, in **both
   English and Khmer**, matching how parents actually ask. These headings double
   as routing examples (see `src/receptionist/skills/loader.py:example_questions`).
7. On `/admin`, click **Reload skills** after each batch. Then ask real questions
   and watch the log line: `route <skill> score=0.8x via embedding` means the
   fast path kicked in.

**Verify:** p50 `turn_metrics.total_ms` should drop from the 18–34 s seen
tonight to under 3 s on routed questions (as measured on 2026-10-10: Grade 7
tuition = 1.7 s).

## A.2 Deal with free-tier Gemini 503s

**Symptom:** `POST .../gemini-3.8-flash:streamGenerateContent HTTP/1.1 503` on
nearly every call, followed by a retry that either succeeds after ~15 s or
times out at 20 s and falls back to `gemini-3.6-flash`.

**Why:** the free Gemini tier has one capacity pool for everyone; demo projects
are first to be throttled. The code already handles it (retry + fallback +
60-s circuit breaker), but each failed attempt still costs ~15 s wall-clock.

**Fixes, in priority order:**
- [ ] **Enable billing on the Gemini key.** Paid-tier capacity pool is
      separate; the 503s stop. It is also required for privacy — on the free
      tier Google may use prompts to train models.
- [ ] If paid is not possible yet, shorten `LLM_TIMEOUT_MS` from 20000 to
      **8000**, so a hung call falls to the fallback model after 8 s instead
      of 20. Add to `.env`.
- [ ] After the paid tier is on, swap the default main model to a paid-tier
      endpoint if Google publishes a separate id (track in `docs/RESEARCH.md`).

## A.3 Turn on voice input

**Symptom:** three `POST /api/transcribe HTTP/1.1 503 Service Unavailable`
before the first chat message. Voice is dead.

**Fix:**
- [ ] `pip install -e ".[voice]"`
- [ ] In `.env`: `STT_ENABLED=true`
- [ ] Optional: `STT_MODEL_KM=./models/whisper-km` for Khmer (see README).

## A.4 Lower the router margin if A.1 is not enough

If, after real content is in, questions still log `via none` with scores above
0.65:
- [ ] Lower `ROUTER_MARGIN` from `0.03` to `0.01` in `.env`.
- [ ] Re-run `tests/evals/run_eval.py` and confirm accuracy did not drop.

## A.5 Acceptance test for Appendix A
- [ ] `turn_metrics` p50 total_ms < 3000 on routed questions.
- [ ] `path=tools` turns < 20 % of all turns over a 24-hour window
      (`/api/admin/metrics` → `by_path`).
- [ ] Zero 503 "high demand" errors over 50 consecutive calls once paid is on.

---

# Appendix B: Research-backed next steps (2026-10-13)

Research gathered from vendor guides, academic papers and production
engineering blogs. Findings and sources are logged in `docs/RESEARCH.md`.
The implementation tasks they create are below.

**Status: ⏳ Not started. Priority: medium — do not start until Appendix A is
done, otherwise the gains are hidden by free-tier noise.**

## B.1 Hybrid retrieval with Reciprocal Rank Fusion (RRF)

**Finding:** the 2026 consensus for FAQ retrieval is **BM25 + dense
embeddings + RRF**, not one or the other. Hybrid consistently adds 5–15 %
recall over either method alone, because BM25 catches rare terms and codes
("Grade 7", "ADM-2024") while embeddings catch paraphrases ("how much do you
charge" vs "fees"). RRF avoids fragile score calibration.

**What we have today:** lexical IDF (`router/lexical.py`) and embeddings
(`router/embeddings.py`) exist, but the router picks one of them, it does
not fuse their rankings. Same for `router/knowledge.py`.

**Tasks:**
- [ ] Add `router/fusion.py` with
      `rrf(ranked_lists, k=60) -> list[(skill, rrf_score)]`.
- [ ] Rewrite `SkillRouter.route()` to call both lexical and embeddings in
      parallel (`asyncio.gather`), then fuse. Keep the shortcut and
      follow-up rules.
- [ ] Same change in `KnowledgeMatcher.match()`.
- [ ] Replace plain IDF with BM25 scoring in `router/lexical.py` (port
      `rank_bm25.BM25Okapi` or add it as a dep).
- [ ] Tests: add 10 cases to `tests/evals/questions.yaml` that only one
      method answers (an exact-code lookup, a paraphrase of a rare term),
      and assert hybrid gets both.

## B.2 Cross-encoder reranker over top-K

**Finding:** production RAG blogs recommend a reranker (cross-encoder or an
LLM-as-judge in lite mode) over the top-K hybrid candidates. Typical lift:
another 5–15 % recall and much wider margins — fewer "ambiguous" cases like
tonight's `via none`.

**Tasks:**
- [ ] Add `router/rerank.py`: given a question and up to 10 candidate skills
      with their bundled text, call the fast model (`gemini-3.5-flash-lite`)
      with a one-shot prompt and `response_schema={skill: str, score: float}`
      to pick the best one. Low thinking level, short output.
- [ ] Only call the reranker when the top-2 margin after RRF is thin
      (< 0.05). Skip on obvious wins.
- [ ] Guard with `ROUTER_RERANK=true` (default off until measured).
- [ ] Measure with `tests/evals/run_eval.py`: rerank should raise routing
      accuracy from 18/19 to 19/19 on the current eval set, with ≤ 300 ms
      extra on reranker-triggered turns.

## B.3 Semantic answer cache (7x speed-up on cache hits)

**Finding:** semantic caching of final LLM answers cuts median cost
40–70 % and latency from ~850 ms to ~120 ms on hits in vendor benchmarks
(Redis, Portkey). Key is the **question embedding**, not the raw text, so
paraphrases of a FAQ hit the cache.

**What we have today:** `router/knowledge.py` matches admin-approved
answers, which still go through the LLM. This is not a cache.

**Tasks:**
- [ ] New table `answer_cache(question_embedding BLOB, answer TEXT,
      skill TEXT, lang TEXT, hits INT, created_at)` with 24-h TTL.
- [ ] On every answered turn where no tool failed and no `log_unanswered`
      fired, upsert into the cache.
- [ ] Before routing, if an embedding match ≥ 0.95 cosine exists, return
      the cached answer directly (still through the SSE path, so the UI
      does not know). Record `path=answer_cache` in `turn_metrics`.
- [ ] **Safety:** flush on `skills.reload()`, on knowledge update/delete,
      and on an approved 👎 feedback for the same skill.
- [ ] Admin: show cache hit rate on the speed panel.

## B.4 Explicit prompt caching with controlled boundaries

**Finding:** naive "cache the whole prompt" can **increase** TTFT because
small per-request changes bust the cache. The right boundary is: cache the
stable prefix (system prompt + skills index + fixed tool definitions), but
NOT the per-request skill bundle, user text or recent summary. Published
gains: 13–31 % TTFT drop, 41–80 % cost drop.

**Tasks:** (restates `need-improve.md` 16.2 with specifics)
- [ ] Build one `client.caches.create(ttl='3600s')` cache per
      `(school_name, skills.version)`; store its id on the registry.
- [ ] On every `generate_content_stream`, pass `cached_content=` only for
      the stable prefix. Per-request content (reference bundle, user turn)
      stays uncached.
- [ ] Delete old caches on `SkillRegistry.reload()`.
- [ ] Report `cached_content_token_count` in `turn_metrics`. Target: more
      than 60 % of input tokens cached after the first turn.

## B.5 Observability and tracing (Langfuse or OpenTelemetry)

**Finding:** every 2026 production voice-agent article lists tracing +
eval loop as the number-one production gap. Tonight's log is one line per
turn — we cannot see which skill texts were attached, which chunks were
fused, which rerank candidates were considered.

**Tasks:**
- [ ] Choose: Langfuse (self-hostable, free, Python SDK) vs OpenTelemetry +
      a free collector. Recommend Langfuse for the smaller surface.
- [ ] Trace every turn as `span(name="turn")` with child spans for
      `router.lexical`, `router.embedding`, `router.rerank`, `llm.stream`,
      `tool.<name>`. Record token counts and latencies on each.
- [ ] Hook into `TurnStats` so no code is duplicated.
- [ ] Gate with `TRACING_ENABLED=false` by default.

## B.6 Evaluation loop with simulated callers

**Finding:** real-world eval of voice/chat agents uses **simulated users**
(an LLM playing a parent) that drive multi-turn conversations, not
single-turn Q&A. Our `tests/evals/run_eval.py` is one-shot — it misses workflow
regressions (campus-tour booking), clarification dialogues, and
barge-in-equivalent interruptions.

**Tasks:**
- [ ] Extend `tests/evals/` with YAML "scenarios": a list of persona turns
      and an expected end-state (message saved? skill loaded? apology given?).
- [ ] Add `tests/evals/run_scenarios.py` that drives the agent with a second
      Gemini session as the simulated caller, scored by a third LLM-judge
      against the acceptance criteria.
- [ ] Target scenarios: happy fee question, unknown-topic + fallback,
      campus-tour workflow, prompt-injection attempt, mixed EN/KM in one
      session, angry caller, interrupted booking.
- [ ] Report routing hit rate, task-completion rate and p50/p95 latency
      per scenario.

## B.7 Formalise the guardrails layer (input → plan → tool → output)

**Finding:** production agent blueprints (OpenAI, Maxim, Vapi) describe a
four-stage guardrail layer: **input** (PII redact, length cap, language
detect), **plan** (tool allow-list, budget check), **tool** (per-tool
validation and timeout), **output** (fact-check against tool results, PII
redact, safe-text check).

**What we have today:** input validation, tool `strict:true` schemas, UI
`textContent` only. We do not have an **output fact-check** that compares
numbers in the reply to numbers the tool returned
(`need-improve.md` 12), and we do not have a central `guardrails.py`.

**Tasks:**
- [ ] Extract `src/receptionist/agent/guardrails.py` with four stages;
      wire it into `agent/client.py:stream()`.
- [ ] Numeric fact-check: parse `[0-9][0-9,.]*` tokens in the reply;
      every one must appear in a reference bundle OR a tool result from
      this turn, else flag and hold.
- [ ] Per-session budget: hard-cap LLM calls per session at e.g. 20,
      replying "Let me pass you to the office" after that.
- [ ] Tests: inject a reply containing a fabricated price → assert the
      guardrail blocks it.

## B.8 Conversation-design patterns from the voice-UX literature

**Finding (IBM, Voiceflow, Botpress 2026):**
(a) **progressive information collection** — one question at a time, confirm,
save (our `workflow.yaml` already does this; extend it);
(b) **guided choice** — 2–4 quick-reply buttons after an open question
(completion rate +20 %);
(c) **inline confidence hints** when a match is weak ("I'm not sure, but I
think you're asking about …");
(d) **source citations** — "from the fees skill, last updated 2026-10-03".

**Tasks:**
- [ ] Add quick-reply buttons to `web/js/app.js`: the SSE `done` event can
      include `{suggestions: [...]}` which the UI renders as clickable chips.
- [ ] When the router's top score is between 0.5 and 0.65 (ambiguous), the
      agent asks a disambiguating question ("Do you mean tuition fees, or
      application fees?") instead of guessing.
- [ ] After every answer, add a line in the UI like
      `From "fees-and-payments" · updated 2026-10-03` (data already in the
      registry).
- [ ] Add workflows for: "leave a message", "book a parent-teacher meeting",
      "report an absence". Same `workflow.yaml` pattern as
      `admissions/book_campus_tour`.

## B.9 Multi-model LLM routing

**Finding:** the Redis "LLM router" pattern routes each question to the
smallest model that can handle it: trivial greetings to a nano model, FAQ
to lite, reasoning to full. We have fast/main/fallback, but it is a
*failover* chain, not a *skill-based* chooser.

**Tasks:**
- [ ] Add `agent/model_selector.py:choose(route, has_workflow, lang)`:
  - routed FAQ, no workflow → fast
  - workflow or no route → main
  - KM detected and the fast model is weak at KM → main
- [ ] Measure for a week with the eval scenarios before changing defaults.

## B.10 Priority order for Appendix B
1. **B.1 (hybrid + RRF)** — fixes exactly the "margin too thin" case we hit
   tonight. Highest ROI.
2. **B.2 (reranker)** — removes almost all remaining router misses.
3. **B.3 (answer cache)** — repeat FAQ questions become instant.
4. **B.5 (tracing)** — without this we cannot tune B.1/B.2/B.3 safely.
5. **B.6 (scenario evals)** — proves the above do not regress.
6. **B.4 (explicit caching)** — biggest cost win once traffic grows; needs
   the paid tier (A.2) to pay off.
7. **B.7 (guardrails module)** — security/correctness, not speed.
8. **B.8 (UX patterns)** — quality of experience.
9. **B.9 (model selector)** — polish; depends on paid-tier capacity data.

## B.11 Verification for every Appendix-B item
- `pytest` stays green.
- `tests/evals/run_eval.py` and `tests/evals/run_scenarios.py` (new, B.6) must not
  regress accuracy and must show the claimed latency win.
- Appendix A must be fully done first, otherwise free-tier noise hides
  every signal.
- Every change updates `docs/RESEARCH.md` with the source URL and the
  measured outcome.

---

## Sources (research done 2026-10-13)
Full source list is in `docs/RESEARCH.md`. Highlights:

- *How to Build an AI Receptionist: A Complete Guide (2026)* — getvoip.com
- *How AI Receptionists Work: Architecture, Performance, and What CTOs Need
  to Know* — snsys.ai
- *Conversational AI Design in 2026 (According to Experts)* — botpress.com
- *Conversational AI Design: A Practitioner's Guide [2026]* — voiceflow.com
- *How to Optimize Pipecat Voice Agent Latency in 2026: 12 Techniques* —
  futureagi.com
- *Workload-Router-Pool Architecture for LLM Inference Optimization (vLLM
  Semantic Router)* — arXiv 2603.21354
- *LLM router architecture: best practices for 2026* — redis.io
- *Reduce LLM Cost and Latency: A Comprehensive Guide for 2026* —
  getmaxim.ai
- *BM25 Wins at Scale: A Scaling Study of RAG Paradigms* — arXiv 2607.26497
- *Hybrid Search for RAG: Combining BM25 and Dense Vector Search (2026
  Guide)* — denser.ai
- *RAG Best Practices for Enterprise AI (Chunking, Embeddings, Reranking,
  Hybrid)* — stackai.com
- *RAG Explained: 10 Steps to Production-Ready RAG in 2026* —
  decodethefuture.org
- *Voice AI Observability for Vapi: A 2026 Implementation Guide* —
  futureagi.com
- *How to Evaluate Voice AI Agents End-to-End: A 2026 Methodology* —
  futureagi.com
- *Observability and Evaluation Strategies for Tool-Calling AI Agents* —
  getmaxim.ai
- *fastapi-langgraph-agent-production-ready-template* — github.com/wassim249
- *OpenAI voice agents guide* — developers.openai.com
- *Don't Break the Cache: An Evaluation of Prompt Caching for Long-Horizon
  Agentic Tasks* — arXiv 2601.06007

---

# Appendix C: Streaming Speech-to-Text (sherpa-onnx) (2026-10-14)

**Inspiration:** [VoiceStudio](https://github.com/debpalash/VoiceStudio) — a desktop
voice app whose default engine comes from the k2-fsa family. VoiceStudio itself
is AGPL-3.0 (viral copyleft) and a desktop-only Electron app, so it cannot be
embedded here. The transferable idea is its engine family: **sherpa-onnx**, an
Apache-2.0, ONNX-based STT with real **streaming** recognizers.

**Why change:** today's `faster-whisper` setup is batch-only (user speaks →
upload → wait 2-5 s for a full transcript), heavy to install (~1.2 GB with
PyTorch), and has already failed in practice (`[voice]` extras not installed →
503 on `/api/transcribe`). sherpa-onnx is ~250 MB, needs no PyTorch/CUDA, and
can emit partial transcripts every ~100 ms while the caller is still speaking.

## C.1 Why sherpa-onnx (vs. the alternatives considered)

| Option | Verdict |
|---|---|
| Keep faster-whisper, add client VAD | Minor UX improvement; still batch; doesn't solve install weight |
| Browser Web Speech API | Free, zero server cost — but Khmer support is Chrome-only and sends audio to Google |
| Full VoiceStudio-style rewrite | Overkill (voice cloning, dubbing, audiobooks aren't needed) |
| **sherpa-onnx streaming** | **Chosen** — closest to VoiceStudio's technique family, works for both languages, commercial-safe license |

## C.2 Changes

### C.2.1 Dependency swap
- [ ] `pyproject.toml` → replace `faster-whisper>=1.0` with
  `sherpa-onnx>=1.10`, `numpy`, `soundfile`.

### C.2.2 Rewrite STT engine
**File:** `src/receptionist/voice/stt.py` (full rewrite)
- [ ] Rename class `WhisperSTT` → `SherpaSTT` (keep old name as alias one release).
- [ ] `_model(name)` builds `sherpa_onnx.OfflineRecognizer` from ONNX model dir.
- [ ] `transcribe(bytes, lang_hint)` decodes WebM/Opus → 16 kHz mono PCM via
  `soundfile` + `numpy`, feeds the recognizer, returns the existing `Transcript`
  dataclass unchanged.
- [ ] Preserve `AudioTooLong` using the resampled sample count.
- Public API stays the same so the chat router does not need to change.

### C.2.3 Streaming WebSocket endpoint
**File:** `src/receptionist/chat/router.py` (new route)
- [ ] `WS /api/transcribe/stream` — accepts binary audio frames,
  wraps `sherpa_onnx.OnlineRecognizer`, emits `{"partial": "..."}` as
  words are decoded and `{"final": "...", "lang": "en"}` on close.
- [ ] Keep `POST /api/transcribe` as a batch fallback — both call the same
  `SherpaSTT` instance.

### C.2.4 Browser streaming client
**File:** `web/js/app.js` (replace lines 191-253)
- [ ] Capture 16 kHz mono PCM via `AudioWorklet` (fallback: `ScriptProcessor`).
- [ ] Open `WebSocket("/api/transcribe/stream")`, send 100 ms chunks as
  `ArrayBuffer`.
- [ ] Display partials in the input box as they arrive.
- [ ] On `pointerup`, close socket, take `final`, call `streamReply()`.
- [ ] Add a visible "Hold to speak" hint under the mic — the current
  press-and-hold UX is undiscoverable (we hit this live on 2026-10-14).

### C.2.5 Config
**Files:** `src/receptionist/config.py`, `.env`
- [ ] Replace `STT_MODEL_EN` / `STT_MODEL_KM` → `STT_MODEL_EN_PATH` /
  `STT_MODEL_KM_PATH` (filesystem paths to ONNX model dirs).
- [ ] Remove `STT_DEVICE`, `STT_COMPUTE_TYPE` (ONNX picks device automatically).
- [ ] Add `STT_STREAMING_ENABLED=true` (off = batch-only POST path).
- [ ] Default EN model: `sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17`
  (~230 MB, multilingual). Downloaded on first `warm_up()` into
  `data/models/` (git-ignored).
- [ ] Khmer: user sets `STT_MODEL_KM_PATH` to a Khmer Whisper-ONNX conversion.
  Document the conversion steps in `docs/GUIDE.md`.

### C.2.6 Tests
**File:** `tests/voice/test_stt.py`
- [ ] Fake `sherpa_onnx.OfflineRecognizer` / `OnlineRecognizer` in a conftest
  fixture (same pattern as the current `faster_whisper` fake).
- [ ] Add one WebSocket test using FastAPI's
  `TestClient.websocket_connect("/api/transcribe/stream")`.

### C.2.7 Docs
- [ ] `docs/GUIDE.md` — update "Voice" section: new model name, no CUDA notes,
  mention streaming UX, link to ONNX Khmer conversion.
- [ ] `README.md` — same, drop the CTranslate2 instructions.
- [ ] `.gitignore` — add `data/models/`.

## C.3 Expected improvements

| Metric | faster-whisper (now) | sherpa-onnx (after) |
|---|---|---|
| Install size | ~1.2 GB | ~250 MB |
| Cold start (`warm_up`) | 3-5 s | <1 s |
| Time to first word (caller POV) | After full upload (2-5 s) | ~300 ms rolling |
| Short-clip transcription | 1-2 s | ~200 ms |
| License | MIT (OK) | Apache-2.0 (also OK, more permissive wheels) |

## C.4 Acceptance test for Appendix C
- [ ] `pip install -e ".[voice]"` installs cleanly on Windows with no PyTorch.
- [ ] First browser mic use: partial words visible in the input box within
  ~500 ms of starting to speak.
- [ ] "mic release → first reply word" < 2 s on routed queries
  (`/api/admin/metrics` → `by_path.routed.p50_total_ms`).
- [ ] Fallback POST `/api/transcribe` still works when WebSocket is disabled.
- [ ] `pytest tests/voice/ -v` passes.

## C.5 Non-goals for Appendix C
- Voice cloning / custom TTS voices (VoiceStudio's main feature, not needed).
- A pluggable multi-engine abstraction — stick with one engine until a second
  is actually required.
- Replacing TTS — the browser Web Speech API still handles that side.
