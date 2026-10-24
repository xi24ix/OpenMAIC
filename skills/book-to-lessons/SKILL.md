---
name: book-to-lessons
description: Turn a textbook (PDF) into OpenMAIC lessons and push them to a live OpenMAIC instance. Use when the user wants to chunk a book per unit/lesson, author bilingual lesson scenes (Arabic explanations + English target-language content), build a full stage document, or publish authored lessons to the app through its REST API. Covers extraction with pdftotext, per-unit chunking, generation briefs, scene authoring (interactive HTML + quiz), local validation, and the push protocol.
---

# Book to lessons

The pipeline turns one book unit into one classroom (a `stage` document on a
live OpenMAIC instance). The authoring agent plays the role the in-app
generation pipeline normally plays: it reads the book, writes the scenes, and
persists the document over the same REST surface the app itself uses.

One unit = one lesson = one stage. A unit's internal sections (Opener, Reading,
Grammar, Listening, Speaking, Writing) become scenes inside that stage.

## Pipeline

```text
books/*.pdf
  → extract      pdftotext -layout                     (raw text, per page)
  → chunk        units/<unit>/source.md                (book text + workbook, page-marked)
  → brief        units/<unit>/brief.md                 (the instruction: scene plan, sources, language rules)
  → author       units/<unit>/scenes/*.html | *.json   (interactive HTML and quiz content)
  → build        build-lesson.mjs → lesson.json        ({stage, scenes, outline} + preview/*.html)
  → validate     push-lesson.mjs validate lesson.json  (structural gate, no network)
  → push         push-lesson.mjs push lesson.json      (verify code → create → PUT)
```

## Extraction

- `pdftotext -layout <book.pdf> <out>.txt` keeps reading order; `\f` separates PDF pages.
- Split into `extracted/pages/<book>/pNNN.txt` (one file per PDF page), keep the
  full-text dump too. Locate unit boundaries by scanning per-page first lines.
- Arabic-named PDFs on exFAT: quote filenames; ignore/delete `._*` AppleDouble files.
- The workbook (exercises) for a unit is chunked together with the student book —
  the workbook supplies quizzes and practice; the student book supplies readings,
  grammar, and tasks.

## Chunking

Build `units/<unit>/source.md` with `### [book pNNN]` markers so every later
claim can be traced to a page. Include both books. Do not paraphrase in the
chunk — it is the raw source of truth.

## The brief (the generation instruction)

`units/<unit>/brief.md` is the instruction that would regenerate the lesson
without this conversation. It must contain:

- the unit's title, level, audience (e.g. Grade 10, Arabic-speaking, Kuwait),
- language policy (see below),
- the full scene plan: one line per scene with scene number, type
  (`interactive` | `quiz`), purpose, and its exact source pages,
- the quiz map: which book/workbook exercises become which quiz scene, with
  answers resolved,
- the design system reference (`scenes/base.css` conventions),
- anything deliberately left out (e.g. audio-dependent listening items).

## Language policy (the default for this project)

- **Arabic is the explanation language; English is the content language.**
  Instructions, grammar explanations, feedback, and navigation copy are Arabic
  (RTL). Passages, example sentences, vocabulary items, and exercises stay in
  English (LTR).
- Vocabulary cards show the English word + Arabic meaning + an English example.
- Quiz `analysis` is written in Arabic; options stay in English.
- Never machine-translate the book's reading passages; quote them as published.

## Scene authoring rules

- `interactive` scenes render `content.html` in a sandboxed iframe
  (`allow-scripts allow-forms allow-popups`). HTML must be a complete document
  and fully self-contained: inline CSS and JS only, no external fonts,
  scripts, images, or network calls. System font stack only.
- `quiz` scenes carry `content.questions`; every question needs `id`, `type`
  (`single` | `multiple` | `short_answer`), `question`, `options`
  (`{label, value}` with `value` strings like A/B/C/D), `answer` (array of
  option values), `analysis` (Arabic), and `points`.
- Prefer one mechanism per interactive scene; a scene that only shows text the
  learner could read on a slide is a wasted page. Interaction should reveal or
  check something.
- Scene titles are learner-facing Arabic (optionally bilingual), e.g.
  `"الوحدة 1 · التدريب على القراءة"`. Scene `order` is 1-based and sequential.
- No emojis in authored content; use styled shapes/letters instead.
- Keep each scene HTML under ~30 KB so `srcDoc` stays light.

## Build and validate

- `build-lesson.mjs` reads `scenes/scene-manifest.json`, inlines `base.css` /
  `base.js` into each fragment, and writes `lesson.json` plus `preview/*.html`.
- Always run `push-lesson.mjs validate lesson.json` before pushing; it mirrors
  the server's write barrier. The server re-validates on PUT and answers 400
  with a reason on failure — read the reason instead of guessing.

## Push

Read `references/push-protocol.md` before the first push. Summary:

1. `POST /api/access-code/verify {code}` → `openmaic_access` cookie.
2. `POST /api/stages {name, description?}` → `{stage:{id,...}}` (server mints the id).
3. Rewrite the document: `stage.id` = minted id, every `scene.stageId` = minted id,
   bump timestamps, `outline.generationComplete = true`.
4. `PUT /api/stages/{id}` with `{stage, scenes, outline}` — the whole document.

With `OWNER_SINGLE_USER=true` every request resolves to the same owner, so a
pushed lesson lands in the same library the operator's browser sees.

## Hard rules

- Read the source pages before writing a scene; quote book passages verbatim.
- Resolve every quiz answer yourself from the book/workbook; never ship an
  unanswered `hasAnswer` question that claims to auto-grade.
- One lesson per unit unless the user asks for finer granularity; finer
  granularity splits the unit's section sequence across stages.
- Document each completed unit in `book-lessons/README.md` (progress log).
- Never print, commit, or echo the access code; read it from the environment or
  pass it as a CLI flag.
