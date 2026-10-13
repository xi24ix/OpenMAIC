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

- The site is gated by `ACCESS_CODE` (env on the Coolify app `openmaic`);
  `AccessCodeGuard` shows the gate before any app chrome. The gate itself is
  branded Alostad and localizes with the same i18n system.
- Single-owner mode (`OWNER_SINGLE_USER=true`); PostgreSQL persistence
  (`openmaic-db`).

## Brand commitments

- Name: **Alostad الأستاذ** (never "OpenMAIC" in user-visible chrome, titles,
  exports, or footer). Internal protocol identifiers (`X-OpenMAIC-*` headers,
  package names) stay as-is.
- Logo: navy reader mark with a coral play button; wordmark reads `أستاذ` under
  Arabic and `Alostad` under English.
- See `DESIGN.md` for the visual system.

## Constraints

- No local `node_modules` on this machine (disk pressure): verification happens
  by committing, pushing `origin/main`, letting Coolify deploy, and inspecting
  the live site with Playwright. Unit tests that pin locale/brand values were
  updated in the same change.
- The upstream OpenMAIC translation files for ten retired languages remain on
  disk because several tests import them directly; they are unreachable at
  runtime.

## Success looks like

1. A first-time visitor lands on Arabic, with a modern Arabic typeface and the
   Alostad lockup — and no "Persistence is unavailable" toast.
2. Toggling the language icon switches the whole product to English and back,
   persisted across reloads.
3. Nothing in the visible product still says OpenMAIC.
