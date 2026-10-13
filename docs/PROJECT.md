# AICA Receptionist AI Agent — Project Documentation

> **Last updated:** 2026-10-13
> **Repository:** AI-Agent For Receptionist
> **Author:** panhapanha-kskt

---

## 1. Overview

An AI-powered receptionist for **AICA (AI & Cybersecurity Academy)** in Phnom Penh, Cambodia.
The agent answers questions about courses, fees, admissions, schedules, and campus information
in **English and Khmer**, using Google Gemini as the LLM backend. It serves a web chat interface
with voice input/output and an admin dashboard for staff.

**Key facts about AICA:**
- Backed by DACTA Global Academy (Singapore), operated by VANGUARD AI & DIGITAL ACADEMY CO., LTD.
- Address: #5A-5B Street 114, Phsar Thmey 1, Daun Penh, Phnom Penh
- Three tracks: AI (13 courses), Cyber Security (1 course), GRC & Data Protection (4 courses) — 18 courses total
- 4 courses currently "On Special" starting Oct 19, 2026: CEH ($500), CCT ($400), AI Essentials ($200), CASP ($400)

---

## 2. Tech Stack

| Component | Technology |
|---|---|
| Language | Python >= 3.11 |
| Web framework | FastAPI >= 0.115 |
| ASGI server | Uvicorn >= 0.30 |
| LLM | Google Gemini (via `google-genai >= 2.29`) |
| Database | SQLAlchemy >= 2.0, SQLite by default |
| Config | pydantic-settings >= 2.4, `.env` files |
| Rate limiting | slowapi >= 0.1.9 |
| STT (optional) | faster-whisper >= 1.0 (self-hosted) |
| TTS (optional) | Browser Web Speech API, or Meta MMS-TTS |
| Tests | pytest, httpx |
| Linting | ruff, bandit, pip-audit |

### Gemini Models Used

| Role | Model | When |
|---|---|---|
| Main | `gemini-3.8-flash` | Workflows, unrouted questions |
| Fast | `gemini-3.5-flash-lite` | Pre-routed FAQ questions |
| Fallback | `gemini-3.6-flash` | When main/fast hit rate limits |
| Embeddings | `gemini-embedding-2` | Skill routing, knowledge matching |

---

## 3. Project Structure

```
AI-Agent For Receptionist/
├── src/receptionist/
│   ├── main.py                  # App factory, middleware, startup
│   ├── config.py                # Settings from .env (pydantic-settings)
│   ├── database.py              # SQLAlchemy engine, session, migrations
│   │
│   ├── agent/
│   │   ├── client.py            # ReceptionistAgent: Gemini calls, tool loop, sessions
│   │   ├── prompts.py           # System prompt builder
│   │   ├── tools.py             # 5 tool definitions + handlers
│   │   ├── guardrails.py        # Input/output sanitization
│   │   └── memory.py            # Conversation summaries, PII-safe transcripts
│   │
│   ├── router/
│   │   ├── service.py           # SkillRouter: semantic + lexical routing
│   │   ├── embeddings.py        # Gemini embedding wrapper, cosine similarity
│   │   ├── lexical.py           # IDF keyword matching (EN stemming + KM bigrams)
│   │   └── knowledge.py         # KnowledgeMatcher: approved Q&A lookup
│   │
│   ├── skills/
│   │   └── loader.py            # SkillRegistry: discover, parse, serve skills
│   │
│   ├── knowledge/
│   │   ├── models.py            # KnowledgeEntry ORM (versioned, active flag)
│   │   └── service.py           # CRUD + similarity search
│   │
│   ├── learning/
│   │   ├── models.py            # UnansweredQuestion, Feedback, RoutingExample
│   │   └── service.py           # Review queue, feedback, routing examples, drafts
│   │
│   ├── messages/
│   │   ├── models.py            # StaffMessage ORM (human handoff)
│   │   └── service.py           # Create/list/mark-done messages
│   │
│   ├── metrics/
│   │   ├── models.py            # TurnMetric ORM (timing + tokens)
│   │   └── service.py           # TurnStats, record(), p50/p95 summary
│   │
│   ├── chat/
│   │   ├── router.py            # Public API: /chat, /chat/stream, /transcribe, /voice, /feedback
│   │   └── schemas.py           # Pydantic request/response models
│   │
│   ├── voice/
│   │   ├── stt.py               # WhisperSTT: faster-whisper (EN + Khmer)
│   │   ├── tts.py               # BrowserTTS or MmsTTS
│   │   └── validators.py        # Audio upload validation
│   │
│   ├── admin/
│   │   ├── router.py            # Admin API (X-Admin-Key protected)
│   │   ├── schemas.py           # Admin Pydantic models
│   │   └── export.py            # Export approved Q&A to skill faq.md
│   │
│   └── security/
│       ├── auth.py              # Admin key auth (constant-time compare)
│       ├── rate_limit.py        # Per-IP rate limiting
│       ├── headers.py           # CSP, X-Frame-Options, HSTS, etc.
│       ├── audit.py             # Audit event logging
│       └── redact.py            # PII redaction (email, phone)
│
├── skills/                      # 11 skill folders with real AICA data
├── web/                         # Chat UI + Admin dashboard
├── tests/                       # 122 tests + eval questions
├── scripts/run_eval.py          # Live accuracy + latency evaluation
├── progress/                    # PLAN.md + PROGRESS.md
├── docs/                        # Research, lockfile, this file
└── models/                      # Placeholder for Khmer Whisper model
```

---

## 4. Architecture

### Request Flow

```
Caller (browser)
  │
  ├── Text: POST /api/chat/stream (SSE)
  │         or POST /api/chat (JSON)
  │
  └── Voice: POST /api/transcribe → text → POST /api/chat/stream
             or POST /api/voice (one-shot JSON)
  │
  ▼
┌─────────────────────────────────────────────────────┐
│  INPUT VALIDATION                                   │
│  Rate limit (20/min) → guardrails.clean_input()     │
│  Voice: validate_audio() → stt.transcribe()         │
└──────────────────────┬──────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────┐
│  SKILL ROUTER (runs before LLM — the key speed-up) │
│                                                     │
│  1. Lexical sure match (score ≥ 0.8, margin ≥ 0.3) │
│  2. Embedding match (cosine ≥ 0.65, margin ≥ 0.03) │
│  3. Weaker lexical (score ≥ 0.35, margin ≥ 0.1)    │
│  4. Follow-up heuristic (≤8 words → reuse skill)    │
│  5. No match → tools fallback                       │
└──────────────────────┬──────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────┐
│  KNOWLEDGE MATCHER                                  │
│  Check approved Q&A (lexical then embeddings)       │
│  Match ≥ 0.85 → attach answer as reference          │
└──────────────────────┬──────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────┐
│  BUILD GEMINI REQUEST                               │
│  - System prompt (school name + skill index)        │
│  - Conversation summary (if long chat)              │
│  - <school_reference> block (routed skill bundle    │
│    and/or approved answer)                          │
│  - Caller's message                                 │
│  - Select model: fast → main → fallback             │
└──────────────────────┬──────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────┐
│  STREAMING GENERATION (up to 6 tool rounds)         │
│  - Yield text chunks → SSE "delta" events           │
│  - Tool calls: validate → execute → send results    │
│  - Model cascade on errors (fast → main → fallback) │
│  - Circuit breaker: skip model for 60s after 429    │
└──────────────────────┬──────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────┐
│  POST-PROCESSING                                    │
│  - guardrails.clean_output() (truncate to 3000)     │
│  - Learn routing example if router missed           │
│  - Record metrics (timing, tokens, path)            │
│  - TTS synthesis (if server-side TTS enabled)       │
│  - SSE "done" event → browser                       │
└─────────────────────────────────────────────────────┘
```

### Model Selection Logic

```
Question arrives
  │
  ├── Routed + no workflow + approved answer? → fast model (gemini-3.5-flash-lite)
  ├── Routed + workflow? → main model (gemini-3.8-flash)
  └── Unrouted? → main model
      │
      └── Model 429'd in last 60s? → skip to next in cascade
          fast → main → fallback (gemini-3.6-flash)
```

---

## 5. Skill System

### Progressive Disclosure

The agent does not dump all school data into every request. Skills are loaded in layers:

| Level | What | When |
|---|---|---|
| 1 — Index | Skill name + one-line description | Always in system prompt |
| 2 — Load | Full SKILL.md body + file listing | On `load_skill` tool call |
| 3 — Read | Individual data file (fees.yaml, etc.) | On `read_skill_file` tool call |
| Bundle | SKILL.md + small data files (≤ 8 KB) | Router attaches before LLM call |

### Installed Skills (11)

| Skill | Description | Data Files |
|---|---|---|
| `academic-calendar` | Term dates, holidays, exam periods | `calendar.yaml` |
| `admissions` | Requirements, documents, process | `requirements.md`, `workflow.yaml` |
| `campus-and-contact` | Address, phone, email, hours | — |
| `class-schedule` | Timetable and class times | `timetable.yaml` |
| `facilities` | Classrooms, labs, campus info | `facilities.yaml` |
| `fees-and-payments` | Tuition, payment methods, discounts | `fees.yaml` |
| `general-faq` | Common questions | `faq.md` |
| `programs-and-courses` | 18 courses across 3 tracks | `programs.yaml`, `faq.md` |
| `scholarships` | Scholarship info and eligibility | `scholarships.yaml` |
| `student-life` | Activities, workshops, community | `student-life.md` |
| `transport` | Directions, landmarks, how to get here | `routes.yaml` |

### Skill File Format

Each skill folder has a `SKILL.md` with YAML frontmatter:

```yaml
---
name: fees-and-payments
description: Tuition fees, payment methods, discounts...
triggers: [fees, tuition, cost, price, payment, discount]
last_updated: 2026-10-13
source: https://www.aicacademy.ai/en/programs
---

# Fees and Payments

## Quick answers
- CEH: $500 (40 hours, On Special)
...

## How to answer
- Read `fees.yaml` for detailed pricing.
...
```

---

## 6. Agent Tools

The Gemini agent has 5 tools available as a fallback when the router does not pre-attach content:

| Tool | Purpose |
|---|---|
| `load_skill` | Load a skill's full instructions (Level 2) |
| `read_skill_file` | Read a specific data file (Level 3) |
| `search_knowledge` | Search staff-approved Q&A entries |
| `take_message` | Save a message for staff (human handoff) |
| `log_unanswered` | Record a question the agent cannot answer |

All tool inputs are validated. Skill names are restricted to an enum of registered skills (no path traversal).

---

## 7. Web Interface

### Chat Page (`/`)

- Single-page chat with text input and voice recording (hold mic button)
- Language selector: Auto / English / Khmer
- **Streaming:** SSE displays text word-by-word as Gemini generates it
- **Voice:** Sentence-by-sentence speech via browser Web Speech API
- **Feedback:** Thumbs up/down buttons on each bot reply
- **Security:** All text inserted via `textContent` (no innerHTML), strict CSP

### Admin Dashboard (`/admin`)

Protected by `X-Admin-Key` header. Features:

1. **Speed panel** — median TTFT, median/p95 total time, avg LLM calls, routed %, error count
2. **Review queue** — unanswered questions + thumbs-down answers; "Draft with AI", approve, dismiss
3. **Messages** — messages callers left for staff offices; mark done
4. **Knowledge** — view/edit/delete approved Q&A; export to skill `faq.md`
5. **Feedback** — thumbs-down answers with full context
6. **Routing examples** — auto-learned phrases; view and delete
7. **Skills** — list loaded skills; reload from disk

---

## 8. Database

SQLite by default (`receptionist.db`). Seven tables:

| Table | Purpose |
|---|---|
| `knowledge_entries` | Staff-approved Q&A (versioned: edits create new rows) |
| `unanswered_questions` | Review queue items (grouped by similarity, `times_asked` counter) |
| `feedback` | Caller ratings (up/down) per turn; down creates review queue items |
| `routing_examples` | Auto-learned phrases for skill routing (max 50 per skill) |
| `staff_messages` | Messages left by callers for specific offices |
| `turn_metrics` | Per-turn timing (stt/route/llm/tool/tts ms) + token counts |
| `audit_events` | Tool calls and admin actions (PII-redacted) |

---

## 9. Security

| Layer | Implementation |
|---|---|
| Admin auth | `X-Admin-Key` header, constant-time compare (`hmac.compare_digest`) |
| Rate limiting | Per-IP via slowapi (default 20/min) |
| HTTP headers | CSP (no inline scripts), X-Frame-Options, X-Content-Type, HSTS, Referrer-Policy |
| Input sanitization | Unicode normalize, strip control chars, length cap (1000 chars) |
| Output sanitization | Truncate to 3000 chars, `textContent`-only rendering |
| Prompt injection defense | `<school_reference>` tags in caller text are neutralized; skill content goes in user turn, not system prompt |
| PII redaction | Email and phone patterns masked in audit logs and conversation summaries |
| Audio validation | Content-type allowlist, size limit, magic-byte verification |
| Path traversal | Skill files looked up by registered name only; symlinks rejected |
| Secrets | `GEMINI_API_KEY` and `ADMIN_API_KEY` are `SecretStr`; `.env` is in `.gitignore` |

---

## 10. Voice System

### Speech-to-Text (STT)

- **Engine:** faster-whisper (self-hosted CTranslate2 Whisper)
- **English:** Uses `STT_MODEL_EN` (default: `base`)
- **Khmer:** Uses `STT_MODEL_KM` if configured (fine-tuned Whisper converted to CTranslate2)
- **Flow:** If Khmer detected during English transcription, re-transcribes with Khmer model
- **Warm-up:** Models load at server startup (not on first request)
- **Requirements:** `pip install -e ".[voice]"` and `STT_ENABLED=true` in `.env`

### Text-to-Speech (TTS)

Two options:

1. **BrowserTTS (default):** No server-side synthesis; the browser speaks each sentence using Web Speech API as text streams in. Khmer uses `km-KH` locale.
2. **MmsTTS (optional):** Server-side Meta MMS-TTS (`facebook/mms-tts-eng`, `facebook/mms-tts-khm`). Requires `pip install -e ".[tts-mms]"`.

---

## 11. Learning Loop

The agent learns from caller interactions, always with staff approval for factual content:

```
Caller asks question
  │
  ├── Agent can't answer → logged to review queue (auto-grouped, times_asked++)
  │     └── Staff reviews on /admin:
  │           ├── "Draft with AI" → LLM generates answer from skills
  │           ├── Edit + Approve → becomes knowledge entry
  │           └── Dismiss
  │
  ├── Caller rates answer 👎 → review queue item with bad answer attached
  │     └── Staff corrects → new knowledge entry
  │
  └── Router missed but model found skill via tool
        └── Auto-learned routing example (max 50/skill)
            (Low risk: routing only decides which approved content to load)
```

Knowledge entries can be exported to `skills/<skill>/faq.md` via the admin dashboard, making them permanent, git-versionable skill content.

---

## 12. Performance Metrics

Every turn records timing to the `turn_metrics` table:

| Metric | What |
|---|---|
| `stt_ms` | Speech-to-text time |
| `route_ms` | Skill router time |
| `ttft_ms` | Time to first token from Gemini |
| `llm_ms` | Total LLM generation time |
| `tool_ms` | Tool execution time |
| `tts_ms` | Text-to-speech time |
| `total_ms` | End-to-end time |
| `llm_calls` | Number of Gemini API calls |
| `prompt_tokens` | Input tokens |
| `cached_tokens` | Cached input tokens |
| `output_tokens` | Output tokens |
| `thought_tokens` | Thinking tokens |

### Measured Improvements (Phase 0-5)

| Metric | Before | After |
|---|---|---|
| LLM calls per answer | 3 | 1 (routed) |
| Time to first words | 15.7s | 1.4s |
| Full answer time | 16.5s | 1.7s |

---

## 13. Configuration

All settings are in `.env` (see `.env.example`). Key settings:

```env
# Required
GEMINI_API_KEY=your-key-here
ADMIN_API_KEY=your-admin-key

# Models
GEMINI_MODEL=gemini-3.8-flash
GEMINI_MODEL_FAST=gemini-3.5-flash-lite
GEMINI_FALLBACK_MODEL=gemini-3.6-flash

# Router
ROUTER_THRESHOLD=0.65
ROUTER_MARGIN=0.03

# Voice (optional)
STT_ENABLED=false
STT_MODEL_EN=base

# App
SCHOOL_NAME=AICA
DATABASE_URL=sqlite:///./receptionist.db
RATE_LIMIT=20/minute
```

---

## 14. API Endpoints

### Public (caller-facing)

| Method | Path | Description |
|---|---|---|
| POST | `/api/chat` | Text chat, JSON response |
| POST | `/api/chat/stream` | Text chat, SSE streaming response |
| POST | `/api/transcribe` | Voice → text only |
| POST | `/api/voice` | Voice → full JSON reply + audio |
| POST | `/api/feedback` | Rate an answer (up/down) |

### Admin (require `X-Admin-Key`)

| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/questions` | List review queue |
| POST | `/api/admin/questions/{id}/approve` | Approve with answer |
| POST | `/api/admin/questions/{id}/dismiss` | Dismiss from queue |
| POST | `/api/admin/questions/{id}/draft` | Generate AI draft |
| GET | `/api/admin/knowledge` | List approved Q&A |
| PUT | `/api/admin/knowledge/{id}` | Edit (creates new version) |
| DELETE | `/api/admin/knowledge/{id}` | Deactivate |
| POST | `/api/admin/knowledge/{id}/export` | Export to skill faq.md |
| GET | `/api/admin/messages` | List staff messages |
| POST | `/api/admin/messages/{id}/done` | Mark message done |
| GET | `/api/admin/skills` | List loaded skills |
| POST | `/api/admin/skills/reload` | Reload skills from disk |
| GET | `/api/admin/feedback` | List caller feedback |
| GET | `/api/admin/routing-examples` | List learned routing examples |
| DELETE | `/api/admin/routing-examples/{id}` | Delete routing example |
| GET | `/api/admin/metrics` | Performance summary |

---

## 15. Testing

**122 tests** using a `FakeGemini` mock (no real API key needed):

| Test File | Coverage |
|---|---|
| `test_api.py` | API endpoint integration |
| `test_fast_paths.py` | Fast model, fallback cascade, circuit breaker |
| `test_guardrails.py` | Input/output sanitization, language detection |
| `test_learning.py` | Feedback, routing examples, AI drafts, export |
| `test_memory.py` | Conversation summaries, long chats |
| `test_metrics.py` | Timing recording and summary |
| `test_router.py` | Skill routing (EN, KM, below-threshold, follow-up) |
| `test_skills_loader.py` | Skill registry loading |
| `test_stream.py` | SSE streaming |
| `test_tools.py` | Tool handler validation |

**Evaluation set:** `tests/evals/questions.yaml` — 18 questions in English and Khmer.

**Live eval:** `scripts/run_eval.py` — runs against real Gemini, reports accuracy + p50/p95 latency.

Run tests:
```bash
pytest
```

Run live evaluation:
```bash
python scripts/run_eval.py
```

---

## 16. Deployment

### Local Development

```bash
# Install
pip install -e ".[dev]"

# Configure
cp .env.example .env
# Edit .env with your GEMINI_API_KEY and ADMIN_API_KEY

# Run
uvicorn receptionist.main:app --reload

# With voice
pip install -e ".[voice]"
# Set STT_ENABLED=true in .env
```

### Docker

```bash
docker compose up
```

The `docker-compose.yml` sets `STT_ENABLED=true` and mounts a `models/` volume for the Khmer Whisper model.

### Production Considerations

- Switch to a paid Gemini tier (free tier has rate limits and privacy concerns)
- Use PostgreSQL instead of SQLite for concurrent access
- Add Redis for sessions, caching, and rate limiting (Phase 6 in the plan)
- Host near Gemini's servers to reduce network latency
- Run multiple uvicorn workers behind a reverse proxy

---

## 17. Implementation Status

| Phase | Description | Status |
|---|---|---|
| Phase 0 | Metrics and evaluation framework | Done |
| Phase 1 | Streaming, async, warm-up, thinking level | Done |
| Phase 2 | Skill router (3 calls → 1) | Done |
| Phase 3 | Answer cache, workflows, fast model | Done |
| Phase 4 | Session context and conversation memory | Done |
| Phase 5 | Learning loop (feedback, routing examples, drafts) | Done |
| Phase 6 | Infrastructure (Redis, multi-worker, Gemini caching) | Not started |

**Appendix A (live-test fixes):**
- A.1 Fill skills with real data — Done (all 24 files populated)
- A.2 Gemini 503 handling — Needs paid tier
- A.3 Voice input — Needs `pip install -e ".[voice]"` + `STT_ENABLED=true`
- A.4 Router margin tuning — Pending real-data testing

See `progress/PLAN.md` for the full plan and `progress/PROGRESS.md` for detailed implementation notes.
