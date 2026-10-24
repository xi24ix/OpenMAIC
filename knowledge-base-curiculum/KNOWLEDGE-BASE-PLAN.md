# Kuwait Secondary Curriculum Knowledge Base

Planning date: 2026-10-21 (Asia/Kuwait)

Status: proposed architecture and implementation plan, not a deployed service.

## 1. Outcome and boundaries

Build a separate, versioned curriculum knowledge service for the existing educational platform. Given an exact curriculum selection, return verified lesson text, mathematical expressions, required visual references, relevant exercises, and supporting resources with page-level citations. Expose the same retrieval logic through an authenticated HTTP API and a read-only MCP server.

The central product is **a verified curriculum catalog with evidence attached**, not a folder of PDFs and not a vector search over unrelated files.

Proposed scope, subject to confirmation:

- Kuwait public-school secondary grades 10, 11, and 12; all applicable subjects and tracks, including distinct scientific/literary offerings where applicable.
- Academic year 2026/2027 as the initial target, not as an assertion that every available document is from that year.
- Both semesters, with official student books, workbooks, teacher guides, curriculum distribution documents, and permitted supplementary resources.
- Historical examinations retained under their original years and mapped to current topics only when compatibility is verified.
- Existing platform UI, lesson generation, playback, and student-account database remain unchanged.
- Special/private-school curricula and other secondary systems are separate future catalogs unless explicitly included.

“All resources” means measurable coverage of an approved source inventory, not a guarantee that every exam or teacher handout on the internet can be discovered or reused.

### Work completed during planning

- Read the ten source entries in `curiculum-sources.md` and sampled their public availability through research tools.
- Inspected public source listings and one resource page's download link; PDF contents and extraction quality remain untested.
- Read relevant Coolify, pgvector, MCP, and extraction documentation.
- Inspected local package metadata and the existing document/RAG interfaces.
- Did not access the private Coolify instance, deploy resources, create a remote Git repository, download PDF files into the workspace, or run an extraction benchmark.
- Downloadability, permission to reuse, current-edition validity, and extraction quality are separate unresolved checks for most documents.

## 2. Source audit and acquisition order

The following is a planning sample, not a completed crawl. Public search/fetch failures are not proof that a site is unavailable to ordinary users. Source URLs are retained in the existing source list; evidence references appear at the end of this document.

| Source | Observation | Proposed treatment |
| --- | --- | --- |
| Ministry student library | Page exposes education type, stage, grade, subject, and semester filters, plus separate books, exams/reviews, and videos sections. Complete filtered catalog not enumerated. [S1] | Highest-priority discovery source; inspect dynamic filtering and verify editions and reuse conditions. |
| Kwedufiles | Root fetch returned 525, but supplied teacher search and linked terms loaded. Teacher search includes historical secondary resources and suspended-lesson listings. Terms restrict reuse. [S5–S6] | One source adapter with teacher search as an additional seed, not a separate corpus. Obtain permission before platform reuse. |
| School Kuwait | Homepage distinguishes old curriculum. Sample resource 29863 exposes grade/subject/semester breadcrumbs, author, size, and download route. [S2, S11] | Pilot a site adapter; use breadcrumbs and PDF evidence, not generic table labels alone. |
| Afdne / Kuwait Afedne | Legacy site links its modern regional portal; both expose educational categories. Legacy homepage also links non-Kuwaiti content. [S3–S4] | Separate adapters/alias handling; explicit country validation; deduplicate content across portals. |
| Kuwaitteacher | Supplied solution page loads grade/subject/semester controls and links other resource categories. [S15] | Secondary candidate pending dynamic-filter, rights, and PDF verification. |
| Almanahj Kuwait | Public taxonomy includes grade/track, subject, semester, year, and resource type. Terms restrict commercial copying/republication without permission. [S12–S13] | Permission-gated supplementary source; do not treat listed year as proof of PDF edition. |
| Mnhj Kuwait | Homepage lists secondary exam samples, summaries, question banks, and answers. [S14] | Secondary discovery source after rights and duplicate checks. |
| Alktab24 | Supplied page loads first- and second-semester category links. [S16] | Follow categories in discovery phase; exact secondary books and editions unverified. |

### Concrete findings that change the design

1. School Kuwait resource 29863 has reliable-looking breadcrumbs, but its generic metadata labels place English under a heading meaning semester and the first semester under a heading meaning subject. Adapter tests must validate category semantics rather than blindly map label/value pairs. The PDF itself was not inspected. [S11]
2. Kwedufiles' teacher page includes listings titled suspended/deleted lessons, dated 2024 and earlier. These support modeling exclusions as versioned rules, but do not establish any current exclusion list. [S5]
3. Afdne's legacy homepage includes links labeled as Omani and Syrian material. Domain membership alone cannot establish Kuwait curriculum membership. [S3]
4. Kwedufiles' fetched terms explicitly restrict reuse of uploaded files; Almanahj's fetched terms restrict commercial copying/republication without permission. Seek a rights decision for intended processing and platform use. This is a source-policy observation, not a legal opinion. [S6, S12]

Earlier conversational claims about specific mathematics PDF year/track mismatches were not substantiated and are not evidence for this plan. No current textbook edition has yet been verified.

### Source registry and permission gate

Each source gets an adapter record: canonical origin, permitted discovery paths, approved download/CDN origins, observed robots policy, terms evidence, contact/license evidence, rate limits, and last review date. Record discovery-page URL and actual file URL separately.

Use explicit rights states: `unknown`, `metadata_only`, `licensed_for_platform`, `publisher_permission`, `restricted`, `revoked`. Rights must include scope: download, extraction, embedding, generated-lesson use, excerpt display, image display, redistribution, and expiry. Unknown is not equivalent to allowed. A human-approved policy decides which operations are permitted.

No bypassing sign-in, paywalls, CAPTCHA, robots restrictions, or access controls. Use a permitted upload/import route or request permission when blocked. Do not represent robots permission as a content license. Defer file-content ingestion if permission to retain or process it is unresolved; an authorized evaluation sample is a separate recorded scope.

## 3. Recommended architecture

### Components

1. **PostgreSQL with pgvector**: catalog, relational links, extracted text, provenance, permissions, ingestion jobs, lexical search, and optional embeddings.
2. **Private S3-compatible object storage**: original PDFs, page renderings, crops, extraction artifacts, and immutable manifests. Choose a supported provider or evaluated self-hosted implementation later; do not embed PDFs in Git or store large binaries in database rows.
3. **TypeScript retrieval service**: shared domain logic behind HTTP and MCP. Separate deployment from the educational platform, with a thin server-side client later.
4. **Ingestion worker**: bounded, resumable discovery/download/extraction/classification jobs. Python is a reasonable isolated extraction-worker option; benchmark it before choosing the extraction stack.
5. **Review workflow**: structured review queues and approval commands first; an administrative UI is optional later, not part of the initial student platform work.

Use a PostgreSQL job table initially to avoid an unnecessary Redis dependency. Workers claim jobs with leases, heartbeats, bounded retries, and deterministic deduplication keys. A crash must not strand a job or create duplicate published records.

Coolify documents a PGVector extension-image option in its PostgreSQL selector. Verify the installed Coolify version, selected database image, CPU architecture, and extension availability before deployment. Installing an extension SQL object cannot supply missing extension binaries. [S7–S8]

No separate vector database is needed for the first release. Start with exact catalog retrieval and indexed lexical search; add embeddings for supplement ranking and topic mapping only after quality evaluation. The primary lesson must not depend on approximate nearest-neighbor recall.

### Repository fit

Local evidence:

- `package.json` already includes TypeScript, `pg`, an S3 SDK, and `@modelcontextprotocol/sdk` declared at `^1.27.1`.
- `lib/rag/types.ts` models resource versions, content hashes, extraction lineage, locators, and workspace/course scoping.
- `lib/rag/index.ts` exports an in-memory lexical provider; this inspection did not establish a persistent curriculum index.
- `lib/document/extract.ts` provides an existing extraction-provider seam.

These are integration opportunities, not proof that the curriculum service already exists. Keep its database lifecycle independent. Do not copy public curriculum content into every user's private material store or weaken existing workspace access controls. A future adapter can expose authorized catalog content alongside private workspace material while keeping their permissions distinct.

## 4. Canonical curriculum model

Hierarchy:

`country → curriculum system → academic-year release → grade → track → subject → semester → course edition → unit → lesson → learning objective`

Canonical IDs are immutable opaque identifiers. Display labels, aliases, ordering, and Arabic/English titles are separate fields. `Unit 1` is never a global identifier. Resolve it only within a specific course edition. An academic year and a book publication year are distinct: a previous print edition may still be officially assigned in a later school year.

Build the initial curriculum tree from reviewed official tables of contents and distribution plans. Never infer the authoritative unit list from filenames, search snippets, or model memory. Store evidence for every approved unit boundary and required/excluded status.

### Proposed tables

| Entity | Important fields and constraints |
| --- | --- |
| `curriculum_releases` | Country/system, academic year, release version, approval status, effective dates, official evidence; one explicit approved default per scope. |
| `courses` | Release, grade, track, subject, semester, language; unique scoped identity, no wildcard track substituted for missing data. |
| `course_editions` | Course, assigned textbook/workbook editions, distribution-plan evidence, revision, publication/approval state. |
| `units`, `lessons`, `learning_objectives` | Parent identity, stable codes, titles, aliases, ordering, curriculum status, cited boundaries. |
| `curriculum_rules` | Inclusion/exclusion/enrichment rules for lessons, exercises, pages, and date ranges; issuer/evidence/reviewer. |
| `sources`, `rights_grants` | Origin, crawl policy, operation-level permission, scope/expiry, review evidence. |
| `resources` | Logical work, kind, publisher/author, language, visibility scope; types include student book, workbook, teacher guide, summary, worksheet, exam, and answer key. |
| `resource_versions` | Immutable file hash, object key, size/MIME, edition/printed year, original metadata, verified metadata, status and provenance. |
| `resource_occurrences` | Multiple source pages and download URLs for the same file; access timestamps, headers, rights provenance. |
| `document_pages`, `content_blocks` | Physical PDF page index and printed page label; ordered text, equations, tables, image/crop references, bounding boxes, extraction lineage and review status. |
| `questions`, `answer_links` | Question/subquestion IDs, marks, stem/figure spans, original exam year/session/region, linked answers with independent evidence. |
| `curriculum_mappings` | Many-to-many links from exact content spans/questions to units, lessons, objectives; confidence, review state, mapping method, reviewer and evidence. |
| `search_chunks`, `embeddings` | Derived block references, normalized search text, chunk policy, model/dimensions/version and index lifecycle. |
| `ingestion_jobs`, `review_tasks` | Job stage, content-addressed idempotency key, attempts, lease, failures, conflict reasons and decisions. |
| `catalog_snapshots`, `retrieval_receipts` | Immutable approved membership and context-bundle hashes; permission epoch and audit metadata without raw private prompts. |

Keep file availability, extraction quality, curriculum verification, and rights eligibility as independent dimensions. A downloaded file is not necessarily publishable.

Important constraints:

- Enforce cross-table scope consistency: lesson/unit/course/release links cannot cross accidentally.
- A document may cover many units; mapping must target individual blocks or question parts, not only entire PDFs.
- A question requiring several units is tagged as multi-unit and excluded from narrow practice unless explicitly allowed.
- Preserve original exam year, track, and publisher even when mapping it to a newer course.
- A common file blob may have multiple licensed occurrences. Deduplication must not merge their permissions into blanket permission.
- Use `draft → reviewed → published → superseded/withdrawn` publication states. Revisions create new records rather than overwrite evidence.
- Revocation overrides historical snapshots: old bundle IDs cannot bypass withdrawn rights or safety restrictions.

## 5. Acquisition and extraction pipeline

### A. Discover and inventory

- Enumerate approved grade/track/subject/semester branches, pagination, sitemaps, and explicit download links with a source-specific adapter.
- Inspect the Ministry library's live filtering behavior before implementing its adapter; do not guess undocumented endpoints.
- Capture source claims and discovery evidence before fetching binaries. Restrict the crawl to curriculum resources, not advertising, comments, student results, or teacher contact directories.
- Queue every discovered candidate with a disposition: permitted, awaiting permission, duplicate, inaccessible, out of scope, or rejected.
- Start conservatively with one concurrent request per origin and a configurable delay; obey stricter published limits, `Retry-After`, and backoff. Save checkpoints so work resumes safely.

### B. Fetch permitted files

- Resolve approved redirects; validate DNS and destination on each hop; reject private, loopback, link-local and cloud-metadata addresses.
- Allow known publisher/CDN origins explicitly. Do not offer a public arbitrary-URL fetch endpoint.
- Enforce download time, byte, page-count, and decompression limits. Validate signatures and MIME rather than trusting `.pdf` extensions.
- Compute SHA-256, save an immutable original, and register all source occurrences. Compare normalized text/page fingerprints later for near duplicates; do not automatically merge different editions.
- Handle corrupt/encrypted/non-PDF downloads explicitly. HTML error pages must not become extracted lessons.
- Store content only in the approved private bucket and bounded worker scratch area. Isolate document parsers without deployment secrets, privileged mounts, or unnecessary network access.

### C. Extract faithfully

Benchmark native PDF extraction against a layout-aware pipeline such as Docling, with a tested Arabic OCR engine for scans. Docling documents layout, OCR, tables, formula and image features, but that is not evidence of adequate accuracy on these Kuwait books. [S9]

Page-level routing:

1. Preserve native text when character quality, reading order, and page coverage are acceptable.
2. OCR scanned pages or low-quality text layers; support mixed native/scanned documents.
3. Escalate difficult equations/tables to an evaluated math-aware or vision extraction route, subject to content permissions and provider approval.
4. Flag uncertain output for human correction rather than silently repair it with generated text.

For Arabic and mathematics:

- Preserve original Unicode text, diacritics, punctuation, Arabic/Western digits, and directional structure in the evidence layer.
- Maintain a separate normalized search representation; never apply aggressive search normalization to quotations, formulas, or recitation text.
- Store equations as verified LaTeX/MathML where possible, together with the original crop and page coordinates.
- Keep figures, graphs, maps, chemical diagrams, and tables tied to their explanatory text. A diagram-dependent problem is not usable merely because its words were extracted.
- Test fractions, roots, superscripts, negative signs, inequalities, vectors, geometry labels, and mixed Arabic/Latin expressions.
- Redact student-identifying annotations from served material when encountered; retain original evidence only if permitted and necessary.
- Tag machine-generated captions/summaries as derived content with source references; never present them as verbatim textbook text.

Save raw extraction JSON and a readable Markdown derivative, extractor/model/version/configuration, timings, and per-page quality results. A re-extraction creates a new artifact version without replacing the original.

### D. Segment and map

- Establish reviewed tables of contents and unit/lesson boundaries first. Use physical PDF pages, printed labels, headings, and intra-page blocks.
- Keep the official lesson's ordered content intact. Search chunks are a secondary derived representation, initially approximately 400–800 tokens with boundary-aware overlap to be tuned on Arabic samples.
- Never split a formula from its definitions, a worked example midway, or a question from its required graph. Store ordered multi-chunk groups for oversized examples.
- Use deterministic edition/page mappings for primary books. Use lexical/semantic candidate matching against reviewed objectives for supplements, followed by review where uncertain.
- Split exams at question/subquestion level. Preserve year, track, session, marks and region if known. Link answer keys only with evidence that they correspond to the same paper/question.
- Do not invent missing official solutions. Generated solutions, if later desired, belong to a separately labeled derived-content pipeline outside the initial corpus.

### E. Review and publish

Publication requires an approved curriculum identity, permitted use, valid provenance, sufficient extraction quality, and reviewed mappings. Review the entire pilot unit manually. Later sampling can reduce workload only after measured agreement, with mandatory review of conflicts and high-risk mathematical content.

Publish a catalog snapshot atomically. Update search indices and caches by version; queries cannot combine a new lesson map with old unreviewed text. Source changes create candidate revisions and a review task, not an automatic switch to “latest.”

## 6. Returning context for a selected unit or lesson

### Deterministic retrieval first

1. Authenticate the caller and determine allowed catalog/private scopes.
2. Resolve exact release, grade, track, subject, semester, and course edition. Ask for missing distinctions; never silently choose scientific versus literary.
3. Resolve a unit/lesson using canonical IDs and a pinned approved snapshot.
4. Retrieve the complete approved primary lesson blocks in reading order using relational mappings, not top-K semantic search.
5. Apply required/excluded/enrichment rules and rights checks at block/question level.
6. Add authorized workbook exercises, teacher explanations, summaries, and historical questions mapped to the same objectives. Clearly label their status and source type.
7. Optionally rank supplements using normalized lexical search plus multilingual embeddings and rank fusion. Exact scope and authorization constraints apply to every candidate.
8. Return evidence, coverage gaps, warnings, and a reproducible bundle identity. Do not claim readiness when core text or a necessary diagram is missing.

PostgreSQL lexical search should start with explicit Arabic-aware normalization and tested tokenization rather than assume English stemming works. pgvector supports hybrid-search composition, but approximate-index filtering can reduce recall; compare supplement retrieval with an exact baseline before enabling approximate indices. [S8]

### Context-bundle contract

Required response fields:

- `schema_version`, `bundle_id`, `snapshot_id`, `resolved_selection`, `status`.
- `curriculum`: verified Arabic/English titles, objectives, required/excluded rules, and edition evidence.
- `primary_content`: ordered source-grounded blocks with text, equations, tables, and relevant visual references.
- `supporting_material`: separately labeled workbook examples, summaries, teacher notes, and questions; provenance for every item.
- `citations`: resource/version/hash, publisher, original year, source page, physical PDF page, printed page label, and block coordinates.
- `quality`: extraction/mapping review state and unresolved caveats, not an uncalibrated model-confidence score.
- `coverage`: expected core blocks/lessons versus supplied, missing resource types, missing figures, and reasons.
- `pagination`: continuation cursor, omitted block IDs, and explicit `truncated` flag.
- `usage_policy`: allowed use and display restrictions; enforce these server-side rather than relying on model obedience.

Statuses: `ready`, `partial`, `needs_selection`, `not_available`, `blocked_by_policy`.

For **Grade 11 → mathematics → Unit 1**, resolve track, semester, year, and edition first. Return a unit manifest containing ordered lesson IDs and objectives; fetch each lesson's content separately or through deterministic pagination. A unit is not necessarily one lesson or one model context window.

Proposed illustrative resolver request (field names are a design, not an existing API; no real unit title is invented here):

```json
{
  "country": "KW",
  "curriculum_system": "public_general",
  "academic_year": "2026/2027",
  "grade": 11,
  "track": "scientific",
  "subject": "mathematics",
  "semester": 1,
  "unit_number": 1,
  "language": "ar"
}
```

If the target course edition is not verified, return `not_available` with the missing evidence; do not supply an older edition under the requested year. If several editions remain valid, return `needs_selection` with permissible choices.

Token-budget behavior: omit optional supplements first, then paginate core content at safe boundaries. Do not silently replace required textbook content with a generated summary. Keep a configured tokenizer and byte limit, and reserve the generator's prompt/output budget outside this service.

Cache by snapshot, resolved selection, inclusion options, budget policy, and authorization/rights version. Expiring asset URLs are delivery metadata, not part of the stable bundle hash. An authenticated asset gateway is preferable where rights can be revoked immediately; otherwise use short-lived signed URLs and document their revocation delay.

## 7. HTTP and MCP interfaces

Implement one retrieval domain layer used by both interfaces; do not build two independent retrieval systems.

### Proposed HTTP surface

| Operation | Purpose |
| --- | --- |
| `GET /v1/catalog` | Paginated approved grades, tracks, subjects, semesters and releases. |
| `POST /v1/selections/resolve` | Convert a user selection into verified canonical IDs or explicit ambiguity. |
| `GET /v1/units/{unit_id}` | Unit manifest and ordered lessons for a selected snapshot. |
| `POST /v1/lesson-context` | Grounded lesson bundle with budget and inclusion controls. |
| `POST /v1/search` | Scoped search across authorized supplementary material. |
| `GET /v1/resources/{resource_version_id}/pages/{page}` | Authorized page evidence or asset reference, not arbitrary bucket access. |
| `GET /v1/coverage` | Approved curriculum coverage and ingest/review gaps. |

### Proposed read-only MCP tools

- `kw_curriculum_list`: browse valid choices with pagination.
- `kw_curriculum_resolve`: resolve scope and disclose missing choices.
- `kw_unit_get`: obtain the unit's ordered lesson manifest.
- `kw_lesson_context_get`: obtain the same context bundle as HTTP.
- `kw_resources_search`: search with mandatory curriculum scope.
- `kw_source_page_get`: inspect an authorized cited page/block.
- `kw_coverage_get`: explain missing or unverified material.

Use validated input/output schemas, concise descriptions, bounded results, and read-only annotations. Never expose arbitrary SQL, arbitrary downloads, deployment tools, or ingestion approvals to the lesson-generation agent. Annotations are hints, not authorization.

Remote transport: authenticated Streamable HTTP over HTTPS at `/mcp`; optionally provide stdio for local development. The current MCP documentation uses a newer protocol revision and SDK conventions than the v1 SDK declared in this repository. Choose and pin a compatible SDK deliberately, test the actual platform client, and avoid silently upgrading the existing app. [S10, S18]

For known server-to-server HTTP clients, use scoped, revocable service credentials. For general remote MCP interoperability, implement the applicable MCP authorization/discovery flow and test the intended clients; do not assume a custom API-key header works in every MCP host. Validate Origin/Host and token audience, and keep the database private.

Retrieved PDFs and text are untrusted source data, not agent instructions. Delimit evidence and ensure it cannot trigger tool calls or modify system behavior. The service should not generate lessons itself; it supplies trustworthy context to the platform's existing generator.

## 8. Coolify deployment and operations

### Recommended production placement

Create a dedicated project, proposed name `kuwait-curriculum-kb`, with separate staging and production environments. Do not reuse or alter the existing platform database by default.

- Provision a standalone PostgreSQL resource using an available compatible PGVector image, or an explicitly pinned custom image if necessary.
- Deploy retrieval API/MCP and ingestion worker from Git as independent services or a service stack; expose only the retrieval gateway through HTTPS.
- Use private database networking and distinct identities for migrations, ingestion writes, published-catalog reads, and backups.
- Attach persistent database storage with mount paths appropriate to the selected PostgreSQL major version; do not copy a volume layout across major upgrades blindly.
- Use an external private object bucket or a separately managed object service. A bucket on the same server is not an off-server backup.
- Run schema migrations once per deployment under a migration lock; use backward-compatible expansion before removing fields.
- Configure health/readiness checks for database access, expected schema version, and required object-store access. A running container is not proof of a usable catalog.

Coolify's database documentation supports private internal connection URLs and database backup management. Its installed version and available service templates have not been checked on the user's server. [S7, S17]

### Deployment sequence and verification

1. Rotate the exposed Coolify credential. Establish approved access without copying credentials into Git, reports, shell history, or chat.
2. Verify server capacity, architecture, TLS/domain, storage destination, and private network before provisioning.
3. Choose repository owner/name/visibility; default recommendation is a separate private repository. Alternatively, keep a self-contained service folder in the existing monorepo.
4. Create staging database, bucket, and scoped identities; verify extension loading, connectivity, and persistent storage.
5. Deploy migrations, API/MCP, and worker; confirm unauthorized requests fail and no database port is publicly exposed.
6. Ingest only the approved pilot; review and publish its snapshot.
7. Test one exact lesson through HTTP and the actual MCP client, then confirm both return equivalent bundle contents and citations.
8. Redeploy/restart services and verify the same lesson still resolves with the same source hashes.
9. Restore database and referenced objects to a disposable environment; verify the bundle end-to-end before production promotion.

No deployments, credentials, external schedules, repository creation, or paid services are authorized merely by this planning document. Collection starts as operator-triggered resumable batches; recurring refresh scheduling is a separate decision.

### Backup, recovery, and observability

- Propose daily encrypted database backups with off-server copies, retention, failure alerts, and restore exercises; record the actual schedule timezone explicitly. Configure only after approval.
- Back up original/derived objects separately, with versioning and manifests; PostgreSQL dumps do not contain the PDFs stored in object storage.
- Keep immutable originals until policy permits deletion. Backups must preserve every object version referenced by retained catalog snapshots, subject to rights/privacy deletion rules.
- Initial proposed recovery objectives: at most 24 hours of metadata loss and restoration within 4 hours, subject to a measured restore drill. If insufficient, design point-in-time recovery rather than claim daily dumps achieve it.
- Monitor queue depth, discovery failures, bytes/pages ingested, OCR failures, review backlog, missing unit coverage, retrieval latency, unauthorized requests, storage growth, and backup age.
- Logs contain IDs, timing, counts, and redacted errors—not credentials, raw student prompts, or complete copyrighted content.

### Capacity and budget are pilot outputs

Do not promise full-corpus cost or completion time before inventory and extraction sampling. Measure:

- Unique files/pages by source, grade, track, subject, semester and resource type.
- Fraction requiring OCR, math-specific extraction, manual review, or licensing.
- Seconds per page, peak worker memory, bytes per original/page image, chunks per page, and review minutes per lesson.
- Serving latency/concurrency with OCR running versus on an isolated worker.
- OCR/embedding provider costs only after the user approves the provider and rates are checked.

Estimate storage from originals + renderings + extraction artifacts + database/index overhead + retained backup copies. Estimate ingestion compute from measured pages per extraction path, not just PDF count. Limit worker concurrency to protect the production platform.

## 9. Git and portability

Suggested separate repository name: `kuwait-curriculum-kb` (proposal only; not created).

Proposed repository layout:

```text
README.md
docs/architecture.md
docs/source-policy.md
docs/operations.md
services/retrieval/
workers/ingestion/
packages/contracts/
database/migrations/
sources/registry.yaml
evaluation/fixtures/
evaluation/gold-cases/
deploy/compose.yaml
deploy/coolify.md
.env.example
.gitignore
```

Commit source code, schema migrations, safe source registry entries, versioned extraction rules, deployment definitions, lockfiles, and synthetic or expressly licensed small test fixtures. Pin production images and model/SDK versions; use configuration rather than hard-coded server addresses.

Do not commit credentials, the operator's Coolify note, downloaded corpus files, database dumps, private licensing correspondence, model caches, or raw logs. Store only redacted permission summaries and stable private evidence references.

A local `.gitignore` was added beside this plan to exclude the credential-bearing note and proposed data/output directories. This does not rotate the exposed token or erase prior copies/history. A scoped `git ls-files` check returned no tracked entries for this folder during planning; broader repository history was not audited. No commit or push was performed.

## 10. Delivery phases and exit criteria

| Phase | Deliverables | Exit criterion |
| --- | --- | --- |
| 0 — Scope and evidence | Confirm grades/tracks/year, corpus permissions, authoritative book list, pilot selection, hosting budget and repository placement. | Approved scope; a permitted primary book and curriculum evidence for the pilot. |
| 1 — Foundation | Database migrations, private object storage, immutable resource records, resumable jobs, source registry and security boundaries. | Repeat ingestion is idempotent; restart loses no approved data; scoped access works. |
| 2 — Vertical pilot | Grade 11 math, selected track, semester 1, Unit 1; official book sections, workbook where available, and permitted supporting examples/questions. | Every pilot lesson boundary and core formula/figure reviewed; all gaps disclosed; not marked ready if core coverage is missing. |
| 3 — Retrieval and MCP | Catalog resolver, unit manifest, lesson bundles, HTTP, MCP, versioned schemas and test client. | Actual client retrieves the correct selected lesson and page evidence; HTTP/MCP parity and negative tests pass. |
| 4 — Subject expansion | Complete the pilot subject across applicable grades/semesters, then other subjects with reviewed curriculum trees. | Per-course coverage reports meet agreed thresholds and reviewers approve release. |
| 5 — Supplementary corpus | Licensed summaries, teacher resources, worksheets, historical exams and linked answer keys. | Question-level mapping validated, original years retained, duplicate sources and rights handled correctly. |
| 6 — Production readiness | Deployment/runbook, alerts, restore drill, capacity measurements and handoff. | Recovery drill, access tests, load tests and pinned-release deployment pass. |

Do not build ten scrapers before proving one whole lesson can be faithfully extracted, classified, retrieved, and cited. During implementation, independent work can be split into database/contracts and ingestion components after the shared schema and acceptance tests are agreed.

### Pilot acceptance tests

These are targets for implementation, not checks already passed:

1. A reviewed catalog resolves the pilot's exact grade, track, subject, semester, year and unit; ambiguity returns explicit choices.
2. Every required pilot lesson is represented with ordered primary content and verifiable physical/printed page references.
3. A Kuwait curriculum reviewer validates every pilot core formula, diagram and lesson boundary before `ready` publication.
4. A curated initial set of at least 30 positive/negative retrieval cases produces no wrong-grade, wrong-track, wrong-semester or wrong-edition core content.
5. Historical questions retain their original dates and appear only when explicitly allowed and reviewed as relevant.
6. Missing answer keys, inaccessible PDFs, excluded topics and unsupported diagrams produce visible gaps, never fabricated content.
7. Re-ingesting the same file from two source URLs does not duplicate published content or merge incompatible rights grants.
8. Invalid credentials, guessed resource IDs and cross-scope requests cannot disclose restricted content.
9. Rights revocation blocks fresh access and invalidates cached bundles; asset-delivery expiry behavior is tested.
10. A hostile instruction embedded in a PDF remains inert source text and does not trigger external actions.
11. A response exceeding its context budget paginates deterministically without dropping core content silently.
12. Restoring database plus objects reconstructs the pilot's bundle with matching hashes; database-only recovery is deliberately tested as insufficient.
13. Both MCP and HTTP retrieve equivalent structured content through the deployed TLS gateway, using the actual platform client versions.
14. Proposed serving target: warmed deterministic context lookup p95 under 2 seconds at 10 concurrent requests, measured on a recorded corpus/hardware configuration and excluding lesson generation. Tune or revise based on results rather than claim this is guaranteed.

### Coverage reporting

Report per course edition: expected official units/lessons, discovered files, permitted files, verified primary lessons, workbook coverage, mapped question count, extraction failures and pending review.

Primary coverage denominator comes from the approved official curriculum tree. If the tree is incomplete, report coverage as unknown/partial rather than calculate a misleading 100%. Supplementary coverage is against the approved discovered inventory, not “all Kuwait files.”

## 11. Decisions needed before implementation

1. Confirm public-school grades 10–12, both tracks where applicable, both semesters, and target academic year 2026/2027.
2. Confirm Grade 11 mathematics as the pilot and choose its track; provide or approve verification of the currently assigned book/distribution plan.
3. Identify the content-rights owner/reviewer and whether licenses already exist for teacher materials; do not assume linked sites grant commercial reuse.
4. Choose a separate private Git repository or self-contained monorepo service. A new remote repository requires an owner/name and explicit creation authorization.
5. Confirm Coolify capacity, private object storage, domain, and approved OCR/embedding providers before spending or deployment.

Recommended next action: complete Phase 0 and a small permission-cleared discovery manifest for the pilot, then build the vertical ingestion-to-context path. Do not start a broad unreviewed scrape.

## 12. Evidence and reference register

These pages were fetched during planning on 2026-10-21. Source observations above refer to page contents, not a completed binary-file audit. Source pages are not authoritative proof of current textbook editions. URLs are recorded for reproducibility; no authentication values are included.

| ID | Source | Location |
| --- | --- | --- |
| S1 | Kuwait Ministry student library | `https://elibrary.moe.edu.kw/StudentsLibrary` |
| S2 | School Kuwait homepage | `https://school-kw.com/` |
| S3 | Afdne legacy portal | `https://afdne.com/` |
| S4 | Kuwait Afedne portal | `https://kw.afedne.com/` |
| S5 | Kwedufiles teacher-specific listing | Third entry in `curiculum-sources.md` |
| S6 | Kwedufiles terms | `https://kwedufiles.com/terms` |
| S7 | Coolify PostgreSQL documentation | `https://coolify.io/docs/databases/postgresql` |
| S8 | pgvector official repository/documentation | `https://github.com/pgvector/pgvector` |
| S9 | Docling official documentation | `https://docling-project.github.io/docling/` |
| S10 | MCP Streamable HTTP specification | `https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http.md` |
| S11 | Sample School Kuwait resource metadata and download link | `https://school-kw.com/file/29863/` |
| S12 | Almanahj terms | `https://almanahj.com/terms` |
| S13 | Almanahj Kuwait catalog | `https://almanahj.com/kw/` |
| S14 | Mnhj Kuwait portal | `https://mnhj-kw.com/` |
| S15 | Kuwaitteacher solution listing | Seventh entry in `curiculum-sources.md` |
| S16 | Alktab24 Kuwait semester index | Tenth entry in `curiculum-sources.md` |
| S17 | Coolify backups documentation | `https://coolify.io/docs/databases/backups` |
| S18 | MCP server-building guide | `https://modelcontextprotocol.io/docs/develop/build-server` |

## 13. Plan review checklist

- [x] Scope is database/knowledge service, not a student-platform redesign.
- [x] Current-year assumptions are separated from verified PDF editions.
- [x] Unit/lesson retrieval is deterministic and primary text is not replaced by vector-search snippets.
- [x] Arabic/math extraction, images, answer keys, provenance, exclusions and historical exams are covered.
- [x] Permission gating, secrets, private networking and untrusted-source handling are specified.
- [x] HTTP and MCP share one contract, with client compatibility explicitly tested later.
- [x] Git source and private corpus/backups are separated.
- [x] Recovery covers both PostgreSQL and object storage.
- [x] Acceptance criteria are targets, not claimed test results.
- [ ] Confirm scope, permissions, pilot edition, repository placement and deployment resources with the owner.
- [ ] Implement and execute the pilot; no corpus or runtime tests have yet passed.
