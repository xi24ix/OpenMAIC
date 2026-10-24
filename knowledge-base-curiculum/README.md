# Kuwait Curriculum Knowledge Base Service

This folder contains the service integration layer for the existing curriculum repository. It exposes the repository's deterministic catalog, lesson-context, coverage, and asset retrieval through authenticated HTTP routes and read-only MCP tools.

## Local run

```sh
cp .env.example .env
pnpm install
pnpm kb init
pnpm dev
```

The default local database is PGlite under `./data`. Set `KB_DATABASE_URL` to use PostgreSQL instead. Set `KB_API_TOKEN` to require `Authorization: Bearer <token>` (or `x-api-key`) on every route, including `/healthz` and `/mcp`.

## Import

An import uses a validated manifest and extraction JSON. The optional asset root verifies that every extraction `objectKey` is a regular file confined under that root.

```sh
pnpm kb import manifest.json extraction.json [asset-root]
pnpm kb coverage
```

For PDF-derived data, the asset root is normally the staging output directory (`assets/` lives directly under it).

## Local OCR extraction

Build the macOS Vision helper once, then extract a book into a staging directory. The helper emits OCR lines plus QR/barcode boxes; the extractor caches OCR per page and writes `manifest.json`, `extraction.json`, `report.json`, and `assets/`.

```sh
scripts/build-vision-ocr.sh
python3 scripts/extract_book.py \
  --pdf book.pdf --out /path/to/staging/book-id \
  --book-id 5027 --grade 10 --term 1 --subject mathematics \
  --title "الرياضيات - كتاب الطالب" --kind student_book \
  --ocr-bin scripts/bin/vision-ocr
pnpm kb import /path/to/staging/book-id/manifest.json \
  /path/to/staging/book-id/extraction.json /path/to/staging/book-id
```

`--kind workbook` and `--kind exam` fall back to page chunks when no TOC is detected. OCR extraction requires macOS; the deployed service only serves pre-extracted data.

## HTTP surface

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/healthz` | Service health |
| GET | `/v1/catalog` | Paginated catalog (`offset`, `limit`) |
| POST | `/v1/selections/resolve` | Resolve a partial course selection |
| GET | `/v1/units/{courseId}/{unitId}` | Unit and ordered lesson manifest |
| POST | `/v1/lesson-context` | Cited lesson context with pagination |
| POST | `/v1/unit-context` | Cited context for every lesson in a unit, with pagination |
| POST | `/v1/search` | Search active authorized lesson blocks with citations |
| GET | `/v1/resources/{resourceVersionId}/pages/{page}` | Authorized page evidence and visual references |
| GET | `/v1/coverage` | Coverage counts |
| GET | `/v1/assets/{assetId}` | Confined PNG asset delivery |
| POST | `/mcp` | MCP Streamable HTTP JSON-RPC |

The service limits JSON request bodies to 1 MB. Asset delivery uses the object key recorded in the database, rejects traversal and absolute paths, and checks the resolved file again to prevent symlink escapes.

## MCP tools

The `/mcp` endpoint uses the installed `@modelcontextprotocol/sdk` Streamable HTTP transport in stateless mode. It exposes read-only tools: `kw_curriculum_list`, `kw_curriculum_resolve`, `kw_unit_get`, `kw_lesson_context_get`, `kw_unit_context_get`, `kw_resources_search`, `kw_source_page_get`, and `kw_coverage_get`.

## Coolify / Docker

```sh
cp .env.example .env
docker compose up --build -d
docker compose logs -f curriculum-kb
```

For Coolify, deploy this directory as a Docker Compose application, keep the database private, mount persistent storage for `/app/data`, set `KB_API_TOKEN` as a secret, and expose only the HTTP port through TLS. Run `node dist/src/cli.js init` once against a fresh persistent volume before importing content.

## Checks

### Initial private corpus transfer

`scripts/bundle-corpus.py --staging staging --out staging/corpus.ndjson.gz`
creates a portable bundle and prints its SHA-256 digest. Keep it out of Git.
For a new persistent volume, set runtime-only `KB_BOOTSTRAP_URL` (HTTPS),
`KB_BOOTSTRAP_TOKEN` (Bearer authentication), `KB_BOOTSTRAP_SHA256`, and
`KB_BOOTSTRAP_ROOT=/app/data/corpus`. Set `KB_DATA_DIR=/app/data/corpus/db`
and `KB_ASSET_ROOT=/app/data/corpus`. The service validates the download digest,
imports all books with their existing review flags, verifies every asset, and
atomically publishes the completed corpus before listening. Existing completed
corpora are never reimported. Remove transfer variables and retire the transfer
server after verifying deployment. Retain `KB_API_TOKEN` for API authentication.
Back up the persistent volume separately; the bootstrap is not a backup service.

```sh
pnpm typecheck
pnpm build
pnpm test
```
