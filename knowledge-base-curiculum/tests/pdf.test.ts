import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { extractPdf } from '../src/pdf.js';
import type { ImportManifest } from '../src/contracts.js';
import { createPdfFixture } from './pdf-fixture.js';

function manifest(overrides: Partial<ImportManifest> = {}): ImportManifest {
  return {
    schemaVersion: 1,
    course: { country: 'KW', curriculum: 'kuwait-public', academicYear: '2025/2026', grade: 10, track: 'general', subject: 'math', semester: 1, edition: 'test', language: 'en' },
    resource: { id: 'book', title: 'Fixture', kind: 'student_book', sourceUrl: 'https://example.test/book.pdf', publisher: 'Fixture', rightsNote: 'test', access: 'private_reference' },
    units: [{ id: 'unit-1', title: 'Unit', order: 0, lessons: [{ id: 'lesson-1', title: 'Lesson', order: 0, objectives: [], segments: [{ page: 1, bbox: [0, 0, 1, 0.5] }], visuals: [{ id: 'diagram-1', page: 1, bbox: [0.2, 0.35, 0.5, 0.45], kind: 'diagram', caption: 'Fixture diagram', purpose: 'Test crop' }] }] }],
    review: { curriculumVerified: false, contentVerified: false },
    ...overrides,
  };
}

async function fixtureOnDisk(): Promise<{ pdfPath: string; dataDir: string; bytes: Uint8Array }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'curriculum-pdf-'));
  const bytes = await createPdfFixture();
  const pdfPath = path.join(root, 'fixture.pdf');
  await writeFile(pdfPath, bytes);
  return { pdfPath, dataDir: path.join(root, 'data'), bytes };
}

describe('extractPdf', () => {
  it('renders page previews and vector-inclusive manifest crops', async () => {
    const fixture = await fixtureOnDisk();
    const result = await extractPdf({ ...fixture, manifest: manifest(), scale: 1 });
    assert.equal(result.pageCount, 2);
    assert.equal(result.pages.length, 1);
    assert.equal(result.pages[0].textStatus, 'native');
    assert.match(result.pages[0].text, /Native lesson text/);
    assert.equal(result.assets.length, 2);
    const crop = result.assets.find(asset => asset.id === 'diagram-1')!;
    assert.ok(crop.width > 1 && crop.height > 1);
    assert.ok((await readFile(path.join(fixture.dataDir, crop.objectKey))).length > 100);
    assert.equal(result.lessons[0].segments[0].textStatus, 'native');
  });

  it('keeps source and version stable across idempotent extraction', async () => {
    const fixture = await fixtureOnDisk();
    const a = await extractPdf({ ...fixture, manifest: manifest(), scale: 1 });
    const b = await extractPdf({ ...fixture, manifest: manifest(), scale: 1 });
    const changed = manifest();
    changed.units[0].lessons[0].segments[0] = { page: 1, bbox: [0, 0.5, 1, 0.5] };
    const c = await extractPdf({ ...fixture, manifest: changed, scale: 1 });
    assert.equal(a.sourceSha256, createHash('sha256').update(fixture.bytes).digest('hex'));
    assert.equal(a.versionId, b.versionId);
    assert.notEqual(a.versionId, c.versionId);
    assert.equal(a.assets[0].sha256, b.assets[0].sha256);
  });

  it('marks a selected blank/scanned page as needs_ocr', async () => {
    const fixture = await fixtureOnDisk();
    const result = await extractPdf({ ...fixture, manifest: manifest({ units: [{ id: 'unit-1', title: 'Unit', order: 0, lessons: [{ id: 'lesson-1', title: 'Lesson', order: 0, objectives: [], segments: [{ page: 2 }], visuals: [] }] }] }), scale: 1 });
    assert.equal(result.pages[0].textStatus, 'needs_ocr');
    assert.match(result.warnings.join('\n'), /OCR/);
  });

  it('rejects invalid pages and crop bounds', async () => {
    const fixture = await fixtureOnDisk();
    await assert.rejects(() => extractPdf({ ...fixture, manifest: manifest({ units: [{ id: 'unit-1', title: 'Unit', order: 0, lessons: [{ id: 'lesson-1', title: 'Lesson', order: 0, objectives: [], segments: [{ page: 9 }], visuals: [] }] }] }) }), /outside the PDF page range/);
    await assert.rejects(() => extractPdf({ ...fixture, manifest: manifest({ units: [{ id: 'unit-1', title: 'Unit', order: 0, lessons: [{ id: 'lesson-1', title: 'Lesson', order: 0, objectives: [], segments: [{ page: 1 }], visuals: [{ id: 'bad', page: 1, bbox: [0.9, 0.9, 0.3, 0.3], kind: 'diagram', caption: 'bad', purpose: 'bad' }] }] }] }) }), /normalized top-left crop/);
  });
});
