import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openDatabase } from '../src/database.js';
import { manifestSchema, type Extraction, type ImportManifest } from '../src/contracts.js';
import { extractPdf } from '../src/pdf.js';
import { NapiCanvasFactory, loadPdfjs } from '../src/pdfjs-runtime.js';
import { CurriculumRepository } from '../src/repository.js';

type DownloadRecord = {
  kind: 'book' | 'exam';
  id: number;
  status: string;
  localPath?: string;
  downloadUrl: string;
  scope: { gradeId: number; gradeLabel: string; subjectId: number; subjectLabel: string; term: 1 | 2 };
  item: Record<string, unknown>;
};

type Inventory = { records: DownloadRecord[] };
type Progress = Record<string, { status: 'imported' | 'failed'; error?: string; updatedAt: string }>;

const root = path.resolve(process.env.MOE_DOWNLOAD_DIR ?? './downloads/moe-highschool');
const dataDir = path.resolve(process.env.KB_DATA_DIR ?? './data');
const inventoryPath = path.join(root, 'inventory.json');
const progressPath = path.join(dataDir, 'import-progress.json');
const scale = Number(process.env.MOE_EXTRACTION_SCALE ?? 0.5);
const onlyKind = process.env.MOE_IMPORT_KIND as 'book' | 'exam' | undefined;
const limit = process.env.MOE_IMPORT_LIMIT ? Number(process.env.MOE_IMPORT_LIMIT) : undefined;

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeId(value: string): string {
  return value.normalize('NFKC').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 70) || 'resource';
}

function inferTrack(record: DownloadRecord): 'general' | 'scientific' | 'literary' {
  // The official Grade 11 mathematics pilot cover identifies book 3627 as
  // scientific, while the MOE inventory only labels its scope as grade-11.
  if (record.id === 3627) return 'scientific';
  const text = `${record.scope.gradeLabel} ${record.item.fileDescription ?? ''} ${record.scope.subjectLabel}`;
  if (/علمي|علم/u.test(text)) return 'scientific';
  if (/أدبي|ادبي/u.test(text)) return 'literary';
  return 'general';
}

function inferKind(record: DownloadRecord): 'student_book' | 'workbook' | 'exam' {
  if (record.kind === 'exam') return 'exam';
  return /كراسة|تمارين|workbook/u.test(String(record.item.fileDescription ?? '')) ? 'workbook' : 'student_book';
}

function buildCourse(record: DownloadRecord): ImportManifest['course'] {
  const uploaded = String(record.item.createdDate ?? '').slice(0, 10);
  return {
    country: 'KW',
    curriculum: 'kuwait-public',
    academicYear: '2026/2027',
    grade: Number(record.scope.gradeLabel.replace(/\D/g, '')),
    track: inferTrack(record),
    subject: `subject-${record.scope.subjectId}`,
    semester: record.scope.term,
    edition: `Kuwait MOE student library; listing year ${String(record.item.moeYear ?? 'unknown')}; uploaded ${uploaded || 'unknown'}`,
    language: 'ar',
  };
}

function buildResource(record: DownloadRecord): ImportManifest['resource'] {
  const label = String(record.item.fileDescription ?? `${record.kind} ${record.id}`).trim();
  return {
    id: `${record.kind}-${record.id}`,
    title: label,
    kind: inferKind(record),
    sourceUrl: 'https://elibrary.moe.edu.kw/StudentsLibrary',
    downloadUrl: record.downloadUrl,
    publicationYear: String(record.item.moeYear ?? ''),
    publisher: 'Ministry of Education, State of Kuwait',
    rightsNote: 'Private local study reference retained under the private_reference access mode; not redistributed by this service.',
    access: 'private_reference',
  };
}

function buildManifest(record: DownloadRecord, pageCount: number): ImportManifest {
  const resourceKey = `${record.kind}-${record.id}`;
  const lessons = [] as ImportManifest['units'][number]['lessons'];
  for (let start = 1, order = 0; start <= pageCount; start += 200, order += 1) {
    const end = Math.min(pageCount, start + 199);
    lessons.push({
      id: `${resourceKey}-pages-${start}-${end}`,
      title: `${String(record.item.fileDescription ?? resourceKey)} — pages ${start}-${end}`,
      order,
      objectives: ['Page-indexed source material retained for local study retrieval.'],
      segments: Array.from({ length: end - start + 1 }, (_, index) => ({ page: start + index })),
      visuals: [],
    });
  }
  return manifestSchema.parse({
    schemaVersion: 1,
    course: buildCourse(record),
    resource: buildResource(record),
    units: [{ id: `${resourceKey}-unit`, title: String(record.item.fileDescription ?? resourceKey), order: 0, lessons }],
    review: { curriculumVerified: false, contentVerified: false },
  });
}

async function getPageCount(pdfPath: string): Promise<number> {
  const { getDocument } = await loadPdfjs();
  const bytes = new Uint8Array(await readFile(pdfPath));
  const loadingTask = getDocument({ data: bytes, disableWorker: true, stopAtErrors: true, isEvalSupported: false, CanvasFactory: NapiCanvasFactory } as any);
  const document = await loadingTask.promise;
  try {
    return document.numPages as number;
  } finally {
    await document.destroy();
  }
}

async function extractAllPages(pdfPath: string, manifest: ImportManifest): Promise<Extraction> {
  const chunks = manifest.units[0].lessons;
  const merged: Extraction = {
    versionId: `bulk-${hash(JSON.stringify({ source: pdfPath, manifest, scale })).slice(0, 48)}`,
    sourceSha256: '',
    originalKey: '',
    pageCount: 0,
    extractor: '',
    pages: [],
    lessons: [],
    assets: [],
    warnings: [],
  };
  for (let index = 0; index < chunks.length; index += 1) {
    const chunkManifest = manifestSchema.parse({ ...manifest, units: [{ ...manifest.units[0], lessons: [chunks[index]] }] });
    const extraction = await extractPdf({ pdfPath, dataDir, manifest: chunkManifest, scale, maxPages: 200 });
    if (!merged.sourceSha256) {
      merged.sourceSha256 = extraction.sourceSha256;
      merged.originalKey = extraction.originalKey;
      merged.pageCount = extraction.pageCount;
      merged.extractor = extraction.extractor;
    }
    merged.pages.push(...extraction.pages);
    merged.lessons.push(...extraction.lessons);
    merged.assets.push(...extraction.assets);
    merged.warnings.push(...extraction.warnings);
    console.log(`  extracted chunk ${index + 1}/${chunks.length} (${extraction.pages.length} pages)`);
  }
  merged.warnings = [...new Set(merged.warnings)];
  await mkdir(path.join(dataDir, 'extractions'), { recursive: true });
  await writeFile(path.join(dataDir, 'extractions', `${merged.versionId}.json`), JSON.stringify(merged, null, 2));
  return merged;
}

async function loadProgress(): Promise<Progress> {
  try { return JSON.parse(await readFile(progressPath, 'utf8')) as Progress; } catch { return {}; }
}

async function saveProgress(progress: Progress): Promise<void> {
  const temp = `${progressPath}.part`;
  await writeFile(temp, JSON.stringify(progress, null, 2));
  await rename(temp, progressPath);
}

async function main(): Promise<void> {
  const inventory = JSON.parse(await readFile(inventoryPath, 'utf8')) as Inventory;
  const progress = await loadProgress();
  const records = inventory.records.filter((record) => record.status === 'downloaded' && record.localPath && (!onlyKind || record.kind === onlyKind));
  const selected = limit ? records.slice(0, limit) : records;
  const database = await openDatabase({ databaseUrl: process.env.KB_DATABASE_URL, dataDir });
  const repository = new CurriculumRepository(database);
  await repository.initialize();
  try {
    for (let index = 0; index < selected.length; index += 1) {
      const record = selected[index];
      const key = `${record.kind}:${record.id}`;
      if (progress[key]?.status === 'imported') continue;
      const pdfPath = path.resolve(record.localPath!);
      console.log(`[${index + 1}/${selected.length}] importing ${key} ${pdfPath}`);
      try {
        const pageCount = await getPageCount(pdfPath);
        if (pageCount < 1 || pageCount > 500) throw new Error(`unsupported page count ${pageCount}`);
        const manifest = buildManifest(record, pageCount);
        const extraction = await extractAllPages(pdfPath, manifest);
        await repository.importResource(manifest, extraction);
        progress[key] = { status: 'imported', updatedAt: new Date().toISOString() };
        await saveProgress(progress);
      } catch (error) {
        progress[key] = { status: 'failed', error: String(error), updatedAt: new Date().toISOString() };
        await saveProgress(progress);
        console.error(`  failed ${key}: ${String(error)}`);
      }
    }
  } finally {
    await database.close();
  }
  const summary = Object.values(progress).reduce((acc, item) => { acc[item.status] += 1; return acc; }, { imported: 0, failed: 0 });
  console.log(JSON.stringify({ selected: selected.length, ...summary, progressPath, dataDir }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
