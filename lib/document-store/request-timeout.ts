/**
 * The client-side DocumentStore request deadline, as the deployment configured
 * it (`NEXT_PUBLIC_DOCUMENT_REQUEST_TIMEOUT_MS`, inlined at build time).
 *
 * The package floor (`DEFAULT_REQUEST_TIMEOUT_MS`, two minutes) exists to
 * catch a request that never settles — it is not a statement that a request
 * taking that long is wrong. A deployment that knows its server can
 * legitimately keep a document read pending for longer than the floor — a
 * single-host deployment whose app process is busy generating scenes — sets
 * the variable: a positive value is the new floor in milliseconds, `0` (or
 * any non-positive value) removes the bound entirely, and an unset or
 * malformed value leaves the package default in place.
 */
export function clientDocumentRequestTimeoutMs(): number | undefined {
  const raw = process.env.NEXT_PUBLIC_DOCUMENT_REQUEST_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === '') return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}
