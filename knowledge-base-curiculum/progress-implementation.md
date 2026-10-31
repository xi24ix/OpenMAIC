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
| 6 | Commit + push KB changes to GitHub | done | Commit `a752acc6` on `main` (toc-llm.py, serve-bundle.mjs, extract_book.py, progress docs) |
| 7 | Redeploy Coolify from git + test live | done | Deployment `slydpwjqyx2igdaahq6kjydw` finished; healthz 200; coverage 48/104/781; unit-context + 298 KB PNG asset fetch OK |
| 8 | Free local disk (move to SMB, delete local copies) | done | Removed `~/kb-run` (2.2 GB), `/tmp/kb-final`, `/tmp/kb-restore-test`, `/tmp/kb-assets`, logs — ~4.5 GB freed; durable artifacts live on SMB + git |
| 9 | A1 dedupe old-edition courses | done 2026-10-30 | `--latest-editions` bundle flag; 5 stale editions dropped; 43 semester-1 courses, zero dupes live |
| 10 | A2 term-2 sourcing | done 2026-10-30 | E-library has NO term-2 student books (verified exhaustively); 13 teacher guides downloaded + extracted; 13 semester-2 courses live with real units/lessons |
| 11 | teacher_guide primary-content fix | done 2026-10-30 | Repository retrieval treated only student_book as primary → term-2 context returned not_available; widened to teacher_guide (commit `5ae5bac7`), redeployed, live-verified |
| 12 | A9 term-2 student books (third party) | done 2026-10-31 | alktab24 Drive mirrors: 40/48 books (8 dead links); extracted + LLM TOC; 30 semester-2 courses total live |
| 13 | A10 gap-chunk coverage merge | done 2026-10-31 | `append_gap_chunks` + unit tests; 30 low-coverage books re-extracted; post-lesson-1 coverage ≥85% everywhere |
| 14 | A11 volume cleanup | done 2026-10-31 | compose `volume-cleanup` sidecar wiped corpus+corpus2 on deploy; corpus3 retires next pass; live corpus is corpus4 |
| 15 | Live + UI verification | done 2026-10-31 | kwdb coverage 73 courses/1,269 lessons; app picker API returns both terms for every grade, zero dupes; G10 math T2 units render (مصفوفات الأعداد…) |

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

### 2026-10-30 — Committed, redeployed from git, live-tested, disk cleaned

- Committed `a752acc6` "Recover real book TOCs with a vision model and ship them to
  kwdb" (5 files, +688) and pushed to `xi24ix/OpenMAIC` main.
- Redeployed Coolify app from git (deployment `slydpwjqyx2igdaahq6kjydw`, finished
  17:51 UTC; bootstrap correctly no-ops since `corpus2/complete.json` exists).
- Live tests against the redeployed container, all passing:
  - `healthz` → 200
  - `/v1/coverage` → 48 courses / 104 units / 781 lessons / 84,713 blocks / 8,094 assets
  - `/v1/catalog` → 46/48 real structures (2 known no-TOC books on fallback)
  - `/v1/unit-context` (G10 islamic-education) → real lessons "جات توحيد الربوبية" …,
    6 blocks + 9 visuals
  - `/v1/assets/...` → 200 `image/png`, 298,904 bytes
- Local disk cleanup per the standing workflow: deleted `~/kb-run` (2.2 GB),
  `/tmp/kb-final` (245 MB), `/tmp/kb-restore-test` (2.0 GB), `/tmp/kb-assets` symlinks
  and all temp logs/screenshots — ~4.5 GB freed (data volume 12→16 Gi available).
  Everything durable lives on the SMB project folder (`staging/`, `dist/` bundle) and
  in git.

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

### 2026-10-31 — Lesson generation speed: upstream study, Haiku routing, parallel prewarm

Goal: enter the classroom as fast as possible without losing lesson quality
(mix, Arabic titles, audio, design/animation). Studied upstream
THU-MAIC/OpenMAIC, tuned the model routing, verified on the sandbox.

**Findings from upstream (THU-MAIC/OpenMAIC):**
- They prefer ONE strong model per capability (their example: `openai:gpt-5.5`)
  rather than a flash model per stage, and document `fallback:` chains per
  slot (e.g. `course.outline: {model: anthropic:claude-sonnet-4-6, fallback:
  openai:gpt-5.4-mini}`) — a resilience pattern our openmaic.yml was not
  using.
- Classroom speed comes from the opt-in two-phase scene generation
  (`PARALLEL_SCENE_CONCURRENCY`, #572, clamped 0-10): content for the
  remaining scenes generates N-at-once and commits as it lands, while
  actions/narration still run in scene order. Our deployments ran it at 0
  (serial) — the single biggest entry-speed lever.
- The fork already carried the whole mechanism (engine `startContentPrewarm`).

**OpenRouter model choice** (catalog probed 2026-10-31): picked
`anthropic/claude-haiku-5.5` — $0.10/$0.50 per M tokens (a fifth of Gemini
flash pricing), 1M context, Haiku-class at HTML/JSON — for the two heavy
stages. The free `z-ai/glm-5.3-flash` stays for tiny calls (research, agent
roster) and as the fallback; deepseek flash kept for chat/actions (its empty
stream and fragment outlines made it wrong for content/outlines).

**Changes (commit `1202738f`, deployed sandbox + prod):**
- `openmaic.yml`: `course.content` and `course.outline` →
  `router:anthropic/claude-haiku-5.5` with `fallback: router:z-ai/glm-5.3-flash`;
  `llm` keeps deepseek with the same fallback; GLM keeps research/agents.
- `PARALLEL_SCENE_CONCURRENCY=3`: sandbox compose env + prod Coolify env.
- Prod resource also got `FISH_API_KEY`/`FISH_VOICE_ID` (the openmaic.yml
  speech-fish provider needs them; unset variables stop the server at boot).

**Measured on the sandbox** (Arabic water-cycle run `run-LcewA9Yf-P3mDl3D`,
PASS): outline clean in one pass (~1.5 min, no undershoot retry); first scene
committed **+156 s** after run start (classroom entry); scenes 0-4 all
committed by +212 s; heavy outro landed +402 s; run total **10.8 min** (was
15-50 min with serial GLM and its 300 s timeouts). Quality unchanged: 4
slides + quiz + interactive outro, all titles short Arabic names, 14/14
speeches with Fish audio (pinned voice), pacing ≤3 speeches/scene.

Remaining known issue: the interactive/outro widget scene is still the slowest
single generation (its GSAP HTML dwarfs a slide) — acceptable now that it
generates last while the lesson plays.
