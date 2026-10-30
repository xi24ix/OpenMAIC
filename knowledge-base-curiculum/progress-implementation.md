# Implementation Progress — Kuwait Curriculum KB

Task tracker for the KB implementation effort. The detailed narrative log with per-task
checks lives in [progress-update.md](progress-update.md); this file is the live board.
Newest entries first.

## Current board

| # | Task | Status | Result / notes |
| --- | --- | --- | --- |
| 1 | Audit KB vs corpus vs UI | done 2026-10-29 | 57/57 books imported; 37/48 courses had placeholder TOC; term-2 absent at source |
| 2 | Build LLM TOC extractor (`scripts/toc-llm.py` + `--toc-json`) | done 2026-10-30 | Gemini 2.5 Flash via OpenRouter, GLM-4.5V fallback; validated on pilot book-3533 |
| 3 | Batch fix 44 placeholder books | done 2026-10-30 | **43/44 fixed** → 120 units / 846 lessons; 2 books (3577, 3702) legitimately on fallback (no readable TOC in PDF) |
| 4 | Fresh local import + tests | done 2026-10-30 | 57/57 imported, **18/18 tests pass**, 46/48 courses with real structure |
| 5 | Bundle + deploy to production | done 2026-10-30 | Bootstrap via `corpus2` + tunnel; live: 104 units / 781 lessons, healthz 200 |
| 6 | Commit + push KB changes to GitHub | **in-progress** | toc-llm.py, serve-bundle.mjs, extract_book.py, progress docs |
| 7 | Redeploy Coolify from git + test live | pending | Build is data-identical; deploy confirms the committed code serves correctly |
| 8 | Free local disk (move to SMB, delete local copies) | pending | Remove `~/kb-run`, `/tmp/kb-final`, `/tmp/kb-restore-test`, `/tmp/kb-assets`, temp logs |

## Backlog (user-approved, from the Oct 29 audit)

| # | Item | Status |
| --- | --- | --- |
| A1 | Dedupe old-edition courses (keep latest per grade/term/subject/track) | pending — 6 dup courses still in picker |
| A2 | Term-2 sourcing (e-library has none; try alternative sites in `curiculum-sources.md`) | pending |
| A3 | Real علمي/أدبي track metadata for grades 11–12 | pending |
| A4 | Exam import (632 PDFs, question-level segmentation) | pending |
| A5 | Review/verification workflow (currently 0 verified; app always `allowUnverified: true`) | pending |
| A6 | Rotate leaked Supabase/DB credentials in root `last-session-fix-*.json` + redact file | pending |
| A7 | G10 IT book (3556) has no TOC — source better PDF or hand-build TOC | pending |
| A8 | Clean old `/app/data/corpus` dir off the Coolify volume | pending |

## Standing workflow (user instruction, 2026-10-30)

After any local testing: move/copy needed artifacts into the project folder on the SMB
share, commit + push to GitHub, then delete local copies (`~/kb-run`, `/tmp/*` test
databases/assets/bundles/logs) to free the local disk.

## Log

### 2026-10-30 — Production deployed, commit pending

- Bundle `dist/corpus-bundle.ndjson.gz` (1.76 GB, sha256 `e7a2b970…85acb6`, 57 books,
  7,527 assets) built from staging and restore-tested locally byte-for-byte.
- Deployed to Coolify app `lcgipmxidt1feeqzzklkvg7y` via bootstrap envs
  (`KB_BOOTSTRAP_URL/TOKEN/SHA256/ROOT=/app/data/corpus2`); container streamed the
  bundle over a cloudflared quick tunnel, restored 57/57 books, completed.
- Verified live: `healthz` 200; `/v1/coverage` 48 courses / 104 units / 781 lessons /
  84,713 blocks / 8,094 assets; `/v1/catalog` 46/48 real structures;
  `/v1/unit-context` on formerly placeholder courses returns real Arabic text + visuals.
- Next: commit code + docs to GitHub, redeploy from git, re-test live, clean local disk.
