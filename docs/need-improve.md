# Need Improve: Security & Best-Practice Roadmap

Future work for this project, based on a review of the current code. Most urgent items first.
Tick the boxes (`[x]`) as you finish them.

**Legend:** 🔴 do before going public · 🟠 high · 🟡 medium · 🟢 later

---

## 🚀 Done: Faster, smarter responses (implementation log)

Goal: first words in under 1 second, most answers in **1 model call instead of 3**, an agent
that survives Gemini overloads, and one that learns from feedback.

**Status:** ✅ done · 🔄 in progress · ⏳ not started

| Phase | What | Status |
|---|---|---|
| 0 | Measure: per-turn timing + token metrics; eval question set + `tests/evals/run_eval.py` | ✅ |
| 1 | Streaming replies (SSE), async Gemini client, thinking level `low`, **retry + fallback model on 503/429**, speech-model warm-up, speak sentence by sentence | ✅ |
| 2 | Skill router: pick the skill on the server before calling Gemini (3 calls → 1) | ✅ |
| 3 | Fast paths: approved-answer matching, fast "lite" model for routed questions, workflow files | ✅ |
| 4 | Conversation context: session facts, summarising long chats, follow-up questions | ✅ |
| 5 | Learning: 👍/👎 feedback, AI-drafted answers for staff, learned routing examples, export to faq.md, latency panel | ✅ |
| 6 | Infrastructure (Redis, explicit context caching, multi-worker): documented below for when traffic grows | ✅ docs only |

### Log
- 2026-10-10: Started Phase 0. The test notes at the bottom of this file show single Gemini
  calls taking ~30 s and `503 high demand` errors, so retry + fallback was added to Phase 1.
- 2026-10-10: ✅ Phase 0 done.
  - New `src/receptionist/metrics/`: every turn stores timings (model, tools, speech, total,
    time-to-first-text) and token counts (incl. cached + thinking tokens) in `turn_metrics`.
    No caller text is stored there.
  - `GET /api/admin/metrics?hours=24`: p50/p95 latency, model calls per answer, cache hit
    ratio, slowest turns.
  - `tests/evals/questions.yaml` (18 cases: EN/KM facts, unknowns, injections) and
    `tests/evals/run_eval.py` → run `python tests/evals/run_eval.py` for accuracy + latency.
    Reports go to `reports/` (git-ignored). Uses a throwaway DB.
  - `database.py`: safe "add missing columns" step so the existing `receptionist.db` keeps
    working as tables grow.
  - Chat responses now include `turn_id` (used later for 👍/👎).
  - Tests: 65 passing. ruff + bandit clean.
- 2026-10-10: ✅ Phase 1 done.
  - `agent/client.py` is now **async + streaming** (`client.aio.models.generate_content_stream`).
  - **Resilience:** SDK retries 408/429/5xx with exponential backoff + jitter
    (`LLM_RETRY_ATTEMPTS`, default 2), every request has a timeout (`LLM_TIMEOUT_MS`,
    default 20 s), and if the main model is still overloaded the agent switches to
    `GEMINI_FALLBACK_MODEL` (default `gemini-3.6-flash`), but only before any text has been
    shown.
  - `THINKING_LEVEL=low` (Google's recommendation for fact look-ups).
  - New `POST /api/chat/stream` (SSE: `delta` → `done` / `error`), stops the Gemini call on
    browser disconnect, `X-Accel-Buffering: no` for nginx.
  - New `POST /api/transcribe`: voice → text; the page then streams the reply.
  - Whisper models are loaded in the background at startup (`stt.warm_up()`).
  - Chat page: words appear as they stream; the browser speaks each sentence as soon as it is
    complete; buttons are disabled while a reply is running.
  - Tests: 76 passing.
  - **Live measurement with your key** (before the router):
    - Fee question: 3 calls, first word after **15.7 s**, total 16.5 s.
    - "Hello": 1 call, **5.6 s**.
- 2026-10-10: ✅ Phase 2 done (skill router).
  - New `src/receptionist/router/`: the server picks the skill **before** calling Gemini and
    attaches that skill's content (SKILL.md + data files up to 8 KB) to the question, so the
    model can answer in **1 call instead of 3**. Tools stay available as a safety net.
  - Matching order: lexical shortcut → embeddings → IDF keyword → follow-up rule.
  - Calibrated: route when score ≥ 0.65 and margin ≥ 0.03. 18/19 eval questions routed
    correctly.
  - Content fixes: added Khmer keywords to fees/admissions; removed a competing campus-visit
    FAQ from `general-faq`.
  - 429 is not retried; the router index is built at startup.
  - Tests: 100 passing.
  - **Live result:** fee question = **1 call** (was 3); 2nd question in the same chat
    answered in **2.3 s**.
- 2026-10-10: ✅ Phase 3 done (fast paths).
  - **Fast model:** when the answer is already attached (routed skill or approved answer), the
    reply comes from `GEMINI_MODEL_FAST` (default `gemini-3.5-flash-lite`, measured at 1.5 s).
    Falls back to the main model on any error.
  - **Approved answers checked on the server** (`router/knowledge.py`).
  - **No-match note:** when nothing matches, the model is told so, and asked to log the
    question instead of searching every skill.
  - **Workflows:** `skills/admissions/workflow.yaml` (book a campus tour).
  - **Circuit breaker:** after a `429 quota exceeded`, that model is skipped for 60 s.
  - Tests: 107 passing.
  - **Live result:** Grade 7 tuition first word **1.4 s**, total **1.7 s**, 1 call — about
    **10× faster** than the Phase 1 baseline.
- 2026-10-10: ✅ Phase 4 done (conversation context).
  - New `agent/memory.py`: **rolling summaries**. After `SUMMARIZE_AFTER_TURNS` (default 10)
    caller messages, the fast model condenses the chat into a ≤120-word summary. Runs in the
    background after the reply is sent, so nobody waits for it.
  - Phone numbers and emails are masked before summarising; school references and server
    notes are left out; summaries live only in memory (30-min session expiry).
  - Safe under concurrency: if a new message arrives while a summary is being written, that
    summary is discarded.
  - Follow-up questions keep their topic even across a summary.
  - Tests: 110 passing.
- 2026-10-10: ✅ Phase 5 done (learning loop).
  - **👍/👎 feedback** under every bot reply (`POST /api/feedback`). A 👎 is sent to the
    staff review queue with the question and the answer the caller didn't like.
  - **Learned routing examples:** when a caller's question made the model load a different
    skill than the router chose, that question is saved as a routing example for that skill.
    Deduped at 0.8 similarity, max 50 per skill. The router rebuilds its index when examples
    change, so the next similar question routes directly (one less call).
  - **"Draft with AI"** button in `/admin`: the AI writes a first version of the answer from
    the skills; staff edit and approve. Returns `NOT FOUND IN SKILLS` when nothing matches,
    without wasting an LLM call.
  - **"Move to skill faq.md"** export: an approved answer is written into
    `skills/<skill>/faq.md` (lines starting with `#` escaped) and retired from the DB. The
    router rebuilds, so the new FAQ question teaches routing straight away.
  - **Admin speed panel:** p50/p95 latency, answers per path, 👍/👎 counts, slowest turns.
  - **Live check (2026-10-10):** typed a fee question → got the answer → clicked 👎 → `201`
    → appeared in the review queue with `source=feedback` and the previous answer → clicked
    "Draft with AI" → got a correct draft from `fees-and-payments`.
  - Tests: 122 passing. ruff + bandit clean.
- 2026-10-12: ✅ Phase 6 documented (see #16 below).
  - Not needed at one-school traffic. The notes record exactly what to switch on when there
    is more than one worker, when sessions must survive a restart, or when the skills bundle
    grows past a few hundred KB. No code change was shipped for Phase 6.

---

## 🔴 1. Cost and overload attacks
**Problem:** `/api/chat` is anonymous, and every message calls Gemini, which costs money.
The only protection is a per-IP rate limit, so a bot rotating IP addresses could run up a large
bill. Voice is worse: `src/receptionist/voice/stt.py` runs Whisper with no limit on how many run
at once, so a few long uploads at the same time can use up all the CPU.

- [ ] Set a budget alert and quota limit in Google AI Studio / Google Cloud
- [ ] Add a server-side daily cap on Gemini calls, with a friendly "busy" reply when it is reached
- [ ] Allow only 1-2 transcriptions at a time (a semaphore or job queue); reply `503 busy` when full
- [ ] Add a bot check (e.g. Cloudflare Turnstile) before the first message in a session

## 🔴 2. Rate limiting breaks behind a proxy
**Problem:** `src/receptionist/security/rate_limit.py` identifies callers by IP address. Behind a
reverse proxy or Docker, every request looks like it comes from the proxy's IP, so the limit
either applies to everyone together or stops working. The counter is also held in memory, so
each worker counts separately.

- [ ] Run uvicorn with `--forwarded-allow-ips=<proxy IP>` (trust only your own proxy)
- [ ] Keep the rate-limit counter in Redis (`Limiter(storage_uri="redis://...")`)
- [ ] Also limit per session, not only per IP (a school Wi-Fi shares one IP)

## 🔴 3. Stronger admin login
**Problem:** `src/receptionist/security/auth.py` uses one shared key:
- Nobody knows which staff member approved what.
- There is no brute-force protection.
- The key sits in `sessionStorage`, so any XSS bug could steal it.

- [ ] Per-staff accounts (SSO, or password + 2FA)
- [ ] Short sessions in `HttpOnly; Secure; SameSite=Strict` cookies, with CSRF protection
- [ ] Rate-limit the admin routes, and lock out after repeated failed sign-ins
- [ ] Record the real staff user in `approved_by` and the audit log

## 🔴 4. Privacy for students (minors)
**Problem:** callers' words are sent to Google (Gemini API). `src/receptionist/security/redact.py`
only masks emails and phone numbers, and data is kept forever.

- [ ] Check local data-protection law and Google's Gemini API terms (paid tier: prompts are not
      used to train models; free tier: they may be)
- [ ] Publish a privacy notice on the chat page ("AI assistant, don't share sensitive info")
- [ ] Redact student names and ID numbers before they reach the review queue and logs
- [ ] Add a scheduled cleanup job (e.g. delete messages after 90 days and audit rows after 1 year)
- [ ] Encrypt the database and its backups at rest

---

## 🟠 5. Pin dependencies exactly
**Problem:** `pyproject.toml` uses `>=` ranges, so a compromised or broken future release would
install silently. The Docker base image is not pinned either.

- [x] Generate a lockfile (`pip freeze > requirements.lock.txt` on 2026-10-12). Upgrade later
      with `pip-compile --generate-hashes` or `uv lock` for hash pinning.
- [ ] Pin the base image by digest: `python:3.12-slim@sha256:...`
- [ ] Pin `TTS_MMS_REVISION` / STT model revisions to exact commit hashes

## 🟠 6. Automatic checks on GitHub (CI)
**Problem:** checks only run on your machine, and only if `pre-commit install` was run.

- [ ] GitHub Actions workflow running `pytest`, `ruff`, `bandit` and `pip-audit` on every push
      and pull request
- [ ] Turn on Dependabot (dependency updates)
- [ ] Turn on GitHub secret scanning with push protection
- [ ] Turn on CodeQL code scanning
- [ ] Protect `main`: require pull requests and passing checks

## 🟠 7. Run audio decoding in a separate container
**Problem:** untrusted audio is decoded by FFmpeg libraries, which have a long history of security
bugs. The magic-byte check reduces the risk but doesn't remove it.

- [ ] Run STT in its own container/process: no network, read-only filesystem, CPU and memory limits
- [ ] Keep `faster-whisper` / `av` updated

## 🟠 8. Production secrets
- [ ] Use Docker secrets or a secrets manager instead of a `.env` file in production
- [ ] Rotate `GEMINI_API_KEY` and admin credentials on a schedule (e.g. every 90 days)

---

## 🟡 9. Server-issued sessions
**Problem:** the browser chooses its own `session_id`.

- [ ] The server issues a signed `HttpOnly` session cookie
- [ ] Cap `take_message` and `log_unanswered` calls per session, so nobody can flood staff

## 🟡 10. Remove the `TypeError` shortcut ✅
- [x] Check credentials once and fail with a clear message (`AgentNotConfigured`, done during the
      Gemini switch)
- [x] Remove `TypeError` from the `except` clause

## 🟡 11. Automated evals (accuracy + prompt injection)
**Problem:** the test sheet and attack table in `USEIT.md` (section 6) are manual.
*(Built in Phase 0 above.)*

- [x] Script that runs the question set against the real model and checks the expected facts
- [x] Prompt-injection set in English **and Khmer** (typed; spoken still to do)
- [ ] Run it before every prompt or skill change, and track the pass rate over time

## 🟡 12. Check answers against the data
**Problem:** the prompt says "never invent fees", but nothing checks that it obeyed.

- [ ] Compare numbers (prices, dates) in the reply with what the tools actually returned
- [ ] If a number did not come from a tool, hold the reply or flag it for review

## 🟡 13. Database maturity
- [ ] Move from SQLite to PostgreSQL
- [ ] Use Alembic migrations instead of `create_all`
- [ ] Keep conversation memory in Redis (needed for more than one worker)
- [ ] Automated backups, with a tested restore

## 🟡 14. Missing tests
- [ ] Rate limiting
- [ ] Admin brute-force lockout
- [ ] STT on real audio files (English + Khmer samples)
- [ ] Session expiry and the history cap
- [ ] Code coverage report (`pytest --cov`), with a minimum threshold in CI

---

## 🟢 15. Operations
- [ ] Structured JSON logs with request IDs
- [ ] Alerts for error spikes, refusals and a growing review queue
- [ ] Notify staff (email or Telegram) when a new message arrives
- [ ] Incident plan: kill switch, key rotation, and who informs parents if something goes wrong
- [ ] Threat model (STRIDE) review once a year
- [ ] Professional penetration test before a large public launch

---

## 🟢 16. Phase 6 — Infrastructure for when traffic grows

Not needed at one-school traffic (one worker, in-memory sessions, SQLite). Switch these on
when the receptionist handles more than one classroom's worth of concurrent chats, or when
the server has to survive restarts without losing conversations.

### 16.1 Redis for sessions, rate limiting and (future) answer cache
**Why:** today `SessionStore` in `agent/client.py` lives in a single Python process, and
`slowapi` keeps its rate-limit counters there too. With more than one uvicorn worker, each
worker has its own copy, so sessions bounce between them and limits only count the worker
you hit.

- [ ] Add `redis>=5` to an optional dependency group `[scale]` in `pyproject.toml`.
- [ ] Replace `SessionStore` with a Redis-backed store (key `sess:<id>`, 30-min TTL, JSON of
      `SessionState`). Keep the in-memory version as the local-dev default.
- [ ] Point `slowapi.Limiter(storage_uri=settings.redis_url)` once `REDIS_URL` is set.
- [ ] Add `REDIS_URL` to `config.py` (defaults to `None` → in-memory).

### 16.2 Explicit Gemini context caching
**Why:** today the agent relies on Gemini's *implicit* prefix cache. Once the skills bundle
is large (several hundred KB) or when traffic is high, create a cache explicitly with
`client.caches.create(...)` so the long parts (system prompt + skill index) are stored on
Google's side and billed at the cheap cached-token rate.

- [ ] Build one cache per `(school_name, skills.version)`; store its id in the registry.
- [ ] Pass `cached_content=` on the first `generate_content_stream` call of each turn.
- [ ] Delete old caches on `SkillRegistry.reload()`.
- [ ] Only enabled when `GEMINI_EXPLICIT_CACHE=true` (default false).

### 16.3 Several uvicorn workers
**Why:** today the server is `uvicorn … --reload`, which is one worker. Two or four workers
can handle more concurrent SSE streams, but only if 16.1 is done first (so sessions and rate
limits are shared).

- [ ] Production command: `uvicorn receptionist.main:app --workers 4 --proxy-headers --forwarded-allow-ips=<proxy>`.
- [ ] Document in `README.md` once Redis is set up.

### 16.4 Region close to Gemini + keep-alive
**Why:** every Gemini call makes a round-trip to Google's data centre; a server in a far
region adds ~150–300 ms per call. The google-genai SDK already keeps HTTP connections open,
but check it on the production box.

- [ ] Pick a Google Cloud / Vercel / Fly.io region in `us-central1` or `asia-southeast1`
      (whichever is closer to the school and to the Gemini endpoint).
- [ ] Verify `httpx` connection reuse in production logs.

---

## Recommended order
1. **1-4**, before any public URL exists. Until then, keep the app on the school network or
   behind a login.
2. **5-6** this week. They are cheap and protect everything else.
3. **9**, then **11** (evals). Evals are what prove the agent stays correct as it improves.
4. **16** when traffic goes above one classroom's worth.
5. Everything else as the project grows.

See also: `USEIT.md` (how to use and test the system), `README.md` (overview and setup),
`docs/PROGRESS.md` (speed-and-learning work notes), `docs/RESEARCH.md` (research log).

---

## Your notes from testing (kept as written)

- AI slow response → ✅ fixed in Phases 1-3.
- Less information about the school detail → fill in the TODOs in `skills/`.
- Voice did not working (Voice input is disabled (set STT_ENABLED=true).)
  → Fix: `pip install -e ".[voice]"` and set `STT_ENABLED=true` in `.env` (USEIT.md Step 6).
- Push response of the ai → ✅ streaming replies (Phase 1).
- input the dataset to train → skill folders created; fill in the TODOs in `skills/`.
- Error khmer language → the log you pasted was cut off before the error. Paste the full error
  and it will be added here.

Log excerpt showing the original slowness and overload (now fixed):
```
11:11:43 ... tool:load_skill
11:12:14 ... tool:read_skill_file      ← ~30 s for one model call
11:12:18 ... Gemini API error 503: This model is currently experiencing high demand.
```
