import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { openDatabase } from '../src/database.js';
import type { Extraction, ImportManifest } from '../src/contracts.js';
import { CurriculumRepository } from '../src/repository.js';
import { createCurriculumServer } from '../src/server.js';

function fixture(): { manifest: ImportManifest; extraction: Extraction } {
  return {
    manifest: {
      schemaVersion: 1,
      course: { country: 'KW', curriculum: 'kuwait-public', academicYear: '2026/2027', grade: 11, track: 'scientific', subject: 'mathematics', semester: 1, edition: 'HTTP fixture', language: 'ar' },
      resource: { id: 'book', title: 'Fixture book', kind: 'student_book', sourceUrl: 'https://example.test/book.pdf', publisher: 'Test', rightsNote: 'Private reference test', access: 'private_reference' },
      units: [{ id: 'u1', title: 'Unit 1', order: 1, lessons: [{ id: 'l1', title: 'Lesson 1', order: 1, objectives: ['Objective'], segments: [{ page: 1 }], visuals: [{ id: 'v1', page: 1, bbox: [0, 0, 0.5, 0.5], kind: 'diagram', caption: 'Diagram', purpose: 'Evidence' }] }] }],
      review: { curriculumVerified: true, contentVerified: true, reviewer: 'test', evidence: 'fixture' },
    },
    extraction: {
      versionId: 'extract-http', sourceSha256: 'a'.repeat(64), originalKey: 'originals/book.pdf', pageCount: 1, extractor: 'test',
      pages: [{ page: 1, width: 100, height: 100, text: 'page', textStatus: 'native' }],
      lessons: [{ lessonId: 'l1', segments: [{ page: 1, text: 'Lesson text', textStatus: 'native' }], visualIds: ['v1'] }],
      assets: [{ id: 'v1', objectKey: 'assets/v1.png', sha256: 'b'.repeat(64), mimeType: 'image/png', width: 1, height: 1, page: 1, bbox: [0, 0, 0.5, 0.5], kind: 'diagram', caption: 'Diagram', purpose: 'Evidence', lessonIds: ['l1'] }],
      warnings: [],
    },
  };
}

test('HTTP routes, auth, asset confinement, and MCP smoke flow', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'curriculum-server-'));
  const database = await openDatabase({ dataDir: path.join(root, 'db') });
  const repository = new CurriculumRepository(database);
  await repository.initialize();
  const imported = await repository.importResource(...Object.values(fixture()) as [ImportManifest, Extraction]);
  await mkdir(path.join(root, 'assets'), { recursive: true });
  await writeFile(path.join(root, 'assets', 'v1.png'), Buffer.from([137, 80, 78, 71]));
  const server = createCurriculumServer({ repository, assetRoot: root, apiToken: 'test-token' });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Server did not expose a TCP address');
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { authorization: 'Bearer test-token' };
  try {
    assert.equal((await fetch(`${base}/healthz`)).status, 401);
    const catalogResponse = await fetch(`${base}/v1/catalog`, { headers });
    assert.equal(catalogResponse.status, 200);
    assert.equal((await catalogResponse.json() as { total: number }).total, 1);
    const contextResponse = await fetch(`${base}/v1/lesson-context`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ courseId: imported.courseId, lessonId: 'l1' }) });
    assert.equal(contextResponse.status, 200);
    assert.equal((await contextResponse.json() as { primaryContent: Array<{ text: string }> }).primaryContent[0].text, 'Lesson text');
    const unitContextResponse = await fetch(`${base}/v1/unit-context`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ courseId: imported.courseId, unitId: 'u1', lessonId: 'l1', allowUnverified: false }) });
    assert.equal(unitContextResponse.status, 200);
    const unitContext = await unitContextResponse.json() as { lessons: Array<{ id: string }>; primaryContent: Array<{ lessonId?: string }> };
    assert.deepEqual(unitContext.lessons.map((lesson) => lesson.id), ['l1']);
    assert.equal(unitContext.primaryContent[0].lessonId, 'l1');
    const searchResponse = await fetch(`${base}/v1/search`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ query: 'Lesson text', courseId: imported.courseId }) });
    assert.equal(searchResponse.status, 200);
    assert.equal((await searchResponse.json() as { total: number }).total, 1);
    const pageResponse = await fetch(`${base}/v1/resources/${encodeURIComponent(imported.resourceVersionId)}/pages/1`, { headers });
    assert.equal(pageResponse.status, 200);
    assert.equal((await pageResponse.json() as { text: string }).text, 'page');
    const assetResponse = await fetch(`${base}/v1/assets/${encodeURIComponent(`${imported.resourceVersionId}:asset:v1`)}`, { headers });
    assert.equal(assetResponse.status, 200);
    assert.equal(assetResponse.headers.get('content-type'), 'image/png');
    const unverifiedImported = await repository.importResource({ ...fixture().manifest, resource: { ...fixture().manifest.resource, id: 'unverified-book' }, review: { curriculumVerified: false, contentVerified: false } }, { ...fixture().extraction, versionId: 'extract-unverified', sourceSha256: 'c'.repeat(64) });
    const hiddenUnverifiedAsset = await fetch(`${base}/v1/assets/${encodeURIComponent(`${unverifiedImported.resourceVersionId}:asset:v1`)}`, { headers });
    assert.equal(hiddenUnverifiedAsset.status, 404);
    const evaluationAsset = await fetch(`${base}/v1/assets/${encodeURIComponent(`${unverifiedImported.resourceVersionId}:asset:v1`)}?allowUnverified=true`, { headers });
    assert.equal(evaluationAsset.status, 200);
    const mcpResponse = await fetch(`${base}/mcp`, { method: 'POST', headers: { ...headers, accept: 'application/json, text/event-stream', 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) });
    assert.equal(mcpResponse.status, 200);
    const mcpBody = await mcpResponse.json() as { result: { tools: Array<{ name: string }> } };
    assert.ok(mcpBody.result.tools.some((tool) => tool.name === 'kw_lesson_context_get'));
    assert.ok(mcpBody.result.tools.some((tool) => tool.name === 'kw_unit_context_get'));
    const mcpUnitResponse = await fetch(`${base}/mcp`, { method: 'POST', headers: { ...headers, accept: 'application/json, text/event-stream', 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'kw_unit_context_get', arguments: { courseId: imported.courseId, unitId: 'u1', lessonId: 'l1' } } }) });
    assert.equal(mcpUnitResponse.status, 200);
    const mcpUnitBody = await mcpUnitResponse.json() as { result: { content: Array<{ text: string }> } };
    const mcpUnitContext = JSON.parse(mcpUnitBody.result.content[0].text) as { lessons: Array<{ id: string }> };
    assert.deepEqual(mcpUnitContext.lessons.map((lesson) => lesson.id), ['l1']);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await database.close();
    await rm(root, { recursive: true, force: true });
  }
});
