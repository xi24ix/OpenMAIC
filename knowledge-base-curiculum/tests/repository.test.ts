import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openDatabase } from '../src/database.js';
import { CurriculumRepository } from '../src/repository.js';
import type { Extraction, ImportManifest } from '../src/contracts.js';

function fixture(verified = true, sourceSha256 = 'a'.repeat(64), resourceKind: ImportManifest['resource']['kind'] = 'student_book'): { manifest: ImportManifest; extraction: Extraction } {
  const manifest: ImportManifest = {
    schemaVersion: 1, course: { country: 'KW', curriculum: 'kuwait-public', academicYear: '2026/2027', grade: 11, track: 'scientific', subject: 'mathematics', semester: 1, edition: 'Pilot', language: 'ar' },
    resource: { id: resourceKind, title: resourceKind, kind: resourceKind, sourceUrl: `https://example.test/${resourceKind}.pdf`, publisher: 'Test', rightsNote: 'Private reference test', access: 'private_reference' },
    units: [{ id: 'u1', title: 'Unit 1', order: 1, lessons: [{ id: 'l1', title: 'Lesson 1', order: 1, objectives: ['Objective'], segments: [{ page: 1 }], visuals: [{ id: 'v1', page: 1, bbox: [0, 0, 0.5, 0.5], kind: 'diagram', caption: 'Diagram', purpose: 'Evidence' }] }] }],
    review: verified ? { curriculumVerified: true, contentVerified: true, reviewer: 'reviewer', evidence: 'fixture evidence' } : { curriculumVerified: false, contentVerified: false },
  };
  const extraction: Extraction = { versionId: `extract-${sourceSha256.slice(0, 4)}`, sourceSha256, originalKey: `${resourceKind}.pdf`, pageCount: 1, extractor: 'test', pages: [{ page: 1, width: 100, height: 100, text: 'page', textStatus: 'native' }], lessons: [{ lessonId: 'l1', segments: [{ page: 1, text: 'A block of lesson text.', textStatus: 'native' }], visualIds: ['v1'] }], assets: [{ id: 'v1', objectKey: 'private/v1.png', sha256: 'b'.repeat(64), mimeType: 'image/png', width: 10, height: 10, page: 1, bbox: [0, 0, 0.5, 0.5], kind: 'diagram', caption: 'Diagram', purpose: 'Evidence', lessonIds: ['l1'] }], warnings: [] };
  return { manifest, extraction };
}

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'curriculum-repository-'));
  const db = await openDatabase({ dataDir: dir });
  const repository = new CurriculumRepository(db);
  await repository.initialize();
  return { dir, db, repository };
}

test('imports idempotently and persists after reopening', async () => {
  const { dir, db, repository } = await setup();
  try {
    const firstFixture = fixture();
    const first = await repository.importResource(firstFixture.manifest, firstFixture.extraction);
    const secondFixture = fixture();
    const second = await repository.importResource(secondFixture.manifest, secondFixture.extraction);
    assert.deepEqual(first, second);
    assert.equal((await repository.listCatalog()).length, 1);
    const unit = await repository.getUnit(first.courseId, 'u1');
    assert.equal(unit?.lessons[0].id, 'l1');
    await db.close();
    const reopenedDb = await openDatabase({ dataDir: dir });
    const reopened = new CurriculumRepository(reopenedDb);
    const context = await reopened.getLessonContext({ courseId: first.courseId, lessonId: 'l1', maxChars: 500, offset: 0, includeSupplementary: true, allowUnverified: false });
    assert.equal(context.status, 'ready');
    assert.equal(context.primaryContent[0].citation.page, 1);
    await reopenedDb.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('versions the same source by extraction and mapping identity', async () => {
  const { dir, db, repository } = await setup();
  try {
    const firstFixture = fixture(true, 'a'.repeat(64));
    const first = await repository.importResource(firstFixture.manifest, firstFixture.extraction);
    const reextracted = fixture(true, 'a'.repeat(64));
    reextracted.extraction.lessons[0].segments[0].text = 'Re-extracted content.';
    const second = await repository.importResource(reextracted.manifest, reextracted.extraction);
    assert.notEqual(first.resourceVersionId, second.resourceVersionId);
    const duplicate = await repository.importResource(reextracted.manifest, reextracted.extraction);
    assert.deepEqual(duplicate, second);
    assert.equal((await repository.getLessonContext({ courseId: first.courseId, lessonId: 'l1', maxChars: 500, offset: 0, includeSupplementary: false, allowUnverified: false })).primaryContent[0].text, 'Re-extracted content.');
  } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('unverified imports cannot replace a verified active version or expose its assets', async () => {
  const { dir, db, repository } = await setup();
  try {
    const verified = fixture(true, 'g'.repeat(64));
    const active = await repository.importResource(verified.manifest, verified.extraction);
    const unverified = fixture(false, 'h'.repeat(64));
    unverified.extraction.lessons[0].segments[0].text = 'Unverified replacement.';
    const candidate = await repository.importResource(unverified.manifest, unverified.extraction);
    const context = await repository.getLessonContext({ courseId: active.courseId, lessonId: 'l1', maxChars: 500, offset: 0, includeSupplementary: false, allowUnverified: false });
    assert.equal(context.status, 'ready');
    assert.equal(context.primaryContent[0].text, 'A block of lesson text.');
    assert.equal(await repository.getAsset(`${candidate.resourceVersionId}:asset:v1`), null);
    assert.ok(await repository.getAsset(`${active.resourceVersionId}:asset:v1`));
  } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('gates review, keeps supplements distinct, and scopes asset access', async () => {
  const { dir, db, repository } = await setup();
  try {
    const primaryFixture = fixture(false);
    const primary = await repository.importResource(primaryFixture.manifest, primaryFixture.extraction);
    const supplement = fixture(true, 'c'.repeat(64), 'workbook');
    const supplementResult = await repository.importResource(supplement.manifest, supplement.extraction);
    const unavailable = await repository.getLessonContext({ courseId: primary.courseId, lessonId: 'l1', maxChars: 500, offset: 0, includeSupplementary: true, allowUnverified: false });
    assert.equal(unavailable.status, 'not_available');
    const evaluation = await repository.getLessonContext({ courseId: primary.courseId, lessonId: 'l1', maxChars: 500, offset: 0, includeSupplementary: true, allowUnverified: true });
    assert.equal(evaluation.status, 'partial');
    assert.ok(evaluation.warnings.length);
    assert.equal(evaluation.supportingMaterial.length, 1);
    assert.equal((await repository.getAsset(`${supplementResult.resourceVersionId}:asset:v1`))?.lessonIds[0], 'l1');
    assert.equal(await repository.getAsset('v1'), null);
  } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('paginates at block boundaries and reports oversized blocks', async () => {
  const { dir, db, repository } = await setup();
  try {
    const f = fixture();
    f.extraction.lessons[0].segments = [{ page: 1, text: 'x'.repeat(800), textStatus: 'native' }, { page: 1, text: 'second', textStatus: 'native' }];
    const imported = await repository.importResource(f.manifest, f.extraction);
    const page = await repository.getLessonContext({ courseId: imported.courseId, lessonId: 'l1', maxChars: 500, offset: 0, includeSupplementary: false, allowUnverified: false });
    assert.equal(page.primaryContent.length, 1);
    assert.ok(page.warnings.some((warning) => warning.includes('exceeds maxChars')));
    assert.equal(page.pagination.nextOffset, 1);
    const next = await repository.getLessonContext({ courseId: imported.courseId, lessonId: 'l1', maxChars: 500, offset: 1, includeSupplementary: false, allowUnverified: false });
    assert.equal(next.primaryContent[0].text, 'second');
  } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('supersedes one resource version without mixing courses or assets', async () => {
  const { dir, db, repository } = await setup();
  try {
    const firstFixture = fixture(true, 'd'.repeat(64));
    const first = await repository.importResource(firstFixture.manifest, firstFixture.extraction);
    const replacement = fixture(true, 'e'.repeat(64));
    replacement.extraction.lessons[0].segments[0].text = 'Replacement version only.';
    const second = await repository.importResource(replacement.manifest, replacement.extraction);
    const context = await repository.getLessonContext({ courseId: first.courseId, lessonId: 'l1', maxChars: 500, offset: 0, includeSupplementary: false, allowUnverified: false });
    assert.equal(context.primaryContent[0].text, 'Replacement version only.');
    assert.equal(context.primaryContent.some((block) => block.text === 'A block of lesson text.'), false);
    assert.notEqual(first.resourceVersionId, second.resourceVersionId);

    const other = fixture(true, 'f'.repeat(64));
    other.manifest.course = { ...other.manifest.course, grade: 12 };
    const otherImport = await repository.importResource(other.manifest, other.extraction);
    const firstAsset = await repository.getAsset(`${second.resourceVersionId}:asset:v1`);
    const otherAsset = await repository.getAsset(`${otherImport.resourceVersionId}:asset:v1`);
    assert.equal(await repository.getAsset(`${first.resourceVersionId}:asset:v1`), null);
    assert.ok(firstAsset && otherAsset);
    assert.notEqual(firstAsset.id, otherAsset.id);
    assert.equal((await repository.getLessonContext({ courseId: otherImport.courseId, lessonId: 'l1', maxChars: 500, offset: 0, includeSupplementary: false, allowUnverified: false })).primaryContent[0].citation.resourceVersionId, otherImport.resourceVersionId);
  } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('reports missing lesson segments and visual assets as unavailable or partial', async () => {
  const { dir, db, repository } = await setup();
  try {
    const missingAll = fixture(true, 'i'.repeat(64));
    missingAll.extraction.lessons[0].segments = [];
    missingAll.extraction.lessons[0].visualIds = [];
    missingAll.extraction.assets = [];
    const imported = await repository.importResource(missingAll.manifest, missingAll.extraction);
    const unavailable = await repository.getLessonContext({ courseId: imported.courseId, lessonId: 'l1', maxChars: 500, offset: 0, includeSupplementary: false, allowUnverified: false });
    assert.equal(unavailable.status, 'not_available');
    assert.ok(unavailable.warnings.some((warning) => warning.includes('extraction segment')));
    assert.ok(unavailable.warnings.some((warning) => warning.includes('visual asset')));

    const missingAsset = fixture(true, 'j'.repeat(64));
    missingAsset.extraction.assets = [];
    missingAsset.extraction.lessons[0].visualIds = [];
    const partialImport = await repository.importResource(missingAsset.manifest, missingAsset.extraction);
    const partial = await repository.getLessonContext({ courseId: partialImport.courseId, lessonId: 'l1', maxChars: 500, offset: 0, includeSupplementary: false, allowUnverified: false });
    assert.equal(partial.status, 'partial');
    assert.ok(partial.warnings.some((warning) => warning.includes('visual asset')));
  } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('rolls back a failed import without leaving cross-scope rows', async () => {
  const { dir, db, repository } = await setup();
  try {
    const failed = fixture(true, 'k'.repeat(64));
    failed.extraction.pages.push({ ...failed.extraction.pages[0] });
    await assert.rejects(() => repository.importResource(failed.manifest, failed.extraction));
    assert.equal((await repository.listCatalog()).length, 0);
  } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('accepts OCR text as ready and serves unit context grouped by lesson', async () => {
  const { dir, db, repository } = await setup();
  try {
    const ocrFixture = fixture(true, 'l'.repeat(64));
    ocrFixture.extraction.pages[0].textStatus = 'ocr';
    ocrFixture.extraction.lessons[0].segments[0].textStatus = 'ocr';
    const imported = await repository.importResource(ocrFixture.manifest, ocrFixture.extraction);
    const lesson = await repository.getLessonContext({ courseId: imported.courseId, lessonId: 'l1', maxChars: 500, offset: 0, includeSupplementary: false, allowUnverified: false });
    assert.equal(lesson.status, 'ready');
    assert.equal(lesson.primaryContent[0].textStatus, 'ocr');
    const unit = await repository.getUnitContext({ courseId: imported.courseId, unitId: 'u1', maxChars: 500, offset: 0, includeSupplementary: false, allowUnverified: false });
    assert.equal(unit.status, 'ready');
    assert.equal(unit.unit?.title, 'Unit 1');
    assert.equal(unit.lessons[0].id, 'l1');
    assert.equal(unit.primaryContent[0].lessonId, 'l1');
    assert.equal(unit.primaryContent[0].textStatus, 'ocr');
    assert.equal(unit.visuals[0].lessonIds[0], 'l1');
    const coverage = await repository.getCoverage();
    assert.equal(coverage.contentBlocks, 1);
    assert.equal(coverage.readyLessons, 1);
  } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
});
