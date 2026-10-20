# PRODUCT.md — Alostad الأستاذ

## What this is

Alostad (الأستاذ) is an Arabic-first AI interactive classroom: an owner-operated
deployment of the OpenMAIC engine, rebranded and localized for Arabic-speaking
educators and learners. A teacher uploads materials or describes a lesson; the
platform generates immersive multi-agent courses — slide classrooms, PBL
projects, quizzes, narration/video export.

## Audience & language

- Primary readers are Arabic speakers. **Arabic (`ar-SA`) is the product
  default** — SSR renders `lang="ar"`, the first paint is Arabic, and the root
  font size is larger under `html:lang(ar)`.
- **English (`en-US`) is the single alternative**, chosen from the language
  icon in the top-right pill (home) or the workspace rail utilities. No other
  languages ship; the i18n registry (`lib/i18n/locales.ts`) is the source of
  truth and `i18next`'s `supportedLngs` derives from it.
- Layout stays **left-to-right** in both languages (explicit product decision —
  RTL is out of scope until requested).

## Access & ownership

- The public deployment is **not gated**: `ACCESS_CODE` is unset, so visitors
  reach the app and the API directly. `/api/health` reports
  `accessCodeConfigured: false`; setting `ACCESS_CODE` again restores the
  branded gate and route protection without a code change.
- Single-owner mode (`OWNER_SINGLE_USER=true`); PostgreSQL persistence
  (`openmaic-db`). Provider credentials live in the database workspace
  settings and are managed by the server, so visitors never supply keys.

## Course materials & skills

- PDFs use a two-phase upload: the browser posts with `?extract=false`, shows
  page thumbnails, and starts extraction only after the user confirms a page
  selection. `GET /api/materials/<id>/pages` reports the page count and renders
  thumbnails; `POST /api/materials/<id>/extraction` accepts `{ pages }` or
  `"all"`, validates the selection, slices the PDF, and stores `selectedPages`
  plus `sourcePageCount` on the extraction.
- The composer's **Skill** picker (`GET /api/generation/skills`) lists the
  twelve built-in classroom-design skills and attaches up to five `skillIds` to
  a generation run. The outline step resolves them server-side; the skill bodies
  never reach the browser.

## Brand commitments

- Name: **Alostad الأستاذ** (never "OpenMAIC" in user-visible chrome, titles,
  exports, or footer). Internal protocol identifiers (`X-OpenMAIC-*` headers,
  package names) stay as-is.
- Logo: navy reader mark with a coral play button; wordmark reads `أستاذ` under
  Arabic and `Alostad` under English.
- See `DESIGN.md` for the visual system.

## Constraints

- Disk pressure is real: the workspace volume runs near full, so remove
  `.next` before a rebuild. Local `node_modules` is installed and the pnpm
  workspace links must stay in place; if `@openmaic/generation`, `importer`, or
  `storage` reports missing exports, restore the links under
  `node_modules/@openmaic/`.
- Local PostgreSQL and Docker are unavailable. Verify changes by committing,
  pushing `origin/main`, deploying with Coolify, and inspecting the live site
  with Playwright. Builds on this exFAT volume need Turbopack's filesystem
  build cache disabled (`experimental.turbopackFileSystemCacheForBuild`).
- The upstream OpenMAIC translation files for ten retired languages remain on
  disk because several tests import them directly; they are unreachable at
  runtime.

## Success looks like

1. A first-time visitor lands on Arabic, with a modern Arabic typeface and the
   Alostad lockup — and no "Persistence is unavailable" toast.
2. Toggling the language icon switches the whole product to English and back,
   persisted across reloads.
3. Nothing in the visible product still says OpenMAIC.
4. A PDF attachment shows its pages as thumbnails, and only the pages the user
   confirms are extracted and sent to generation.
5. The Skill picker lists the twelve classroom-design skills, and a selected
   skill reaches the outline; removing it stops influencing the run.
