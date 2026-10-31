# Progress Update — Kuwait Curriculum KB

Working log for the knowledge-base fix effort. Every completed task gets a dated entry with
what changed, how it was verified, and what comes next. Latest work at the top of each table.

## Task board

| # | Task | Status | Notes |
| --- | --- | --- | --- |
| 1 | Create progress-update.md task list | done | This file |
| 2 | Study `extract_book.py` pipeline + manifest formats | done | OCR cached in `staging/book-*/ocr/` → re-extraction is cheap; `assign_pages` reused |
| 3 | Identify placeholder books + locate their TOC pages | done | 44 placeholder books in staging (37 placeholder courses deployed); TOC pages detected via OCR heuristics |
| 4 | Build LLM/vision TOC extractor script | done | `scripts/toc-llm.py` (OpenAI-compatible vision call, default `google/gemini-2.5-flash` via OpenRouter) + `--toc-json` hook in `extract_book.py` (`tocSource` recorded in report.json) |
| 5 | Pilot on book-3533 (G12 biology) | done | 1 unit / 18 real lessons transcribed exactly; re-extracted: mappings 17-27, 28-39 … full 154-page coverage, 72 figures |
| 6 | Batch: LLM TOC + re-extract placeholder books | done | **43/44 fixed** (first pass 24, retries + focused passes recovered 19); only 3577 (G10 Arabic grammar) keeps page-chunks — the PDF has no contents listing |
| 7 | Validate batch results (structure + spot checks) | done | 57 books → **120 units / 846 lessons** (deployed baseline was 62/602); degenerate-title QC: 1 book (3702) reverted to fallback — its TOC pages have no OCR text |
| 8 | Re-import to fresh local DB + run test suite | done | 57/57 imported into `/tmp/kb-final`; **18/18 tests pass**; coverage 48 courses / 104 units / 781 lessons / 84,713 blocks / 8,094 asset rows |
| 9 | Bundle + deploy to Coolify + verify live catalog | done | Live at kwdb.zobeidi.com: 104 units / 781 lessons (was 62/602), 46/48 real courses, healthz 200, unit-context returns real content + visuals |

## Follow-up backlog (from the Oct 29 audit)

| # | Item | Status |
| --- | --- | --- |
| A1 | Dedupe old-edition courses (keep latest per grade/term/subject/track) | pending |
| A2 | Resolve term-2 sourcing (e-library `Term: 2` probe, then alternative sites) | pending |
| A3 | Real track (علمي/أدبي) metadata for grades 11–12 | pending |
| A4 | Exam import (632 PDFs, question-level segmentation) | pending |
| A5 | Review/verification workflow so courses can become `verified` | pending |
| A6 | Rotate leaked Supabase/DB credentials in `last-session-fix-*.json` (repo root) | pending |

## Log

### 2026-10-31 — Subagent sweep (~470 calls): 3 missing lessons + 1 duplicate found and fixed

Six parallel QA subagents each probed their assigned courses with 5 random calls
(3 unit-context + 2 lesson-context, deterministically seeded) plus an asset fetch —
~470 calls across all 73 courses against the live API with a strict error taxonomy
(http/not_available/empty_partial/mojibake/heavy_dup/asset/citation).

**Findings:** 3 lesson-context calls answered not_available although content existed
(G11 biology u1-l11, G12 english u1-l2, G10 english u4) — workbooks declare lessons
the sibling student book does not, and the context paths counted only
student_book/teacher_guide rows as primary before answering empty. One French lesson
served the same paragraph twice (duplicated text layer on the scanned page).
Everything else clean: 0 http errors, 0 mojibake, 0 heavy dups, 0 bad citations, all
sampled assets HTTP 200 image/png.

**Fixes (commit `45ff6e69`):** getLessonContext/getUnitContext promote supporting
(workbook) rows to primary — with an explicit warning — when a lesson or unit has no
primary content; extract_page dedupes exact-duplicate page segments (25+ chars).
One repository test updated to the new intended semantics (verified workbook served
instead of not_available; unverified rows stay gated).

**Deployment:** bundle v5 (2.79 GB, sha256 `be355b2a…6717`) split into 9 verified
parts (the multi-part bootstrap from the previous round), bootstrapped into
`/app/data/corpus6` — 9/9 parts, 0 failures.

**Live verification:** coverage 73 courses / 149 units / 1,108 lessons / 170,366
blocks; G11 biology u1-l11 partial (5 blocks, workbook promoted), G12 english u1-l2
partial (24 blocks), G10 english u4 partial (2 blocks), French u1-l1 13 blocks with
0 duplicates; full sweep: **149/149 units serve content — zero not_available**.

### 2026-10-31 — Content-quality audit: 4 defect classes found and fixed

Random-stratified sampling of the served unit contexts (grades × semesters × subject
types) plus a full 149-unit sweep exposed:

1. **9 courses answered not_available** — two causes: the edition dedupe had kept
   newer workbooks over older student books (workbooks were not primary kinds), and
   transcribed section-divider units had no retrievable content.
2. **Duplicate course content** — the G10 Quran course served two uploads of the same
   book (174 duplicate blocks in one response).
3. **Mojibake text** — ten books (mostly alktab downloads) had legacy-encoded Arabic
   that decoded as Latin-1 symbol soup and never triggered OCR.
4. **Arabic-Indic cover year** crashed one bootstrap.

Fixes (commit `4022dc7e`, `d30253a1`): workbook serves as primary when a course has no
student_book/teacher_guide (resolved per course in getLessonContext/getUnitContext);
the dedupe prefers the newest edition containing a student book and collapses
near-identical same-year uploads (G10 Quran → one version); extraction drops lessons
without segments/visuals and units left empty (37 books re-extracted — zero empty
lessons corpus-wide); Latin-1 symbol soup now triggers the OCR path (16 books
re-extracted — zero true mojibake); cover years normalize Arabic-Indic digits.

**Transfer fix:** the 2.79 GB single-stream bootstrap failed its checksum 6/6 through
the quick tunnel. bootstrapCorpus now supports multi-part archives
(`KB_BOOTSTRAP_PARTS` + per-part SHA-256s, three attempts per part, whole-file digest
still enforced); serve-bundle.mjs serves directories. Local e2e verified, then the
live deploy succeeded first try (9/9 parts).

**Live post-fix state:** 73 courses / 149 units / 1,108 lessons / 170,458 blocks /
12,977 assets; full sweep: 148/149 units serve content (single residual: G10 English
"Unit Four: Citizenship" — no extractable text in that scan). Re-run sampler: 0
not_available, mojibake gone, Quran dupes 174 → 24 (remaining are legitimate repeated
passages).

### 2026-10-31 — A9/A10/A11 shipped: 73 courses live, both terms in every grade

**A9 (term-2 student books via third party):** alktab24.com hosts the current
(2025/2027) term-2 editions per grade on Google Drive. `scripts/fetch-alktab-term2.py`
harvests the grade 10-12 category pages, classifies titles into the KB taxonomy
(hyphen-normalized matching), and downloads with the Drive confirmation hop.
**40/48 books downloaded** (~330 MB; 8 dead links: G10 history + English exercises,
G11 physics student, G11/G12 French ×2, G12 philosophy, G10/G11 Quran — none exist).
Extracted 40/40 (zero failures) + LLM TOC re-extraction (1 model miss: G12 IT has no
readable TOC → fallback chunks).

**A10 (gap chunks):** `extract_book.py append_gap_chunks` turns any lesson-range gap
≥2 pages into a "صفحات X-Y" lesson on the nearest preceding unit (front matter before
lesson 1 stays unmapped by design). Unit-tested (4 cases); 30 low-coverage books
re-extracted; effective post-first-lesson coverage now ≥85% everywhere except two
known no-TOC books.

**A11 (volume cleanup):** Coolify scheduled-task API 404s and the applications PATCH
500s on this version, so cleanup is a one-shot `volume-cleanup` sidecar in compose.yaml
(removes superseded corpus dirs before the service starts; never the live corpus).
This deploy wiped `corpus` + `corpus2`; `corpus3` retires on the next cleanup pass.

**Bug fixed en route:** one term-2 cover prints its year in Arabic-Indic digits —
Python `\d` accepted `202١/202٢` and the importer's schema rejected it mid-bootstrap.
`cover_year` now normalizes digits (commit `544d8576`).

**Deploy:** bundle v3 (`dist/corpus-bundle-v3.ndjson.gz`, 2.69 GB, sha256
`52a4a7ee…54baf0`, 90 books / 12,130 assets) restore-tested locally (73 courses /
160 units / 1,269 lessons / 163,399 blocks) then bootstrapped into `/app/data/corpus4`
(deploy `c1gx2zy…`). Live coverage: 73 courses, 160 units, 1,269 lessons, 163,399
blocks, 12,870 assets.

**Live verification:** catalog has grades 10/11/12 × terms [1,2], zero same-key
duplicates; G10 math term-2 serves "الوحدة الأولى: مصفوفات الأعداد" (25 blocks).
The app picker consumes `/api/curriculum/catalog` (public route), which now returns
all 73 courses — both terms appear in every grade, no duplicated books.

### 2026-10-30 — A1+A2 shipped: 43 semester-1 + 13 semester-2 courses live

**A1 (dedupe):** `bundle-corpus.py --latest-editions` keeps only the newest edition per
(grade, semester, subject, track) — excluded books 3676, 3534, 3634, 3535, 3638.
Deployed catalog has zero same-key duplicates (G11 math general/scientific is a track
split and stays).

**A2 (term 2):** downloaded the 13 G11/G12 teacher guides (`fetch-term2-teachers.py`,
~260 MB), extracted with OCR + LLM TOC passes (2 focused retries; 985/989 have no
readable TOC → honest page-chunk fallback), bundled as `dist/corpus-bundle-v2.ndjson.gz`
(2.04 GB, sha256 `8d8250c1…ca1db`, 65 books / 8,997 assets), restore-tested locally
(56 courses / 125 units / 908 lessons / 127,149 blocks), then bootstrapped to
`/app/data/corpus3` on kwdb via the tunnel+env flow. Deploy `7zd5509d9c5jyo6eadeh2xxi`.

**Retrieval fix:** term-2 unit-context answered `not_available` because the repository
hardcoded `student_book` as the only primary kind. Widened to `teacher_guide` (student
books still sort first); commit `5ae5bac7`, 18/18 tests pass, redeploy `sw06kpkbfvpjg5bbrvzva5rg`.

**Live verification (post-deploy):** 56 courses (43+13), zero dupes;
`/v1/unit-context` on G12 chemistry term-2 returns 8 real blocks
(الوحدة الرابعة: الأملاح ومعايرة الأحماض …).

**New backlog items:**
- A9: G10 term-2 + English/French/Quran/Islamic-ed term-2 have nothing official —
  third-party aggregator scraping or manual PDF sourcing, user decision.
- A10: teacher-guide lesson coverage is uneven (21–98%); a merge of LLM lessons +
  fallback chunks for unmapped ranges would lift retrieval coverage.
- A11: old `corpus`/`corpus2` dirs on the kwdb volume need cleanup (corpus3 is live).

### 2026-10-30 — A1+A2 investigation results

**A2 (term-2 sourcing):**
- Probed the MOE e-library `librarysearch` API exhaustively (response key is `books`,
  not `data`/`rows` — the first sweep read the wrong key): **zero real term-2 student
  books** across all 42 grade×subject combos and MoeYear 2023/2024/2025/2026. Only 4
  "الفهرس الالكتروني" index stubs (G11/G12 math + statistics). The official UI uses the
  same API contract, so this is authoritative.
- `BooksFor=2` (teacher section) **does** have term-2 content: 13 teacher guides
  (كتاب المعلم) for G11 (biology, statistics-literary, math, physics, chemistry,
  Arabic, IT, geology) and G12 (biology, statistics-literary, physics, chemistry,
  Arabic). Teacher guides reproduce the full student content + answers — good fit for
  self-generated lessons.
- Still missing officially: grade-10 term-2 (nothing at all), English/French/Quran/
  Islamic-education term-2 (only خطة توزيع plans). Third-party aggregator sites
  (almanahj etc.) are JS-walled; scraping them is a separate effort of uncertain
  reliability — deferred unless the user wants it.
- Built `scripts/fetch-term2-teachers.py`: downloads the 13 guides into
  `downloads/moe-term2-teachers/` and emits a compatible `inventory.json` (13/13
  downloaded, ~260 MB). `kind=teacher_guide` added to the extractors' inference
  (the contracts enum already had it).

**A1 (edition dedupe):**
- Rule: one course per (grade, semester, subject, track) — newest edition year wins,
  all books of that year merge as versions. A naive max-year-per-subject would keep a
  2026/2027 workbook over an older student book, so the rule keys on the year groups
  as imported.
- Excluded books: 3676 (G11 English 2009/2010), 3534 (G12 biology 2024/2025),
  3634 (G12 math 2025/2026), 3535 (G12 physics 2022/2023), 3638 (G12 statistics
  2014/2015). G11 math general+scientific is a track split, not an edition dupe —
  kept.
- `bundle-corpus.py --latest-editions` implements the rule at bundle time (52 of 57
  books bundled; semester-1 courses drop 48 → 43).

### 2026-10-30 — Batch complete: 43/44 placeholder books fixed, fresh import in progress

**Batch run (3 parallel shards, Gemini 2.5 Flash via OpenRouter):**
- First pass: 24/43 ok, 19 failed — `413 Payload Too Large` (PNG payloads) dominated.
- Fixes: JPEG rendering at 130dpi (payload ~4 MB), `raw_decode` JSON parsing, retry
  ladder (2× Gemini → 1× `z-ai/glm-4.5v` fallback with a "transcribe every row" hint).
- Retry round + focused `--pages` passes (English p10, statistics workbook p10, biology
  workbook p8) recovered all but one book.
- Unicode gotcha: macOS stores NFD filenames, inventory records NFC → added glob
  fallback for source PDFs (`*book-<id>.pdf`).
- Notable wins: G12 Islamic Education 1 unit/82 lessons; G11/G12 Quran 28-29 lessons
  (was 9 lessons at 4-5% page coverage); G12 chemistry 5 units; G11 French 5 units.
- Degenerate-output QC flagged only book-3702 (G11 geography): its TOC pages produced
  almost no OCR text, model hallucinated "مقدمة" rows → reverted to fallback chunks.
- book-3556 (G10 IT) has no readable TOC anywhere in the PDF → stays on chunks
  (follow-up A7: source a better G10 IT book or hand-build its TOC).

**Final corpus state:** 57 books → 120 units / 846 lessons; `tocSource`: 40 llm,
13 parsed, 4 fallback (2 genuine no-TOC books + 2 old regex fallbacks untouched).

**Infra note:** `knowledge-base-curiculum/node_modules` on the SMB share has pnpm
symlinks stored as text files (share quirk) — tsx/tsc crashes. The service now builds
and runs from a local-disk copy at `~/kb-run` (rsync without node_modules, fresh
`pnpm install`, `tsc -p tsconfig.json`), pointing at the SMB staging paths for data.
Node 24.18 via nvm (root `.nvmrc` says 22 but nvm only has 20.18/24.18; 24 ≥ 22.19 OK).

### 2026-10-30 — Deployment to production (kwdb.zobeidi.com)

**Bundle:** `dist/corpus-bundle.ndjson.gz` — 1,758,838,013 bytes, 57 books, 7,527 unique
assets, sha256 `e7a2b970994f2b0dfbfacd77da5172468cd1cfe1b0a380a99893c8d60385acb6`.
Local restore test from the exact bundle bytes passed (coverage identical to the direct
import: 48 courses / 104 units / 781 lessons / 84,713 blocks / 8,094 asset rows).

**Mechanism (production data refresh):**
- `scripts/serve-bundle.mjs` serves the bundle behind a one-time Bearer token on
  127.0.0.1:8787; `cloudflared tunnel --url http://127.0.0.1:8787` exposes it over HTTPS
  (quick tunnel `percentage-deleted-cabinets-hosts.trycloudflare.com`).
- Coolify envs added on app `lcgipmxidt1feeqzzklkvg7y`: `KB_BOOTSTRAP_URL/TOKEN/SHA256`
  + `KB_BOOTSTRAP_ROOT=/app/data/corpus2`, and data paths moved to
  `KB_DATA_DIR=/app/data/corpus2/db`, `KB_ASSET_ROOT=/app/data/corpus2`.
  The container bootstraps the bundle into the fresh `corpus2` directory on boot —
  no volume wipe needed (Coolify 4.5 PATCH/start-command endpoints returned 500, and
  in-place `kb import` would leave stale placeholder lesson rows since units/lessons
  are upserted but never deleted).
- Old `corpus` dir stays on the volume as dead weight until cleaned (follow-up A8).

**Checks:** tunnel HEAD 200; `/sha256` endpoint digest == bundle manifest digest;
local `restoreBundle()` on the same file passes; deploy queued
(`zeqkoss2rratkuqvdz7ak02o`), container streamed the full bundle (~25 min), restored
57/57 books, and completed.

**Deploy result (verified live 2026-10-30 ~21:00):**
- `healthz` → 200; logs: "Corpus bootstrap complete … Curriculum service listening".
- `/v1/coverage`: 48 courses / **104 units / 781 lessons** (deployed baseline was
  62/602) / 84,713 content blocks / 8,094 asset rows / 57 active versions.
- `/v1/catalog`: 46/48 courses with real structure; placeholders remain only for
  G10 arabic-grammar (3577) and G11 geography-economics (3702) — both source PDFs
  have no readable contents listing.
- `/v1/unit-context` on a formerly placeholder course (G10 islamic-education) returns
  real lesson names, Arabic text blocks, and 9 textbook visuals.
- Bootstrap envs (`KB_BOOTSTRAP_*`) intentionally left on the app — bootstrap is a
  no-op while `complete.json` exists; for a future refresh, re-serve a new bundle and
  update the URL/SHA256 envs.

### 2026-10-30 — LLM TOC extraction built + piloted

**Built:**
- `scripts/toc-llm.py` — for each staging book whose `report.json` shows the page-chunk
  fallback: finds candidate TOC pages from cached OCR (whole-book scan, ranked by
  lesson-code density + header keywords, ≤18 images/request), renders them, asks a vision
  model for `{"units":[{"title","lessons":[{"title","printedPage"}]}]}`, validates
  (page range, dedupe, ≥2 lessons), writes `staging/book-*/toc-llm.json`. `--reextract`
  then re-runs `extract_book.py --toc-json` per book. Resumable: books with existing
  `toc-llm.json` are skipped unless `--force`.
- `extract_book.py` — new `--toc-json` flag: builds units/lessons from the transcribed
  TOC, runs the existing `assign_pages` (printed→PDF offset via footer pairs + title
  search). `report.json` now records `tocSource: llm | parsed | fallback`.

**Pilot (book-3533, grade-12 biology 2024/2025):**
- Vision model transcribed the printed TOC exactly (1 unit "أجهزة جسم الإنسان",
  18 rows incl. chapter rows, printed pages 13–126).
- Book genuinely contains only unit 1 (MOE split the year) — 1 unit is correct here.
- First re-extraction exposed a real bug: noisy candidate pages fed to `assign_pages`
  as `tocPages` truncated lesson ends (toc_set used as hard boundary). Fixed: only
  strongly TOC-looking pages (code rows + header) become `tocPages`; candidates kept
  as `candidatePages` provenance.
- After fix: contiguous ranges (17-27, 28-39, 40-46, … 129-154), 154/154 pages
  covered, 72 figures attached to lessons, 7 benign warnings.

**Checks:** `py_compile` both scripts; mapping monotonicity + coverage asserted in the
pilot validation snippet; toc-llm.json cross-checked against rendered TOC page images
(pages 12–15 read visually and matched).

### 2026-10-29 — Audit findings (baseline)

Audited the deployed KB (kwdb.zobeidi.com) against on-disk corpus and app integration.

**Verified facts:**
- Deployed DB: 48 courses, 62 units, 602 lessons, 58 resource versions, 104,656 content blocks,
  8,597 assets — all 57 real source books imported (staging 57/57, none stale, none missing).
- UI picker is fully catalog-driven (`lib/server/curriculum-kb.ts` → KB `/v1/catalog`), so DB gaps = UI gaps.
- Retrieval works end-to-end: `/v1/unit-context` returns real Arabic text + visuals for both
  real-TOC and placeholder courses.

**Problems found:**
1. Semester 2 absent everywhere — the MOE e-library yielded only 4 term-2 files, all
   "الفهرس الالكتروني" index stubs. Source gap, not an import bug.
2. 37/48 courses have placeholder structure: single unit "محتوى الكتاب" with lessons
   "صفحات 1-10 / 11-20 …" because the regex TOC parser failed on 44/57 books.
   Content blocks are real; only unit/lesson labels are fake.
3. 6 duplicate courses from old editions (e.g. G12 biology 2024/2025 vs 2026/2027).
4. Track metadata stubbed (everything defaults `general` except hard-coded book 3627).
5. 0 verified versions (by design; app always sends `allowUnverified: true`).
6. 632 exam PDFs not imported (deliberate, deferred).
7. Repo root `last-session-fix-zobeidi-lesson-generation-providers.json` leaks live
   Supabase keys + DB password — rotate and redact.

**Checks performed:** catalog diff vs inventory (`downloads/moe-highschool/inventory.json`),
staging cross-check, live `/v1/catalog` + `/v1/coverage` + `/v1/unit-context` probes against
the token in Coolify env `KB_API_TOKEN`.
