# AI Voice Receptionist (Academy School, English + Khmer)

An AI receptionist that answers voice and text messages about the school, in English and Khmer.
It is built on Google Gemini (google-genai SDK) and FastAPI, with self-hosted speech-to-text
(faster-whisper). Replies **stream** to the browser (first words in ~1 s on a routed FAQ),
speech is spoken sentence by sentence, and the agent **learns safely** from caller feedback
with staff approval.

```
Voice / text ─► validate ─► STT (faster-whisper) ─► Router ─► Gemini agent ──► stream ──► browser speaks
                                                     │                   │
                               skills/ (SKILL.md) ◄──┤          tools ───┤
                               approved Q&A      ◄──┤                   │
                               staff messages    ◄──────── writes ──────┘
                                     ▲
                        /admin: 👍/👎, review queue, "Draft with AI",
                                 "Move to faq.md", speed panel
```

## Quick start (Windows / PowerShell)

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -e ".[dev]"          # add ,voice for speech-to-text
copy .env.example .env           # then fill in GEMINI_API_KEY and ADMIN_API_KEY
uvicorn receptionist.main:app --reload
```

- Chat page: http://localhost:8000/
- Staff admin page: http://localhost:8000/admin (sign in with `ADMIN_API_KEY`)
- API docs (development only): http://localhost:8000/docs

Generate an admin key with `python -c "import secrets; print(secrets.token_urlsafe(32))"`.

## What makes it fast

| Where it starts | Where it ends | How |
|---|---|---|
| 3 Gemini calls per answer (15 s + ) | **1 call** (~1.7 s) | Server-side **skill router** attaches the matching skill content to the first request |
| Reply shown only when fully done | **First words in ~1 s** | SSE streaming (`POST /api/chat/stream`) + sentence-by-sentence speech in the browser |
| 503/429 errors broke answers | Keeps answering | Timeout + retry + fallback model, plus a 60 s circuit breaker on 429 |
| Static answers only | Learns from use | 👍/👎 feedback, learned routing examples, AI drafts for staff, export to `faq.md` |

See `docs/GUIDE.md` for detailed usage and testing instructions.

## How the agent gets smarter

**1. Skills** (`skills/<name>/SKILL.md`): one folder per topic, following the Agent Skills
*progressive disclosure* pattern.
- The system prompt holds only each skill's `name` + `description`.
- The **router** picks a skill from the caller's question and attaches its SKILL.md + small
  data files (≤ 8 KB) to the request. The agent answers in one call.
- If the router misses, the agent still has `load_skill` and `read_skill_file` as tools.

To add a skill, copy `skills/_template`, rename the folder, edit it, then click
**Reload skills** on the admin page. Folders starting with `_` are ignored. The `## question`
headings in each `faq.md` double as routing examples.

**2. Human-approved learning loop**
1. A caller asks something no skill or approved answer covers.
2. The agent says it doesn't know, calls `log_unanswered`, and offers to take a message.
3. Staff see the question on the admin page; **"Draft with AI"** writes a first version
   from the skills; staff edit, pick a skill, and approve.
4. The approved answer becomes a versioned knowledge entry. The next caller gets it.
5. **"Move to skill faq.md"** writes it permanently into `skills/<skill>/faq.md` (commit it to
   git), and the router rebuilds its index so that FAQ question teaches routing straight away.

**3. Caller feedback (safe)**
- Every answer shows 👍/👎 buttons. A 👎 goes to the review queue with the exact answer that
  was rated, so staff can fix it.
- When the agent's own tool call routed to a different skill than the router picked, the
  router *learns* that question for the correct skill (routing is low-risk: it only decides
  which approved content to load, never what the facts are).

Callers can **never** change what the agent knows. Only staff can, which prevents
knowledge poisoning through prompt injection.

## API endpoints

### Public (rate-limited per IP)
| Method and path | Does |
|---|---|
| `POST /api/chat` | Full JSON reply. Returns `{reply, turn_id, …}`. |
| `POST /api/chat/stream` | Server-Sent Events: `delta` (text chunks), then `done` (final text + `turn_id`), or `error`. |
| `POST /api/transcribe` | Voice (`multipart/form-data`) → `{transcript, lang}`. The browser then calls `/api/chat/stream`. |
| `POST /api/voice` | Voice → full JSON reply + optional audio. Kept for API clients. |
| `POST /api/feedback` | `{session_id, turn_id, rating: "up"\|"down", comment?}`. A 👎 goes to the review queue. |

### Admin (`X-Admin-Key: <ADMIN_API_KEY>`)
| Method and path | Does |
|---|---|
| `GET /api/admin/questions` | Review queue (unanswered + 👎 feedback). |
| `POST /api/admin/questions/{id}/draft` | AI writes a draft answer from the skills. |
| `POST /api/admin/questions/{id}/approve` | Save the answer as a knowledge entry. |
| `POST /api/admin/knowledge/{id}/export` | Move the answer into `skills/<skill>/faq.md`. |
| `GET /api/admin/feedback?rating=down` | 👎 list. |
| `GET /api/admin/routing-examples` / `DELETE /{id}` | Examples the router learned. |
| `GET /api/admin/metrics?hours=24` | p50/p95 latency, calls per answer, 👍/👎 counts, slowest turns. |

## Voice

**Speech-to-text:** `pip install -e ".[voice]"`, then set `STT_ENABLED=true`. Models load at
startup (`stt.warm_up()`), so the first voice message is as fast as the second.
- English and language detection use `STT_MODEL_EN` (default `small`; try `large-v3-turbo`
  for better accuracy if the server can handle it).
- Stock Whisper is weak at Khmer. Use a Khmer fine-tuned Whisper converted to CTranslate2:
  ```powershell
  pip install "ctranslate2" "transformers[torch]"
  ct2-transformers-converter --model <hf-khmer-whisper-model> --output_dir models/whisper-km --quantization int8 --copy_files tokenizer.json preprocessor_config.json
  ```
  Then set `STT_MODEL_KM=./models/whisper-km`.

**Text-to-speech** (`TTS_PROVIDER`):
- `browser` (default): the web page speaks each sentence as soon as it's complete. Free, but
  Khmer voice availability depends on the device.
- `mms`: self-hosted Meta MMS (`pip install -e ".[tts-mms]"`). **Licence CC-BY-NC 4.0, so
  non-commercial use only.** For a commercial school, add a provider in `voice/tts.py` for a
  licensed service such as Google Cloud TTS (`km-KH`).

## Project layout

```
src/receptionist/
  main.py         app factory, middleware, routes, startup warm-up
  config.py       settings from .env (incl. router + fast-model knobs)
  agent/          Gemini client (async + streaming), prompts, tools, memory, guardrails
  router/         server-side skill router (lexical + embeddings + IDF), knowledge matcher
  skills/         SKILL.md registry (progressive disclosure, no path access)
  knowledge/      approved Q&A entries (versioned) + search
  learning/       review queue, 👍/👎 feedback, learned routing examples
  messages/       messages for staff (human handoff)
  metrics/        per-turn timings and token counts
  chat/           public endpoints: /api/chat, /api/chat/stream, /api/transcribe, /api/feedback
  voice/          upload validation, STT (faster-whisper), TTS
  admin/          staff endpoints incl. draft, export, feedback, routing-examples, metrics
  security/       auth, rate limit, security headers, audit log, PII redaction
skills/           skill content (editable by staff); workflow.yaml for step-by-step tasks
web/              chat page + admin page (no inline JS; strict CSP)
tests/            pytest suite, organized by subpackage (Gemini is faked; no API key needed)
tests/evals/      live evaluation set + run_eval.py (accuracy + latency against the real model)
docs/             Architecture/DESIGN.md, RESEARCH.md, Plan&Progress/, Document Project/, ROADMAP.md
```

## Security measures

| Risk | Mitigation |
|---|---|
| Prompt injection (OWASP LLM01) | Caller text only in user turns. System prompt fixed. `<school_reference>` blocks from the server are tagged; the same tag in caller text is neutralised. |
| Excessive agency (LLM06) | The agent can only read skills and knowledge, save a staff message, and log a question. It cannot edit knowledge. |
| Tool abuse | `strict: true` schemas with enums for skill names and offices. Handlers validate again. Skill files are looked up by registered name only. |
| Knowledge poisoning | Only staff approve new knowledge. Entries are versioned. Learned routing examples are low-risk (routing never invents facts) and staff can delete any that look wrong. |
| Malicious uploads | Content-type allowlist, size cap, magic-byte check, duration cap, nothing written to disk. |
| Insecure output (LLM05) | The front end uses `textContent` only. The CSP blocks inline scripts. Model output is never executed. |
| Secrets | `.env` is git-ignored, keys held as `SecretStr`, `detect-secrets` in pre-commit, API errors never passed to clients. |
| Abuse / cost | Per-IP rate limits, input length caps, tool-round cap per turn, session history cap, 60 s circuit breaker after a 429. |
| Admin access | Constant-time key comparison. Admin disabled when no key is set. |
| Privacy (minors) | Minimal data collection, PII redacted in logs, the review queue and summaries. The user is told it is an AI. |
| Supply chain | `pip-audit`, `bandit`, `ruff` and pinned Hugging Face revisions. See `requirements.lock.txt`. |

## Development checks

```powershell
pytest                                  # 122 tests, Gemini is faked
ruff check src tests scripts
bandit -c pyproject.toml -r src
python -m pip_audit
pre-commit install                      # run checks on every commit
```

### Live evaluation (uses your Gemini quota)
```powershell
$env:PYTHONIOENCODING = "utf-8"
.venv\Scripts\python scripts\run_eval.py --delay 3
# Reports go to reports\ (git-ignored). PYTHONIOENCODING is needed to print Khmer on Windows.
# Raise --delay if the free tier is 429-ing.
```

## Production checklist
- [ ] Real school data in `skills/`: replace every "EXAMPLE DATA" file (`grep -rn TODO skills`).
- [ ] `ENVIRONMENT=production` (disables /docs, enables HSTS), with HTTPS through a reverse proxy.
- [ ] Strong `ADMIN_API_KEY`. Consider SSO or per-staff accounts as staff numbers grow.
- [ ] Move conversation memory and the rate-limit counter to Redis if you run more than one worker.
- [ ] Use PostgreSQL + Alembic migrations instead of SQLite `create_all`.
- [ ] Set a data-retention policy and periodically delete old messages and audit rows.
- [ ] Test with real English and Khmer voice samples, including prompt-injection attempts.
- [ ] Rotate `GEMINI_API_KEY` and `ADMIN_API_KEY` (both were in chat during development).
