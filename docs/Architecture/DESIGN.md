# AI School Receptionist — Design & Architecture

> A voice-and-text AI receptionist for an academy school (English + Khmer), powered by
> Google Gemini. It answers parent/student/visitor questions from staff-editable *skills*,
> falls back to staff-approved answers, takes messages for the front office, and learns
> from every conversation without ever letting a caller change what it knows.
>
> This document describes the system **as built**. Every section references the source
> (`file:line`) so it can be checked against the code.

---

## 1. Purpose & Scope

**What it is.** A web app with two faces:

- a **caller chat page** — type or hold-to-talk; the reply is streamed and spoken aloud;
- a **staff admin page** — a review queue, knowledge editor, message inbox, and speed dashboard.

**Who uses it.**

| Actor | Interaction |
|---|---|
| Parent / student / visitor | Ask questions by voice or text, get a short spoken answer, optionally leave a message |
| School staff (admin) | Review what the bot couldn't answer, approve/edit answers, read caller messages, watch latency |
| Developer / operator | Edit skill packs, configure models, deploy in Docker |

**Core promise.** The bot only states school facts it obtained from a **skill** (a staff-editable
knowledge pack) or a **staff-approved answer** in this conversation. It never guesses. When it
doesn't know, it says so and offers to take a message — it does not invent an answer
(`agent/prompts.py:18-31`).

**Non-goals.** No student-record lookups, no payment processing, no outbound calling. The agent
may only *write* two things: a message for staff and an entry in the review queue
(`agent/tools.py:5-6`).

---

## 2. Design Principles

These show up repeatedly in the code:

1. **Skills, not code.** School knowledge lives in `skills/<name>/SKILL.md` + reference files that
   staff edit on the host and reload from the admin page — no redeploy to change an answer
   (`skills/loader.py:1-12`).
2. **Grounding before fluency.** The router attaches real skill content to the caller's turn *before*
   the model speaks, so answers cite school data rather than improvising (`router/service.py:1-15`).
3. **The caller never writes knowledge.** Callers can rate an answer (👍/👎) or leave a message;
   both land in a **staff review queue**. Only an admin approval turns anything into knowledge,
   preventing knowledge poisoning (`learning/service.py:1-8`).
4. **Fast by default.** Server-side routing + prompt caching + a fast model turn a 3-call
   lookup into 1 call for most questions (`router/service.py:3-6`).
5. **Fails gracefully.** If the model is overloaded, the caller hears a fallback answer or a polite
   busy message — never a stack trace or a half-answer (`agent/client.py:337-356`).
6. **Least privilege at the boundary.** The model's tool input is untrusted and re-validated; the
   filesystem is never addressed by a caller-supplied path (`agent/tools.py:1-7`, `skills/loader.py:9-11`).

---

## 3. High-Level Architecture

```
                         ┌────────────────────────────────────────────┐
   Caller's browser      │  web/  (static SPA, no build step)          │
  ┌───────────────┐      │   index.html  app.js  style.css            │
  │  🎤 / ⌨️      │─────▶│   • MediaRecorder (hold-to-talk)           │
  │  🔊 replies    │◀─────│   • SSE stream consumer                    │
  └───────────────┘      │   • speechSynthesis (speaks sentences)    │
                         └───────────────┬────────────────────────────┘
                                         │  /api/chat/stream · /api/transcribe · /api/feedback
                                         ▼
   ┌───────────────────────────────────────────────────────────────────────────┐
   │  FastAPI app  (src/receptionist/main.py)                                   │
   │                                                                            │
   │  chat/router.py            admin/router.py (X-Admin-Key)                    │
   │   /chat /chat/stream        /questions /knowledge /messages /metrics …     │
   │   /transcribe /voice                                                        │
   │   /feedback                                                                 │
   │        │                          │                                         │
   │        ▼                          ▼                                         │
   │  ┌─────────────────────────┐  ┌────────────────────────────┐              │
   │  │  ReceptionistAgent       │  │  Learning loop + Metrics    │              │
   │  │  agent/client.py         │  │  learning/service.py        │              │
   │  │                          │  │  metrics/service.py         │              │
   │  │  ┌──────────────┐        │  └────────────────────────────┘              │
   │  │  │ SkillRouter  │        │                                              │
   │  │  │ router/…     │        │   ┌──────────────┐    ┌───────────────┐      │
   │  │  │  embedding   │        │   │  WhisperSTT  │    │  TTS provider │      │
   │  │  │  + lexical   │        │   │  voice/stt.py│    │  voice/tts.py │      │
   │  │  └──────────────┘        │   └──────────────┘    └───────────────┘      │
   │  │  ┌──────────────┐        │                                              │
   │  │  │KnowledgeMatch│        │                                              │
   │  │  └──────────────┘        │                                              │
   │  │  tools (5) · memory ·    │                                              │
   │  │  guardrails · prompts    │                                              │
   │  └──────────┬───────────────┘                                              │
   └─────────────┼──────────────────────────────────────────────────────────────┘
                 │  google-genai SDK (streaming)
                 ▼
        ┌──────────────────────┐        ┌───────────────────────────────┐
        │  Google Gemini        │        │  SQLite  (SQLAlchemy)          │
        │  gemini-3.8-flash     │        │  turn_metrics · feedback       │
        │  gemini-3.6-flash (fb)│        │  unanswered_questions          │
        │  gemini-3.5-flash-lite│        │  knowledge_entries · messages  │
        │  gemini-embedding-2   │        │  routing_examples · audit      │
        └──────────────────────┘        └───────────────────────────────┘
```

**Layer summary**

| Layer | Module | Responsibility |
|---|---|---|
| Presentation | `web/` | Chat UI, mic capture, SSE, speech playback, admin UI |
| API | `chat/router.py`, `admin/router.py` | HTTP/SSE endpoints, validation, rate limiting |
| Agent | `agent/` | Prompt assembly, Gemini calls, tool loop, memory, guardrails |
| Routing | `router/` | Choose skill/knowledge before the LLM (semantic + lexical) |
| Knowledge | `skills/`, `knowledge/` | Skill packs (files) + approved Q&A (DB) |
| Learning | `learning/` | Review queue, feedback, learned routing examples |
| Voice | `voice/` | STT (faster-whisper) and TTS (browser / Meta MMS) |
| Persistence | `database.py` + `*/models.py` | SQLite tables |
| Security | `security/` | Auth, rate limit, headers, redaction, audit |
| Ops | `metrics/`, `Dockerfile`, `docker-compose.yml` | Observability + deployment |

---

## 4. Request Lifecycles

### 4.1 A text/streamed question (the common path)

```
browser → POST /api/chat/stream {session_id, message}
   │
   ├─ chat/router.py: rate-limit (20/min) → clean_input() guardrail
   ├─ agent.stream():
   │    1. clean_input + detect_lang            (agent/guardrails.py)
   │    2. load SessionState (in-memory, TTL 30 min)
   │    3. SkillRouter.route(text, previous_skill)
   │         → lexical-sure? → embedding → lexical → follow-up → none
   │    4. if routed: attach <school_reference skill="…"> bundle to the turn
   │         (skill content is injected ONCE; remembered in skills_in_context)
   │    5. KnowledgeMatcher.match() → attach <school_reference skill="approved-answer">
   │    6. no match at all → attach NO_MATCH_NOTE (tells model to log_unanswered)
   │    7. pick models: fast model if content was attached & not a workflow
   │    8. stream Gemini; yield text deltas; run the tool loop if the model calls tools
   │    9. on success: save memory, learn from router miss, maybe summarise in background
   └─ SSE:  delta {text} … then  done {reply, lang, turn_id, audio_base64?}  or  error {detail}
                         │
                         └─ browser: append text bubble, speak each finished sentence,
                                     show 👍/👎, play server audio if provided
```

Each turn yields `AgentReply` last (`agent/client.py:367-523`). The `_finish()` step in the
endpoint synthesises TTS (if a server provider is configured), records metrics, and stashes a
`TurnRecord` so the caller can rate that specific answer (`chat/router.py:56-78`).

### 4.2 A voice message

Two equivalent routes:

- **Web page** (default): the mic records with `MediaRecorder`, the blob is POSTed to
  `/api/transcribe`; the returned transcript is then fed to `/api/chat/stream` exactly like typed
  text — so voice gets the same streaming + TTS treatment (`web/js/app.js:224-249`).
- **API clients**: `/api/voice` does transcribe + answer in a single request
  (`chat/router.py:192-206`).

Audio is validated before any decoder sees it (content-type allowlist, size cap while reading,
magic-byte format sniff) (`voice/validators.py:53-63`).

### 4.3 The learning loop

```
agent can't answer ──log_unanswered──▶ unanswered_questions (pending, deduped, counted)
caller rates 👎 ─────record_feedback──▶ feedback row  +  unanswered_questions (source=feedback)
                                                │
                                  staff opens /admin
                                                │
                     ┌──────────────────────────┼───────────────────────────┐
                     ▼                          ▼                           ▼
              [Draft with AI]              [Approve]                   [Dismiss]
        agent.draft_answer() →          creates a versioned          marks dismissed
        staff edits the draft          knowledge_entries row
                                                │
                                   (optional, later) [Export] → append to
                                   skills/<skill>/faq.md, deactivate DB copy
                                                │
                        next callers: KnowledgeMatcher matches the approved answer,
                        OR the FAQ heading teaches the router (example_questions)
```

Automatic (low-risk) learning also happens: when the router *missed* but the model itself called
`load_skill`, that question is stored as a routing example for that skill
(`agent/client.py:501-508`, `learning/service.py:163-176`). This changes only *which* skill loads
— never a fact.

---

## 5. Component Reference

### 5.1 Agent core — `agent/client.py`

`ReceptionistAgent` owns: the Gemini client (lazy), the `SkillRouter`, the `KnowledgeMatcher`,
the in-memory `SessionStore`, and a per-model cooldown map.

- **Streaming** — `stream()` is the single source of truth; `reply()` just drains it
  (`agent/client.py:592-598`). Text is yielded the moment Gemini produces it.
- **Model selection** (`_models`, `agent/client.py:320-329`): normally `[main, fallback]`; when
  content was pre-attached the **fast** model goes first: `[fast, main, fallback]`. Models in
  cooldown are skipped.
- **Failover** (`_round`, `agent/client.py:337-356`): the SDK retries 408/5xx with backoff
  (not 429). On failure *before any text was shown*: the fast model hands over to the main model
  on **any** error; the main model hands over to the fallback only on **overload** (408/429/5xx).
  Once text has been emitted, it never switches (the caller must not see a half-answer twice).
- **Quota cooldown** (`_cool_down`, `agent/client.py:331-335`): a 429 benches that model for 60 s,
  so a used-up quota isn't retried on every call.
- **Tool loop** (`agent/client.py:435-498`): up to `agent_max_tool_rounds` (6). Functions are run
  by *us*, not the SDK, so every call is validated and audited; all results go back in **one** turn
  matched by call id. Automatic function calling is disabled (`_config`, `agent/client.py:276`).
- **Block/empty handling**: safety finishes clear the session and return an apology
  (`agent/client.py:358-365`, `443-452`).
- **Prompts for staff**: `draft_answer()` reuses the same routing + knowledge context to draft a
  reply for the review queue, but it is never shown to callers until a human approves it
  (`agent/client.py:553-590`).

`SessionState` is memory-only and expires after 30 min / 1000 sessions (`SessionStore`,
`agent/client.py:117-162`). `contents` holds the real Gemini history; `skills_in_context` avoids
re-sending a skill; `summary` carries compacted older turns; `recent_turns` backs feedback.

### 5.2 Skill router — `router/`

The router picks the skill **server-side, before the LLM**, so most questions are answered in one
call (`router/service.py:1-15`). `route()` tries, in order (`router/service.py:157-179`):

1. **Unambiguous lexical** — a single clear keyword hit scores ≥ 0.8 and leads by ≥ 0.3 → instant,
   no API call.
2. **Semantic** — Gemini embeddings of each skill's description + example questions vs. the
   question; route if score ≥ `router_threshold` (0.65) **and** margin ≥ `router_margin` (0.03).
3. **Weaker lexical** — keyword score ≥ `router_lexical_threshold` (0.35) with margin ≥ 0.1.
4. **Follow-up** — a short message (≤ 8 words) with no topic of its own stays on the previous
   turn's skill.
5. **None** — attach `NO_MATCH_NOTE` so the model knows to search knowledge / log the gap.

- **Embeddings** (`router/embeddings.py`): `gemini-embedding-2`, 768 dims, task written into the
  text (`task: search result | query: …` for queries, `title: … | text: …` for documents),
  batched at 100, L2-normalised, cosine compared.
- **Lexical fallback** (`router/lexical.py`): IDF-weighted token overlap with light stemming and
  **Khmer character bigrams** (Khmer has no inter-word spaces) — works with no API cost and is the
  fallback when embeddings are unavailable.
- **Index build** (`ensure_index`): rebuilt when the skill registry or learned examples change;
  there is a 512-entry query-embedding cache (`router/service.py:86-123`).
- **Knowledge matcher** (`router/knowledge.py`): matches the question against staff-approved
  answers, lexical first (`knowledge.similarity` ≥ 0.6) then embedding (≥ 0.85).

### 5.3 Skills system — `skills/`

A skill is a folder with a `SKILL.md` (YAML frontmatter + body) and optional reference files
(`.md/.yaml/.txt`). Loading follows **progressive disclosure** (`skills/loader.py:1-12`):

| Level | What | When | Cost |
|---|---|---|---|
| L1 | `name` + `description` in the system prompt (`index()`) | always | 1 line/skill |
| L2 | `SKILL.md` body + file list (`load()`) | model calls `load_skill`, or router bundles it | on demand |
| L3 | one reference file (`read_file()`) | model calls `read_skill_file` | on demand |

Skill content is injected either as tools the model calls, or (when routed) as a
`<school_reference skill="…">` block attached to the caller's turn — the reason most chats need
only one model call. `bundle()` packs `SKILL.md` + as many reference files as fit in
`router_bundle_max_bytes` (8000) and lists the rest for later fetching
(`skills/loader.py:138-161`).

**Security.** The agent can only address skills/files discovered at load time; a path is never
built from caller input, so traversal is impossible. Names must match `^[a-z0-9][a-z0-9-]{0,63}$`,
symlinks and oversized files are skipped (`skills/loader.py:22-76`).

**`example_questions()`** (`skills/loader.py:163-179`) reads `## …` headings from a skill's `.md`
files — FAQ questions double as router training examples. This is the pivot the whole learning
loop turns on.

The 11 seeded skills: `academic-calendar, admissions, campus-and-contact, class-schedule,
facilities, fees-and-payments, general-faq, programs-and-courses, scholarships, student-life,
transport`. A skill may ship a `workflow.yaml` (e.g. `admissions`) marking a **multi-step** flow;
the router then prefers the main model and the prompt tells the model to follow the steps one
question per turn (`agent/client.py:399`, `agent/prompts.py:24-25`).

### 5.4 Voice — `voice/`

- **STT** (`voice/stt.py`): self-hosted **faster-whisper** — audio never leaves the server.
  English + language detection use `stt_model_en` (`small`); Khmer uses `stt_model_km` when set
  (a Khmer fine-tuned Whisper converted to CTranslate2, because stock Whisper is weak at Khmer),
  re-running if detection says `km`. VAD filtering and `beam_size=5`. Models warm up in the
  background at startup so the first caller doesn't pay the load/download cost
  (`main.py:32-41`).
- **TTS** (`voice/tts.py`): one `TTS` protocol, two providers — `browser` (server returns no
  audio; the page speaks with `speechSynthesis`, zero cost, Khmer voice device-dependent) and
  `mms` (self-hosted Meta MMS-TTS, **CC-BY-NC 4.0 — non-commercial only**).
- **Playback**: in `browser` mode the page speaks each *finished sentence* as the answer streams
  (`web/js/app.js:41-66`), so speech starts before the full answer exists. If the server returns
  WAV (`audio_base64`), that is played instead (`web/js/app.js:162-166`).

### 5.5 Learning, knowledge & metrics

- **`learning/service.py`** — the human-in-the-loop engine. `log_unanswered` redacts and dedupes
  (similarity ≥ 0.6) so staff see the *most-asked* gaps. `approve` promotes an item into a
  versioned `knowledge_entries` row; `update_entry` creates a **new version** and deactivates the
  old, so history is kept and embeddings never go stale (`knowledge/service.py:61-76`).
  `record_feedback` stores each 👍/👎 once and pushes a 👎 into the review queue with the disliked
  answer attached.
- **`metrics/service.py`** — `TurnStats` records where the time went (`route_ms, ttft_ms, llm_ms,
  tool_ms, stt_ms, tts_ms, total_ms`), token use (`prompt/cached/output/thought`), `path`
  (`tools`/`routed`/`knowledge`), `model`, `retries`, and `outcome`. `summary()` returns p50/p95
  latency, calls-per-answer, by-path counts, error count, **cache-hit ratio**, and the slowest
  turns. **No caller text is stored** (`metrics/models.py:1-4`).

### 5.6 Admin — `api/admin/*`

Every route requires `X-Admin-Key`, compared with `hmac.compare_digest`; if no key is configured
the whole area is refused rather than allowing an empty key (`security/auth.py:17-20`).

| Endpoint | Purpose |
|---|---|
| `GET /api/admin/questions` | the pending review queue |
| `POST …/questions/{id}/approve` | approve → creates a knowledge entry |
| `POST …/questions/{id}/dismiss` | dismiss |
| `POST …/questions/{id}/draft` | AI drafts an answer for staff to edit |
| `GET/PUT/DELETE /api/admin/knowledge…` | list/version/deactivate approved answers |
| `POST …/knowledge/{id}/export` | move an answer into `skills/<skill>/faq.md` |
| `GET /api/admin/messages`, `POST …/done` | caller messages for staff |
| `GET /api/admin/skills`, `POST /skills/reload` | list / hot-reload skill packs |
| `GET /api/admin/feedback`, `GET/DELETE /routing-examples` | feedback + learned examples |
| `GET /api/admin/metrics` | latency/speed dashboard |

`export.py` deliberately writes into a skill's `faq.md` so an approved answer becomes permanent,
git-reviewed, *and* teaches the router via its new FAQ heading — while guarding against read-only
mounts and heading injection (`admin/export.py:1-6,24-48`).

### 5.7 Security — `security/`

Defence in depth on an untrusted-input system:

| Concern | Mechanism |
|---|---|
| Admin auth | `X-Admin-Key` shared secret, constant-time compare |
| Rate limiting | slowapi, per-client IP, `rate_limit` (default 20/min) |
| Response headers | CSP (no inline script/style), `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` scoping microphone; HSTS in production |
| Prompt injection | system prompt treats caller text as untrusted; the caller's own message can never carry a `<school_reference>` tag (`caller_text` neutralises fakes, `client.py:165-170`) |
| PII in logs | `redact()` masks emails/phones before anything is logged, stored, or audited |
| Audit | every tool call and admin action written to `audit_events` (redacted) |
| Input limits | message length, audio size/duration, reply length cap |

### 5.8 Persistence — `database.py`

SQLite via SQLAlchemy 2.0. Tables: `turn_metrics`, `feedback`, `unanswered_questions`,
`knowledge_entries`, `staff_messages`, `routing_examples`, `audit_events`.
`init_db()` runs `create_all()` then a **naive additive migrator** that `ALTER TABLE … ADD COLUMN`s
any missing column (`database.py:33-78`) — fine for simple additions; anything more needs Alembic.

---

## 6. Configuration

All settings come from env/`.env` via `pydantic-settings` (`config.py`). Highlights:

| Group | Key | Default |
|---|---|---|
| Model | `GEMINI_API_KEY` | *(required to answer)* |
| | `GEMINI_MODEL` | `gemini-3.8-flash` |
| | `GEMINI_FALLBACK_MODEL` | `gemini-3.6-flash` |
| | `GEMINI_MODEL_FAST` | `gemini-3.5-flash-lite` |
| | `THINKING_LEVEL` | `low` |
| Router | `ROUTER_ENABLED` / `ROUTER_EMBEDDINGS` | `true` / `true` |
| | `ROUTER_THRESHOLD` / `ROUTER_MARGIN` | `0.65` / `0.03` |
| | `EMBEDDING_MODEL` | `gemini-embedding-2` |
| Voice | `STT_ENABLED` | `false` |
| | `STT_MODEL_EN` / `STT_MODEL_KM` | `small` / *(empty)* |
| | `TTS_PROVIDER` | `browser` |
| Limits | `RATE_LIMIT` | `20/minute` |
| | `MAX_TEXT_CHARS` / `MAX_AUDIO_BYTES` | `1000` / `10 MB` |
| | `SUMMARIZE_AFTER_TURNS` | `10` |
| Admin | `ADMIN_API_KEY` | *(empty → admin disabled)* |

---

## 7. Deployment

`Dockerfile` builds a read-only-root container; `docker-compose.yml` runs it on
`127.0.0.1:8000` with the SQLite file on a named volume (`/app/data`), skills bind-mounted
read-only, `no-new-privileges`, and STT enabled with models cached in a volume. The app listens
on `0.0.0.0:8000` inside the container; only localhost is exposed, so an HTTPS reverse proxy
(Caddy/Nginx) belongs in front for real use.

Startup (`main.py:52-61`) runs `init_db()` and warms the speech models and the router index in
background tasks, so the first caller doesn't pay cold-start cost.

---

## 8. Design Decisions & Trade-offs

| Decision | Why | Cost / caveat |
|---|---|---|
| **Server-side routing before the LLM** | 1 call instead of 3; big latency/cost win | A wrong route still costs one extra call (tools remain available), never a wrong answer |
| **Skills as editable files** | Staff change answers without a redeploy; git-reviewable | Hot-reload reads files each time; large packs need care with the 8 KB bundle |
| **Approved answers in DB, promoted to files** | Fast iteration in DB; permanence + router training in files | Two places to look; explicit export step |
| **Callers can't write knowledge** | Prevents poisoning | Adds a human-review hop (by design) |
| **Embeddings + lexical fallback** | Works offline/no-API and handles Khmer | Two code paths to keep calibrated |
| **In-memory sessions** | Simple, fast, no PII at rest | Single-process only; multi-worker needs Redis/DB (`client.py:118`) |
| **SQLite + naive auto-migration** | Zero-ops start | Not for concurrent writes at scale; real schema changes need Alembic |
| **Browser TTS default** | Free, no licence issue | Khmer voice depends on the device; MMS alternative is non-commercial |
| **Prompt caching via a deterministic prompt** | Cheaper, faster repeat turns | System prompt must stay free of timestamps/per-request data |

---

## 9. Where to Extend

- **Add a school topic** → new `skills/<name>/SKILL.md` (+ reference files); reload from admin.
- **Teach the router a phrasing** → add a `## …` question heading to a skill `.md`, or let the
  automatic routing-example capture learn it.
- **Change a model / threshold** → `config.py` env vars.
- **New tool** (e.g. booking) → add a declaration + handler in `agent/tools.py` (`HANDLERS`).
- **Commercial Khmer TTS** → implement the `TTS` protocol in `voice/tts.py` (e.g. Google Cloud TTS).
- **Multi-worker / multi-instance** → move sessions and the rate-limit counter to Redis
  (flagged in `README.md`).
- **Better migrations** → introduce Alembic (flagged in `../ROADMAP.md`).

---

## 10. Code Map

```
src/receptionist/
  main.py            app factory, lifespan warm-up, static mounts
  config.py          pydantic settings
  database.py        engine, session, create_all + additive migrate
  agent/
    client.py        ReceptionistAgent: stream/tool-loop/model failover/memory
    prompts.py       system prompt (prompt-cache friendly)
    tools.py         5 tools + validation
    guardrails.py    input/output cleaning, language detection
    memory.py        rolling summaries + draft prompt
  router/
    service.py       SkillRouter (lexical-sure → embedding → lexical → follow-up)
    embeddings.py    Gemini embeddings (gemini-embedding-2)
    lexical.py       IDF keyword matcher + Khmer bigrams
    knowledge.py     match staff-approved answers
  skills/loader.py   SkillRegistry: L1/L2/L3 progressive disclosure, bundling
  voice/
    stt.py           faster-whisper STT (+ Khmer model)
    tts.py           browser / Meta MMS TTS
    validators.py    audio content-type/size/magic-byte checks
  learning/          review queue, feedback, learned routing examples
  knowledge/         versioned approved answers
  metrics/           per-turn timings + summary
  messages/          caller→staff messages
  security/          auth, rate limit, headers, redact, audit
  admin/             staff API + faq.md export
web/                 index.html, admin.html, js/app.js, js/admin.js, style.css
skills/              11 skill packs (SKILL.md + reference files)
```

Tests live in `tests/` (Gemini is faked, no API key needed). See `README.md` / `../GUIDE.md` for how
to run and operate it, and `docs/RESEARCH.md` for background research.
