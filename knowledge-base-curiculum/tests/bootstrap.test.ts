import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { bootstrapCorpus, importBundleInto, restoreBundle } from '../src/bootstrap.js';
import { openDatabase } from '../src/database.js';
import { CurriculumRepository } from '../src/repository.js';

test('bootstrap requires HTTPS, a digest and authentication', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'bootstrap-policy-'));
  const options = { root: path.join(root, 'corpus'), url: 'http://example.test/bundle', token: 'test', sha256: 'a'.repeat(64) };
  try {
    await assert.rejects(bootstrapCorpus({ ...options, sha256: '' }), /SHA-256/);
    await assert.rejects(bootstrapCorpus(options), /HTTPS/);
    await assert.rejects(bootstrapCorpus({ ...options, url: 'https://example.test/bundle', token: '' }), /token/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('bundle restore rejects traversal, corrupted assets and empty corpora', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'bootstrap-invalid-'));
  try {
    const cases = [
      { record: { type: 'asset', key: '../escape', data: '' }, error: /Invalid bundle asset key/ },
      { record: { type: 'asset', key: `assets/${'a'.repeat(64)}.png`, data: '', sha256: 'wrong' }, error: /checksum/ },
      { record: null, error: /no books/ },
    ];
    for (const [i, fixture] of cases.entries()) {
      const archive = path.join(root, `${i}.gz`);
      await writeFile(archive, gzipSync(fixture.record ? JSON.stringify(fixture.record) + '\n' : ''));
      await assert.rejects(restoreBundle(archive, path.join(root, `output-${i}`)), fixture.error);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('completed bootstrap does not contact a retired transfer server', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'bootstrap-complete-'));
  try {
    await writeFile(path.join(root, 'complete.json'), '{"books":57}');
    await bootstrapCorpus({ root, url: '', token: '', sha256: '' });
    assert.equal(await readFile(path.join(root, 'complete.json'), 'utf8'), '{"books":57}');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('small bundle restores a persistent corpus without bypassing review', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'bootstrap-valid-'));
  const book = {
    type: 'book',
    manifest: {
      schemaVersion: 1,
      course: { academicYear: '2026/2027', grade: 10, track: 'general', subject: 'biology', semester: 1, edition: 'test' },
      resource: { id: 'book', title: 'Test', kind: 'student_book', sourceUrl: 'https://example.test/book' },
      units: [{ id: 'u1', title: 'Unit', order: 0, lessons: [{ id: 'l1', title: 'Lesson', order: 0, segments: [{ page: 1 }] }] }],
    },
    extraction: {
      versionId: 'test', sourceSha256: 'a'.repeat(64), originalKey: 'book.pdf', pageCount: 1, extractor: 'test',
      pages: [{ page: 1, width: 100, height: 100, text: 'Test', textStatus: 'ocr' }],
      lessons: [{ lessonId: 'l1', segments: [{ page: 1, text: 'Test', textStatus: 'ocr' }], visualIds: [] }],
      assets: [], warnings: [],
    },
  };
  try {
    const archive = path.join(root, 'bundle.gz');
    const output = path.join(root, 'corpus');
    await writeFile(archive, gzipSync(JSON.stringify(book) + '\n'));
    await restoreBundle(archive, output);
    const database = await openDatabase({ dataDir: path.join(output, 'db') });
    try {
      const coverage = await new CurriculumRepository(database).getCoverage();
      assert.equal(coverage.resources, 1);
      assert.equal(coverage.contentBlocks, 1);
      assert.equal(coverage.verifiedActiveVersions, 0);
      assert.equal(coverage.readyLessons, 0);
    } finally { await database.close(); }
    assert.equal(JSON.parse(await readFile(path.join(output, 'complete.json'), 'utf8')).books, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('bundle merge imports into an existing corpus and persists assets', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'bootstrap-merge-'));
  const dataDir = path.join(root, 'db');
  const assetRoot = path.join(root, 'corpus');
  const assetData = Buffer.from('merge-asset');
  const assetSha256 = createHash('sha256').update(assetData).digest('hex');
  const book = {
    type: 'book',
    manifest: {
      schemaVersion: 1,
      course: { academicYear: '2026/2027', grade: 11, track: 'scientific', subject: 'mathematics', semester: 1, edition: 'test' },
      resource: { id: 'book-merge', title: 'Merge test', kind: 'student_book', sourceUrl: 'https://example.test/book-merge' },
      units: [{ id: 'u1', title: 'Unit', order: 0, lessons: [{ id: 'l1', title: 'Lesson', order: 0, segments: [{ page: 1 }], visuals: [{ id: 'v1', page: 1, bbox: [0, 0, 1, 1], kind: 'illustration', caption: 'Merge asset', purpose: 'illustration' }] }] }],
    },
    extraction: {
      versionId: 'merge-test', sourceSha256: 'b'.repeat(64), originalKey: 'book-merge.pdf', pageCount: 1, extractor: 'test',
      pages: [{ page: 1, width: 100, height: 100, text: 'Merge test', textStatus: 'ocr' }],
      lessons: [{ lessonId: 'l1', segments: [{ page: 1, text: 'Merge test', textStatus: 'ocr' }], visualIds: ['v1'] }],
      assets: [{ id: 'v1', objectKey: `assets/${assetSha256}.png`, sha256: assetSha256, mimeType: 'image/png', width: 1, height: 1, page: 1, bbox: [0, 0, 1, 1], kind: 'illustration', caption: 'Merge asset', purpose: 'illustration', lessonIds: ['l1'] }], warnings: [],
    },
  };
  try {
    const database = await openDatabase({ dataDir });
    const repository = new CurriculumRepository(database);
    await repository.initialize();
    try {
      const archive = path.join(root, 'merge-bundle.gz');
      const asset = { type: 'asset', key: `assets/${assetSha256}.png`, sha256: assetSha256, data: assetData.toString('base64') };
      await writeFile(archive, gzipSync(`${JSON.stringify(book)}\n${JSON.stringify(asset)}\n`));
      const result = await importBundleInto({ archive, repository, assetRoot });
      assert.equal(result.books, 1);
      assert.equal(result.assets, 1);
      assert.equal((await repository.getCoverage()).resources, 1);
    } finally { await database.close(); }
    assert.equal((await readFile(path.join(assetRoot, `assets/${assetSha256}.png`))).toString(), assetData.toString());
  } finally { await rm(root, { recursive: true, force: true }); }
});
