# B+ (Blackboard Plus)

A Chrome (Manifest V3) extension that layers a study assistant on top of a
student's real **Blackboard Ultra** site. It discovers the student's current
courses from Blackboard's own network traffic, retrieves each course's files,
builds a searchable per-course library, and answers questions **grounded in that
course's materials** with clickable citations back to the source file on
Blackboard — falling back to clearly-labelled general knowledge when the
materials don't cover a question. The in-course assistant is **AI Lookup Chat**.

The student configures nothing: install B+, open Blackboard, and the sidebar
prepares every current course automatically.

> **Naming.** The product is **B+**; the assistant is **AI Lookup Chat**. Older
> names — "Bb+", "BB Plus", "Course Copilot", "Study Hub" — are retired from
> user-facing text but **survive as internal code identifiers** (`courseCopilotFetch`,
> `COURSE_COPILOT_ORIGIN`, `BBX_CP_*` messages, `/api/integrations/bbplus/…`
> routes, the `bbplus` source type). Those are wire/contract names — leave them.

---

## Current shape: two halves

- **The extension** (`extension/`) — the UI the student sees, plus all Blackboard
  scraping and the auto-setup lifecycle. Runs in the browser.
- **The backend** (`api/`) — a local FastAPI server at **`http://127.0.0.1:8471`**
  that does the heavy lifting: file extraction (PyMuPDF + optional OCR), chunking,
  embeddings, hybrid retrieval, and LLM answer synthesis. It also serves a
  legacy standalone web app (`web/`) with the same features in a browser tab.

The contract between the two halves is the `BBX_CP_*` messages
(extension → background → backend) and the `/api/integrations/bbplus/…` HTTP
routes, documented in [docs/BBPLUS_INTEGRATION.md](docs/BBPLUS_INTEGRATION.md).

## Where it's going — the north star

**The website (`127.0.0.1:8471`) side is being deprecated.** The plan is to make
the backend's functions native to the sidebar, so the whole product becomes the
extension plus, at most, a small local helper it manages — no separate web app to
open, ideally no separate server to babysit. When adding or changing a feature,
prefer designs that make this migration easier: keep the extension↔backend
contract narrow and explicit, avoid deepening the web app, and treat `web/` as
legacy. Until then, both halves coexist.

## Run & develop

```bash
make venv                 # create .venv and install requirements
cp .env.example .env       # optional; all provider keys are optional
make serve                 # backend at 127.0.0.1:8471 (uvicorn --reload)
```

Open [http://127.0.0.1:8471](http://127.0.0.1:8471) for the legacy web app. The
server is meant to stay on this machine; it runs fully offline with a
deterministic grounded fallback when no keys are set.

**Load the extension in Chrome:**

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select
   this repo's `extension/` directory.
2. Open Blackboard over HTTPS; use the B+ popup to enable it for that site and to
   connect the local backend (access is limited to `http://127.0.0.1:8471/*`).
3. The sidebar discovers and prepares your courses automatically — no manual
   mapping or sync. Wait for "Ready to go" before asking questions.

> **Reload after content-script changes.** After editing `content.js`, `lib/*`,
> `vendor/*`, or `styles.css`, reload the unpacked extension — dynamically
> registered content scripts pin their file list at registration time, so a new
> file only loads after a reload/`onInstalled`.

Developer diagnostics (Debug toggle, Build/Verify library, raw-JSON tabs) are
hidden unless the page URL carries **`?bbxdev=1`** (nothing persisted).

**Evaluation** (benchmark harness — see [docs/EVAL.md](docs/EVAL.md)):

```bash
make benchmark    # build the labelled benchmark corpus
make eval         # full suite, writes eval/RESULTS.md
make eval-fast    # retrieval + refusal only (~seconds)
make calibrate    # sweep the refusal threshold
```

> **No unit-test suite is checked in.** The `tests/` directory (and the
> `make test` target) were removed as production bloat. The eval harness under
> `eval/` remains and is what guards the grounding/refusal guarantees. Syntax
> checks: `node --check extension/content.js` (and the other JS files),
> `python3 -m json.tool extension/manifest.json`.

## Repository map

```
api/                FastAPI backend (intended to fold into the extension over time)
  main.py           All HTTP endpoints; app wiring; ingest job runner
  agent/            Answer generation (benchmark path + product path, explanations, tools)
  retrieval/        Hybrid retrieval: dense + sparse → RRF → rerank → refusal gate
  corpus/           extract → chunk → embed → store (ingest_files)
  embed/            Embedding backends (BGE default, TF-IDF for offline, OpenAI optional)
  store/            SQLiteStore (pgvector-shaped) + schema.sql
  integrations/     bbplus adapter (serialize_document, safe_material_filename)
  llm.py, gemini.py LLM wrappers + provider resolution
  syllabus/, practice/, dashboard/, voice/, calendar_view.py, grade_predictor.py, data/
                    feature areas (schedule, practice, readiness, voice, grades, FRED tools)
ingest/             extract.py (PDF/DOCX/markdown), chunk.py, ocr.py
extension/          The Chrome MV3 extension (the future home of everything)
  content.js        The big file: sidebar UI, Blackboard scraping, auto-prep, rendering
  background.js     Service worker: message router, backend fetch, staging
  offscreen.js      Offscreen doc: pdf.js/mammoth/pptx parsing to IR blocks
  bridge.js         MAIN-world hook forwarding Blackboard's JSON to content.js
  lib/, vendor/     helpers (stage/work/db/ir/panel/audit) + pdf.js/mammoth/jszip/katex
web/                Legacy standalone web app (being retired)
eval/               Benchmark harness (grounding, refusal, retrieval ablations)
data/               SQLite DB, uploads/, caches (generated at runtime; gitignored)
docs/               Integration contract + eval notes
```

## Retrieval & answering (overview)

There are **two answer paths**, kept deliberately separate:

- **Benchmark path** (`Agent.ask` / `ask_async`) — strictly grounded: answers only
  from the corpus, else refuses with `NOT_IN_MATERIALS`. The eval harness measures
  this; **do not add fallbacks or anything that moves its numbers.**
- **Product path** (`Agent.answer_product`, used by the sidebar and web) — the good
  UX: overview synthesis, an LLM file router over the whole catalogue, single clean
  synthesis with `[n]` citations, and gap-free citation renumbering.

The pipeline (`retrieval/pipeline.py`): dense (BGE) + sparse (BM25) →
reciprocal-rank fusion → cross-encoder rerank → calibrated refusal gate + intent
gate. The product path widens `top_k` for a source-diverse pool; **tune the
product side, never the pipeline defaults**, or the benchmark moves. Deeper
internals live in [CODEBASE_GUIDE.md](CODEBASE_GUIDE.md).

## Data isolation & safety

- **Multi-tenancy is sacred.** Every store read/write is scoped by server-derived
  `user_id`; clients never choose it. A past bug collapsed the benchmark corpus
  when a delete matched by `source_id` across users — every destructive query is
  now user- and course-scoped, and the `benchmark` user is unreachable from
  product endpoints.
- The API has no login; it binds requests to `default_user_id` (`local-user`).
  **Keep it on loopback.** CORS is limited to the local app and extension origins.
- The extension uses the Blackboard tab's existing session; it never receives
  Blackboard cookies or provider API keys. Course text is sent only to the local
  backend. Provider choice follows `resolve_product_llm` (own key → local Ollama →
  server key → consented free-tier Gemini → extractive stub); free-tier Gemini is
  used **only** with explicit consent.
- Never commit `.env`, uploaded materials, SQLite databases, embedding caches, or
  generated benchmark text.

## Configuration & providers

Copy `.env.example` to `.env`. All keys are optional:

- `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` — generated grounded answers & explanations.
- `OPENAI_API_KEY` — OpenAI embeddings when configured; otherwise the local embedder.
- `FRED_API_KEY` — real economic-series data; without it, data is synthetic and labelled.
- `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` — optional voice features.
- `COPILOT_OFFLINE=1` — force offline deterministic providers.

## Constraints for contributors

- **UI/UX freeze** ([AGENTS.md](AGENTS.md)): don't change the app's visual design,
  layout, or interaction patterns unless explicitly asked.
- **Never move the benchmark numbers** (see the two answer paths above).
- **Don't rename** `bbplus` / `BBX_CP` / `courseCopilot*` internal identifiers.
- **Don't use port 8471 for scratch servers** — it's the dev server.
- OCR needs a `tesseract` binary; the PyMuPDF text path works everywhere without it.

## Further reading

- [CODEBASE_GUIDE.md](CODEBASE_GUIDE.md) — the full internals guide (auto-setup
  lifecycle, ingestion, both answer paths, rendering, performance, gotchas).
- [docs/BBPLUS_INTEGRATION.md](docs/BBPLUS_INTEGRATION.md) — the extension↔backend
  API contract (routes, request/response shapes).
- [docs/EVAL.md](docs/EVAL.md) — how the benchmark harness is built and what its
  numbers are (and aren't) worth. Current numbers: [eval/RESULTS.md](eval/RESULTS.md).
- [extension/README.md](extension/README.md) — the Blackboard Ultra data model B+
  reverse-engineered (content handlers, routes, filtering).
- [extension/vendor/README.md](extension/vendor/README.md) — vendored parser
  libraries and the pdf.js version pin.
