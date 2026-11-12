# Bug report

Review date: 2026-11-12

The review covered the lesson-generation runner, step retry wrappers, outline streaming, owner authentication on model-generation routes, and the Supabase profile migration/RLS policies. The observed Coolify state and shared provider credentials are recorded after the bug list; they are operational findings, not code defects.

## B1 — Later scene failures get six attempts [FIXED]

- **File:** `lib/server/generation/run/retry.ts:24`
- **Severity:** high
- **What is wrong:** `SCENE_MAX_RETRIES` is 5, which means six total attempts for each later scene. With a retryable provider error or a 5-minute scene deadline, one failed scene can keep issuing paid requests for up to roughly 30 minutes before the run pauses.
- **Trigger:** In a run with more than one scene, make a later scene's content or actions call repeatedly return a retryable status (such as 429/5xx) or time out. `engine.ts` passes this value to `withRouteRetry`, which retried the scene step five times after the first attempt.
- **Fix:** Reduced later-scene retries to two, for three total attempts.

## B2 — Shared generation retry helper defaults to six attempts [FIXED]

- **File:** `packages/@openmaic/generation/src/generation-retry.ts:21`
- **Severity:** high
- **What is wrong:** Callers that do not provide an explicit retry count receive five retries, or six total requests. The narration TTS path uses this helper for failed/empty responses, so a single narration failure can make repeated billable provider calls beyond the requested 2–3 chances.
- **Trigger:** A `/api/generate/tts` request returns a retryable response or an unsuccessful/empty result, and the caller uses `withGenerationRetry` without overriding `maxRetries`.
- **Fix:** Reduced the helper's default retry count to two, for three total attempts.

## B3 — Outline retries multiply with the AI SDK's hidden retries [FIXED]

- **File:** `lib/server/generation/steps/outline.ts:721-724`
- **Severity:** high
- **What is wrong:** Outline generation retries stream failures in its own loop (`MAX_STREAM_RETRIES = 2`), while each `streamLLM` call leaves the AI SDK's `maxRetries` at its default of 2. One outline failure can therefore send up to nine primary-model requests before the step's fallback decision.
- **Trigger:** A retryable transport/provider failure occurs during the outline stream. `streamLLM` forwards the default SDK retry budget, then `streamOutlines` retries the failed stream itself.
- **Fix:** Disabled SDK-level retries for outline streams and reduced explicit same-model retries to one. The step now permits two primary requests and one fallback request.

## B4 — Every curriculum deployment deletes the live database [FIXED]

- **File:** `knowledge-base-curiculum/compose.yaml:9`
- **Severity:** critical
- **What is wrong:** The one-shot `volume-cleanup` container deletes `corpus5`, while Coolify configures `KB_BOOTSTRAP_ROOT=/app/data/corpus5` and stores the live PGlite database and assets there. Each database deployment therefore erases the active corpus and depends on a separate multi-gigabyte bootstrap download to recover it.
- **Trigger:** Deploy the `kuwait-curriculum-kb` Coolify application. Its cleanup service removes `corpus5` from the persistent volume before the API starts; if the configured bootstrap host is unreachable, the service remains unavailable with HTTP 503.
- **Fix:** Removed the live `corpus5` directory from the cleanup command. The existing Coolify volume still needs restoration from the configured corpus bundle after this deployment incident.

## B5 — Curriculum requests can leave the picker loading forever [FIXED]

- **File:** `lib/server/curriculum-kb.ts:139`
- **Severity:** medium
- **What is wrong:** Catalog, unit-context, and visual requests to the curriculum service had no network deadline. If the KB stops responding during startup or a network stall, the API route remains pending and the picker stays on its loading spinner instead of showing an error.
- **Trigger:** Open the curriculum picker while the KB host accepts a request but does not complete its response; `/api/curriculum/catalog` awaits the fetch indefinitely.
- **Fix:** Added 15-second per-request timeouts and a 45-second total deadline for paginated unit-context retrieval.

## B6 — Coolify test schedules repeatedly call the paid model [FIXED]

- **Location:** Coolify sandbox scheduled tasks `sse-exec` and `sse-patch` (external configuration; no repository file or line)
- **Severity:** high
- **What is wrong:** A prior debugging session left two enabled `* * * * *` Coolify tasks that rebuilt/executed a temporary Node probe. Each execution sent three direct requests to `https://openrouter.ai/api/v1/chat/completions` using the same grade 5 water-cycle outline prompt, so the probe repeated billable Haiku calls every minute outside the app's bounded retry logic.
- **Trigger:** Deploy or run the sandbox app while the schedules remain enabled. The `sse-*` helper tasks reassemble `/tmp/s.cjs`; `sse-exec` and `sse-patch` each run it every minute, and the script invokes probe variants A, B and C.
- **Fix:** Deleted all 32 `sse-*` sandbox scheduled tasks. Also deleted the remaining production `dns-probe-4` test schedule. Both lesson apps remain stopped.

## Operational findings

- The Coolify MCP configuration already present in `opencode.json` was used. The production `openmaic` application remains stopped. The sandbox deployment of commit `f46062b1` was canceled after the user reported repeated paid model completions, and the sandbox application is stopped (`container_present: false`).
- The production and sandbox applications use the same `OPENROUTER_API_KEY` value (compared by fingerprint only), so provider usage cannot be attributed to one deployment from the key alone.
- The user supplied a provider activity excerpt with repeated completions for the same 10,683-token prompt: an Ultra Mode grade 5 water-cycle outline. The shown requests finish normally (`stop`) and cost about $0.0023–$0.003 each. The excerpt has no request IDs or deployment metadata, and Coolify cannot provide runtime logs after the app container was stopped, so the originating process/run cannot be established.
- The current outline path in `lib/server/generation/steps/outline.ts` explicitly disables SDK retries and caps its own path at two primary attempts plus one fallback. The repeated completions came from the out-of-repository Coolify schedules recorded in B6, not from that bounded outline retry path. The earlier agent's temporary probe script made three direct Haiku requests per execution. No further lesson-generation request was submitted after the activity report; the planned low-cost test was withheld.
- Coolify scheduled-task lists were checked for every application. All 32 sandbox `sse-*` tasks and the production `dns-probe-4` task were deleted; production, sandbox, and curriculum KB now have zero scheduled tasks. One unrelated scheduled task remains on the separate vocabulary API application and was left untouched.
- The sandbox initially had no curriculum KB credentials, so its catalog endpoint returned `503 not_configured`. Read-only KB access was added for the requested test.
- The curriculum database application tracks `xi24ix/OpenMAIC.git:main`; its corpus is held on a persistent Coolify volume and is intentionally absent from Git. Its deployment cleanup had removed the active `corpus5` directory (B4). The cleanup was fixed, the local v5 corpus bundle was verified against the configured full-bundle checksum, and the database was restored from that bundle.
- After restoration, the curriculum API health endpoint returned HTTP 200, the sandbox catalog returned 73 courses, and a Grade 11 plant-growth selection prepared with 13,073 characters of curriculum context and two visuals. The sandbox's deployed app code at that time was commit `50edd61a`; the later `f46062b1` timeout-fix deployment was canceled. Production remains stopped.
- The sandbox picker screenshot showed its catalog request loading while the curriculum API was unavailable. B5 bounds curriculum requests so this outage path returns an error rather than waiting indefinitely; the timeout-fix code has not been deployed to either lesson app.

## Summary

| ID | File | Severity | One-line description |
|---|---|---|---|
| B1 [FIXED] | `lib/server/generation/run/retry.ts:24` | high | Later scene steps now allow three total attempts. |
| B2 [FIXED] | `packages/@openmaic/generation/src/generation-retry.ts:21` | high | Default generation retry budget now allows three total requests. |
| B3 [FIXED] | `lib/server/generation/steps/outline.ts:721` | high | Outline streams no longer stack explicit retries with SDK retries. |
| B4 [FIXED] | `knowledge-base-curiculum/compose.yaml:9` | critical | Database deployment cleanup now preserves the live `corpus5` volume directory. |
| B5 [FIXED] | `lib/server/curriculum-kb.ts:139` | medium | Curriculum API requests now time out instead of leaving the picker loading forever. |
| B6 [FIXED] | Coolify sandbox scheduled tasks `sse-exec` / `sse-patch` (external configuration) | high | Two per-minute probe schedules repeatedly sent three billable Haiku requests. |

**Total bugs: 6**
