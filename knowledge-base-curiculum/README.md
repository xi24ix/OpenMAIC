# Kuwait Curriculum Knowledge Base

Authenticated curriculum retrieval service for the Kuwait public-school secondary curriculum. The service stores a deterministic curriculum catalog, page-level extracted text, lesson context, source citations, and textbook visuals. It exposes the same retrieval logic through HTTP and a read-only MCP endpoint.

The service is intentionally separate from the main OpenMAIC application. It has its own database lifecycle, persistent content volume, authentication token, deployment, and review state.

## Current production deployment

| Item | Value |
| --- | --- |
| Public URL | `https://kwdb.zobeidi.com` |
| Coolify project | `kuwait-curriculum-kb` |
| Coolify application | `kuwait-curriculum-kb` |
| Coolify application UUID | `lcgipmxidt1feeqzzklkvg7y` |
| Repository | `https://github.com/xi24ix/OpenMAIC.git` |
| Repository base directory | `/knowledge-base-curiculum` |
| Compose file | `/compose.yaml` |
| Health route | `/healthz` |
| Internal service port | `3000` |
| Deployment model | Coolify Docker Compose application |
| Data store | PGlite on persistent storage |
| Runtime status | `running:healthy` |

The deployed application uses an external persistent volume and the Coolify Docker network. The Compose file also contains explicit Traefik labels because the deployment uses a custom start command to remove orphan containers safely.

### Production corpus status

The current corpus contains **57 textbook/workbook resources**. It does not yet contain the 632 exam PDFs from the downloaded inventory.

| Metric | Current value |
| --- | ---: |
| Courses | 47 |
| Units | 56 |
| Lessons | 573 |
| Content blocks | 99,834 |
| Visual assets | 8,330 |
| Active resource versions | 57 |
| Curriculum-verified versions | 0 |
| Content-verified versions | 0 |
| Ready lessons | 0 |

All imported resources remain `private_reference` and unverified. This is deliberate: the extraction pipeline has produced reviewable evidence, but no human curriculum/content review has been recorded yet. Requests using `allowUnverified: true` are private evaluation requests and are not publication-ready.

## What the service provides

- Exact course selection by country, curriculum, academic year, grade, track, subject, semester, and edition.
- Ordered units and lessons with stable scoped identifiers.
- Lesson context and unit context with page citations.
- Native-text and OCR-text status on extracted pages and blocks.
- Source-page evidence and visual references.
- Lexical search over authorized active content blocks.
- Confined PNG asset delivery for verified resources.
- Read-only MCP tools backed by the same repository methods as the HTTP API.
- Idempotent imports with source hashes, extraction identity, mapping identity, and review gating.
- PGlite for local/single-container use, with PostgreSQL supported through `KB_DATABASE_URL`.

## Repository layout

```text
knowledge-base-curiculum/
├── database/                 SQL migrations
├── scripts/
│   ├── extract_book.py       PDF/OCR/TOC/figure extraction
│   ├── extract-corpus.py     Inventory-driven book orchestrator
│   ├── bundle-corpus.py      Authenticated deployment bundle creator
│   ├── vision-ocr.swift      macOS Vision OCR helper
│   ├── build-vision-ocr.sh   Builds the OCR helper
│   └── import-moe-highschool.ts  Legacy inventory importer
├── src/
│   ├── contracts.ts          Zod contracts and public types
│   ├── database.ts           PGlite/PostgreSQL abstraction
│   ├── repository.ts         Import and retrieval logic
│   ├── server.ts             HTTP and MCP server
│   ├── cli.ts                Local CLI
│   └── bootstrap.ts          One-time authenticated corpus restore
├── tests/                    PDF, repository, HTTP, MCP, and bootstrap tests
├── Dockerfile                Production image
├── compose.yaml              Local/Coolify Compose definition
├── .env.example              Safe local environment template
└── README.md                 This document
```

Generated/private directories are intentionally ignored by Git:

```text
data*/ downloads/ staging/ dist/ node_modules/ scripts/bin/ .env
```

Never commit corpus PDFs, extracted assets, PGlite directories, API tokens, Coolify credentials, or temporary transfer logs.

## Requirements

- Node.js `>=22.19.0`.
- pnpm `10.28.0` or a compatible pnpm version.
- macOS for the Vision OCR extraction pipeline.
- Docker for container builds and Compose deployment.
- A Coolify v4 installation and API token for Coolify deployment operations.

The deployed service does **not** run OCR. OCR is completed before deployment and the container serves pre-extracted data only.

## Local setup

### Install dependencies

```bash
pnpm install --frozen-lockfile
```

### Configure the local service

```bash
cp .env.example .env
```

The service environment is:

```dotenv
KB_HOST=0.0.0.0
KB_PORT=3000
KB_DATA_DIR=./data
KB_ASSET_ROOT=./data
KB_API_TOKEN=
KB_DATABASE_URL=
```

When `KB_API_TOKEN` is set, every HTTP and MCP route, including `/healthz`, requires either:

```http
Authorization: Bearer <KB_API_TOKEN>
```

or:

```http
x-api-key: <KB_API_TOKEN>
```

### Initialize and run

```bash
pnpm kb init --data-dir ./data
pnpm dev
```

The service listens on `http://127.0.0.1:3000` when started with the default configuration.

### Start the production build locally

```bash
pnpm build
KB_API_TOKEN='replace-with-a-local-token' \
KB_DATA_DIR=./data \
KB_ASSET_ROOT=./data \
node dist/src/cli.js serve
```

## Importing one resource

An import consists of:

1. A validated `manifest.json` describing the course, resource, units, lessons, review state, and visual declarations.
2. An `extraction.json` containing pages, text blocks, OCR/native status, visual assets, and warnings.
3. An optional asset root. When supplied, every asset object key is checked for path confinement and file existence before the import begins.

```bash
pnpm kb import \
  /path/to/manifest.json \
  /path/to/extraction.json \
  /path/to/staging/book-5027 \
  --data-dir ./data
```

Inspect coverage after importing:

```bash
pnpm kb coverage --data-dir ./data
```

The importer is idempotent for the same source hash, extraction identity, and mapping identity. A new extraction or mapping creates a new resource version rather than mixing rows from different versions.

## Extracting a book on macOS

The extraction pipeline combines PyMuPDF/native PDF text with macOS Vision OCR. Arabic-dominant or scanned pages prefer OCR; Latin-dominant pages can use native text. Formula-heavy pages keep warnings and page-preview fallbacks because OCR is not a reliable mathematical typesetter.

Build the OCR helper:

```bash
scripts/build-vision-ocr.sh
```

Extract a single book:

```bash
python3 scripts/extract_book.py \
  --pdf downloads/book.pdf \
  --out staging/book-5027 \
  --book-id 5027 \
  --grade 10 \
  --term 1 \
  --subject mathematics \
  --subject-label 'الرياضيات' \
  --title 'الرياضيات - كتاب الطالب' \
  --kind student_book \
  --track general \
  --ocr-bin scripts/bin/vision-ocr \
  --workers 8
```

The output contains:

```text
manifest.json       Validated course/resource/lesson manifest
extraction.json     Pages, blocks, visuals, hashes, and warnings
report.json         TOC mapping, lesson boundaries, figures, warnings
assets/             PNG visual assets
ocr/                Per-page OCR cache
```

Workbook and exam resources without a parsable TOC fall back to page chunks. Student books require at least one lesson extraction.

## Full corpus extraction

The downloaded inventory is stored outside Git under `downloads/moe-highschool/inventory.json`. The orchestrator:

- reads downloaded book records;
- excludes the eight tiny `الفهرس الالكتروني` index PDFs;
- maps Arabic subject labels to stable ASCII slugs;
- infers `student_book` versus `workbook`;
- infers literary/general track where the source metadata makes that possible;
- writes resumable output under `staging/book-{id}`;
- records per-book status in `staging/extraction-progress.json`;
- preserves successful outputs when a later book fails.

Run it sequentially or with the configured per-book OCR workers:

```bash
python3 scripts/extract-corpus.py \
  --inventory downloads/moe-highschool/inventory.json \
  --staging staging \
  --ocr-bin scripts/bin/vision-ocr \
  --workers 8
```

Retry selected books:

```bash
python3 scripts/extract-corpus.py \
  --staging staging \
  --book-id 5027 \
  --book-id 5149 \
  --workers 4
```

Validation checks:

```bash
python3 -m py_compile scripts/extract_book.py scripts/extract-corpus.py
python3 - <<'PY'
import json
from pathlib import Path
from collections import Counter

print(Counter(item['status'] for item in data.values()))
PY
```

## Deployment corpus bundle

The deployed application does not receive corpus files through Git. Build a content-addressed gzip/NDJSON bundle from the local staging outputs:

```bash
python3 scripts/bundle-corpus.py \
  --staging staging \
  --out staging/corpus-deploy.ndjson.gz
```

The command prints the bundle SHA-256. Keep the bundle outside Git. The bundle contains:

- one book record per manifest/extraction pair;
- each unique PNG asset once;
- each asset's SHA-256;
- no source PDFs;
- no API credentials.

The service bootstrap accepts only an HTTPS URL, a Bearer token, and an independently supplied SHA-256. It streams the bundle, verifies its digest, checks every asset digest, imports each book, writes `complete.json`, and does not repeat the import when `complete.json` already exists.

Bootstrap variables are temporary runtime variables:

```dotenv
KB_BOOTSTRAP_URL=https://temporary-transfer.example/corpus.ndjson.gz
KB_BOOTSTRAP_TOKEN=temporary-transfer-token
KB_BOOTSTRAP_SHA256=64-character-lowercase-sha256
KB_BOOTSTRAP_ROOT=/app/data/corpus
KB_DATA_DIR=/app/data/corpus/db
KB_ASSET_ROOT=/app/data/corpus
```

After the deployment reports `Corpus bootstrap complete`:

1. Verify `/healthz`, `/v1/catalog`, `/v1/coverage`, `/v1/unit-context`, and `/mcp`.
2. Remove all `KB_BOOTSTRAP_*` variables from Coolify.
3. Stop and retire the temporary transfer server/tunnel.
4. Keep `KB_API_TOKEN` in Coolify as the long-term service credential.

The bootstrap mechanism is an initial transfer tool, not a backup system. Back up the persistent volume separately.

## Coolify deployment process

### 1. Push the source

The deployable source lives under `knowledge-base-curiculum/` in the OpenMAIC repository. Coolify reads the `main` branch and uses this directory as its base directory.

```bash
```

Do not push `.env`, `staging/`, `data-*`, `downloads/`, or extracted assets.

### 2. Create the Coolify application

Create a separate Coolify project/application rather than attaching this service to the main OpenMAIC application.

Recommended settings:

| Setting | Value |
| --- | --- |
| Build pack | Docker Compose |
| Base directory | `/knowledge-base-curiculum` |
| Compose location | `/compose.yaml` |
| Internal port | `3000` |
| Domain | `https://kwdb.zobeidi.com` |
| Health path | `/healthz` |
| Health host | `127.0.0.1` |
| Health port | `3000` |
| Persistent mount | `/app/data` |
| API token | Coolify secret `KB_API_TOKEN` |

The current deployment uses an external named volume and the external `coolify` network. The Compose file includes explicit Traefik labels for `kwdb.zobeidi.com`.

### 3. Configure runtime variables

Minimum production variables:

```dotenv
KB_HOST=0.0.0.0
KB_PORT=3000
KB_DATA_DIR=/app/data/corpus/db
KB_ASSET_ROOT=/app/data/corpus
KB_API_TOKEN=<strong-random-service-token>
```

Do not use the Coolify management token as `KB_API_TOKEN`. They are separate credentials with different blast radii.

### 4. Handle orphan Compose containers

This deployment has a custom Coolify Compose start command that removes stale containers from previous deployments:

```bash
  --project-name lcgipmxidt1feeqzzklkvg7y \
  --env-file knowledge-base-curiculum/.env \
  -f knowledge-base-curiculum/compose.yaml \
  up -d --remove-orphans
```

If the application is recreated with a different UUID, update the project name and external volume name in `compose.yaml` before deploying. The custom start command is only needed because Coolify had accumulated orphaned containers during the initial setup.

### 5. Verify a deployment

```bash
export KB_URL=https://kwdb.zobeidi.com
export KB_API_TOKEN='replace-locally; do not commit'

curl -sS \
  -H "Authorization: Bearer ${KB_API_TOKEN}" \
  "${KB_URL}/healthz"

curl -sS \
  -H "Authorization: Bearer ${KB_API_TOKEN}" \
  "${KB_URL}/v1/coverage"
```

An unauthenticated request should return `401`. A healthy authenticated request should return `{"status":"ok"}`.

## HTTP API

All routes below require `Authorization: Bearer ${KB_API_TOKEN}` or `x-api-key: ${KB_API_TOKEN}`.

### Health

```bash
curl -sS \
  -H "Authorization: Bearer ${KB_API_TOKEN}" \
  "${KB_URL}/healthz"
```

Response:

```json
{"status":"ok"}
```

### Catalog

```bash
curl -sS \
  -H "Authorization: Bearer ${KB_API_TOKEN}" \
  "${KB_URL}/v1/catalog?offset=0&limit=100"
```

The catalog returns course metadata and ordered units/lessons. Course IDs are stable hashes of the canonical course selection.

### Resolve a partial selection

```bash
curl -sS -X POST \
  -H "Authorization: Bearer ${KB_API_TOKEN}" \
  -H 'content-type: application/json' \
  "${KB_URL}/v1/selections/resolve" \
  -d '{
    "country": "KW",
    "curriculum": "kuwait-public",
    "academicYear": "2026/2027",
    "grade": 10,
    "subject": "mathematics",
    "semester": 1
  }'
```

The response status is one of `matched`, `ambiguous`, or `not_found`. Always handle `ambiguous` explicitly rather than choosing the first result.

### Get a unit manifest

```bash
curl -sS \
  -H "Authorization: Bearer ${KB_API_TOKEN}" \
  "${KB_URL}/v1/units/{courseId}/{unitId}"
```

### Get lesson context

```bash
curl -sS -X POST \
  -H "Authorization: Bearer ${KB_API_TOKEN}" \
  -H 'content-type: application/json' \
  "${KB_URL}/v1/lesson-context" \
  -d '{
    "courseId": "course-6cb122bcc9c6b2666ff82753348ded0021739878",
    "lessonId": "u1-l1",
    "maxChars": 24000,
    "allowUnverified": true
  }'
```

Important request fields:

- `maxChars`: response text budget.
- `offset`: pagination offset for long contexts.
- `includeSupplementary`: include workbook/supplementary material when available.
- `allowUnverified`: private evaluation mode only; omit or set `false` for publication-safe retrieval.

### Get unit context

```bash
curl -sS -X POST \
  -H "Authorization: Bearer ${KB_API_TOKEN}" \
  -H 'content-type: application/json' \
  "${KB_URL}/v1/unit-context" \
  -d '{
    "courseId": "course-6cb122bcc9c6b2666ff82753348ded0021739878",
    "unitId": "u1",
    "lessonId": "u1-l1",
    "maxChars": 48000,
    "allowUnverified": true
  }'
```

`lessonId` is optional. Omit it to retrieve the complete selected unit; provide it to retrieve only that lesson's content and linked visual assets. Both paths use the normalized `(course_id, unit_id, lesson_id)` tables and indexed lookups—no text search is required. The response groups blocks by lesson and includes citations and visual metadata. A `partial` status is expected for unverified or incomplete extraction data. Do not interpret `partial` as a successful publication-ready lesson.

### Search

```bash
curl -sS -X POST \
  -H "Authorization: Bearer ${KB_API_TOKEN}" \
  -H 'content-type: application/json' \
  "${KB_URL}/v1/search" \
  -d '{
    "query": "تنظيم الغلاف الأحيائي",
    "courseId": "course-6cb122bcc9c6b2666ff82753348ded0021739878",
    "limit": 20,
    "allowUnverified": true
  }'
```

### Source-page evidence

```bash
curl -sS \
  -H "Authorization: Bearer ${KB_API_TOKEN}" \
  "${KB_URL}/v1/resources/{resourceVersionId}/pages/17"
```

### Coverage

```bash
curl -sS \
  -H "Authorization: Bearer ${KB_API_TOKEN}" \
  "${KB_URL}/v1/coverage"
```

### Assets

```bash
curl -sS \
  -H "Authorization: Bearer ${KB_API_TOKEN}" \
  "${KB_URL}/v1/assets/{assetId}" \
  -o visual.png
```

Asset delivery is review-gated. Visual metadata can appear in private evaluation context while the binary asset remains unavailable until the associated resource version is curriculum-verified and content-verified.

## MCP API

The curriculum service exposes Streamable HTTP JSON-RPC at:

```text
https://kwdb.zobeidi.com/mcp
```

Use both accepted MCP response types:

```http
Accept: application/json, text/event-stream
```

### Discover tools

```bash
curl -sS -X POST \
  -H "Authorization: Bearer ${KB_API_TOKEN}" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  "${KB_URL}/mcp" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'
```

### Call a curriculum MCP tool

```bash
curl -sS -X POST \
  -H "Authorization: Bearer ${KB_API_TOKEN}" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  "${KB_URL}/mcp" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "kw_unit_context_get",
      "arguments": {
        "courseId": "course-6cb122bcc9c6b2666ff82753348ded0021739878",
        "unitId": "u1",
        "lessonId": "u1-l1",
        "allowUnverified": true,
        "maxChars": 48000
      }
    }
  }'
```

Available read-only curriculum tools:

| Tool | Purpose |
| --- | --- |
| `kw_curriculum_list` | List catalog courses, units, and lessons |
| `kw_curriculum_resolve` | Resolve a partial course selection |
| `kw_unit_get` | Get one ordered unit manifest |
| `kw_lesson_context_get` | Get cited context for one lesson |
| `kw_unit_context_get` | Get cited context grouped across a unit |
| `kw_resources_search` | Search authorized extracted blocks |
| `kw_source_page_get` | Retrieve page-level evidence |
| `kw_coverage_get` | Retrieve ingestion/review coverage |

## Coolify management MCP helper

This project also contains a separate local helper for managing Coolify itself. It is not the curriculum MCP endpoint.

Installed package:

```text
@masonator/coolify-mcp@3.9.0
```

Run the diagnostic:

```bash
pnpm coolify:mcp doctor --json
```

Run the stdio MCP server for a local MCP client:

```bash
pnpm coolify:mcp
```

The local `.env` must contain valid dotenv variables:

```dotenv
COOLIFY_BASE_URL=http://your-coolify-host:8000
COOLIFY_ACCESS_TOKEN=replace-with-coolify-token
```

The helper token is a Coolify management credential. Do not reuse `KB_API_TOKEN`. Do not commit `.env`. The previous stale `opencode.jsonc` remote MCP block was removed; clients should invoke the local package explicitly or use Coolify's built-in `/mcp` endpoint.

Coolify's built-in MCP endpoint is separate:

```text
http://your-coolify-host:8000/mcp
```

Use the built-in endpoint for Coolify infrastructure operations when it is enabled for the team. Use `pnpm coolify:mcp` when a local stdio helper, diagnostics, or additional management tools are needed.

## Security and review model

- Keep the service behind HTTPS and an API token.
- Use a separate `KB_API_TOKEN` from the Coolify management token.
- Keep the database and asset volume private; expose only the HTTP service through TLS.
- Treat source URLs, OCR output, and extracted text as untrusted content.
- Do not grant publication readiness from extraction success alone.
- `curriculum_verified` and `content_verified` must both be true before a resource version is active for normal context and asset retrieval.
- `allowUnverified: true` is for private evaluation and debugging only.
- Never bypass a source login, paywall, CAPTCHA, robots restriction, or other access control.
- Store only redacted operational notes in Git. Credentials belong in local environment variables or Coolify secrets.

## Troubleshooting

### `401 Authentication required`

The service is reachable but the request did not include a valid service token:

```bash
curl -sS \
  -H "Authorization: Bearer ${KB_API_TOKEN}" \
  "${KB_URL}/healthz"
```

### `503 Site not available` from the public domain

Check in this order:

1. Coolify application status is `running:healthy`.
2. The application is attached to the external `coolify` network.
3. The Compose service has explicit Traefik labels for `kwdb.zobeidi.com`.
4. The Traefik proxy was restarted after changing labels or networks.
5. The service is listening on internal port `3000`.
6. The DNS record points to the Coolify server.

The application can be healthy inside Docker while the proxy still returns 503 when the container is not on the proxy network or has no matching Traefik route.

### Application repeatedly restarts

Check for:

- stale/orphaned Compose containers;
- a PGlite lock left by a killed process;
- a missing or incorrectly mounted `/app/data` volume;
- invalid `KB_DATA_DIR` or `KB_ASSET_ROOT` paths;
- a missing `KB_API_TOKEN` when the healthcheck requires authentication;
- incomplete bootstrap data;
- a volume mounted under the wrong generated name.

The Coolify deployment uses `docker compose ... up -d --remove-orphans` to remove stale containers from previous deployments.

### Asset returns `404 Asset is not available`

This is expected for an unverified resource version. The context endpoint may return visual metadata in private evaluation mode while `/v1/assets/{assetId}` remains review-gated. Verify both review flags before treating an asset as publishable.

### OCR extraction fails

Confirm that:

```bash
test -x scripts/bin/vision-ocr
python3 -c 'import pymupdf; print("PyMuPDF available")'
```

Vision OCR requires macOS. Rebuild the helper after changing the Swift source:

```bash
scripts/build-vision-ocr.sh
```

Retry only the failed book with `scripts/extract-corpus.py --book-id ...`. Existing successful books remain resumable.

## Development checks

Run the standard checks before committing:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
```

The test suite covers:

- PDF extraction and page previews;
- OCR/native readiness behavior;
- idempotent and versioned imports;
- review gating and asset scoping;
- unit and lesson context pagination;
- HTTP authentication and asset confinement;
- MCP discovery smoke flow;
- bootstrap checksum, traversal, and persistent restore behavior.

## Operational checklist

### Before extraction

- Confirm the source inventory and rights status.
- Confirm enough disk space for PDFs, OCR caches, PNG assets, and the deployment bundle.
- Build and test the macOS Vision OCR helper.
- Keep staging outside Git.

### Before import

- Validate every manifest and extraction JSON.
- Check for missing output files and control characters.
- Review warning counts, TOC mappings, lesson boundaries, and formula-risk warnings.
- Confirm the asset root contains every referenced object key.

### Before deployment

- Run `pnpm typecheck`, `pnpm build`, and `pnpm test`.
- Push the exact commit Coolify will deploy.
- Verify the Coolify project, application, volume, network, domain, and health path.
- Generate a bundle SHA-256 and keep it privately.
- Set bootstrap variables only for the initial transfer.

### After deployment

- Verify authenticated health.
- Verify unauthenticated requests return `401`.
- Verify catalog count and coverage.
- Verify lesson/unit context and MCP tool discovery.
- Verify asset behavior against the review state.
- Remove bootstrap variables and stop the transfer server/tunnel.
- Record the deployed commit and resource version coverage.

## License and source-use note

This service is an internal/private-reference implementation. The extracted curriculum files originate from external educational sources. Keep source URLs, rights notes, and review evidence attached to every resource. Do not assume that public availability grants permission to redistribute PDFs, extracted text, or images.
