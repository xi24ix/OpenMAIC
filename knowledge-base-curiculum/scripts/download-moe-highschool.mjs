import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const origin = 'https://elibrary.moe.edu.kw';
const outputRoot = path.resolve(process.env.MOE_DOWNLOAD_DIR ?? './downloads/moe-highschool');
const delayMs = Number(process.env.MOE_DELAY_MS ?? 100);
const concurrency = Math.max(1, Math.min(8, Number(process.env.MOE_CONCURRENCY ?? 4)));
const maxBytes = Number(process.env.MOE_MAX_BYTES ?? 100 * 1024 * 1024);
const inventoryOnly = process.argv.includes('--inventory-only');

const highSchool = {
  educationTypeId: 8,
  educationStageId: 17,
  grades: [
    { id: 27, label: 'grade-10' },
    { id: 28, label: 'grade-11' },
    { id: 29, label: 'grade-12' },
  ],
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.json();
}

async function search(scope) {
  const response = await getJson(`${origin}/api/librarysearch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      BooksFor: 1,
      MoeYear: 2023,
      EducationTypeID: highSchool.educationTypeId,
      EducationStageID: highSchool.educationStageId,
      EducationGradeID: scope.gradeId,
      EducationSubjectID: scope.subjectId,
      Term: scope.term,
    }),
  });
  return response;
}

function safeName(value) {
  return String(value ?? 'resource')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'resource';
}

async function downloadFile(url, destination) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  const contentType = response.headers.get('content-type') ?? '';
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error(`empty response for ${url}`);
  if (bytes.length > maxBytes) throw new Error(`file exceeds ${maxBytes} bytes for ${url}`);
  if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw new Error(`response is not a PDF (${contentType || 'unknown content type'}) for ${url}`);
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const temp = `${destination}.part`;
  await writeFile(temp, bytes, { flag: 'w' });
  await rename(temp, destination);
  return { bytes: bytes.length, sha256, contentType };
}

async function existingPdf(destination) {
  try {
    const info = await stat(destination);
    if (!info.isFile() || info.size < 5) return null;
    const handle = await open(destination, 'r');
    try {
      const header = Buffer.alloc(5);
      await handle.read(header, 0, 5, 0);
      if (!header.equals(Buffer.from('%PDF-'))) return null;
    } finally {
      await handle.close();
    }
    return { bytes: info.size, sha256: null, contentType: 'application/pdf', resumed: true };
  } catch {
    return null;
  }
}

async function main() {
  await mkdir(outputRoot, { recursive: true });
  const records = [];
  const books = new Map();
  const exams = new Map();

  for (const grade of highSchool.grades) {
    const subjects = (await getJson(`${origin}/api/LibraryLookups/EducationSubjects/${grade.id}`)).data ?? [];
    for (const subject of subjects) {
      for (const term of [1, 2]) {
        const scope = { gradeId: grade.id, gradeLabel: grade.label, subjectId: subject.value, subjectLabel: subject.text.trim(), term };
        try {
          const result = await search(scope);
          for (const book of result.books ?? []) books.set(book.bookFileID, { kind: 'book', scope, item: book });
          for (const exam of result.examFiles ?? []) exams.set(exam.educationExamFileID, { kind: 'exam', scope, item: exam });
        } catch (error) {
          records.push({ kind: 'search', scope, status: 'error', error: String(error) });
        }
        await sleep(delayMs);
      }
    }
  }

  const candidates = [...books.values(), ...exams.values()];
  const inventoryPath = path.join(outputRoot, 'inventory.json');
  if (inventoryOnly) {
    await writeFile(inventoryPath, JSON.stringify({ generatedAt: new Date().toISOString(), source: origin, candidates }, null, 2));
    console.log(JSON.stringify({ inventoryPath, books: books.size, exams: exams.size, total: candidates.length }, null, 2));
    return;
  }

  const writeCheckpoint = async () => {
    const checkpoint = `${inventoryPath}.part`;
    await writeFile(checkpoint, JSON.stringify({
      generatedAt: new Date().toISOString(),
      source: origin,
      scope: 'Kuwait public-school secondary student library: grades 10-12, all listed subjects, semesters 1-2',
      booksDiscovered: books.size,
      examsDiscovered: exams.size,
      records,
    }, null, 2));
    await rename(checkpoint, inventoryPath);
  };

  const downloadCandidate = async (candidate) => {
    const id = candidate.kind === 'book' ? candidate.item.bookFileID : candidate.item.educationExamFileID;
    const fileUrl = candidate.kind === 'book'
      ? `${origin}/api/File/preview/book/${id}`
      : `${origin}/api/File/download/examfile/${id}`;
    const filename = `${candidate.scope.gradeLabel}-term-${candidate.scope.term}-${safeName(candidate.scope.subjectLabel)}-${candidate.kind}-${id}.pdf`;
    const destination = path.join(outputRoot, filename);
    const base = {
      kind: candidate.kind,
      id,
      sourceUrl: `${origin}/StudentsLibrary`,
      downloadUrl: fileUrl,
      scope: candidate.scope,
      item: candidate.item,
      localPath: path.relative(process.cwd(), destination),
      downloadedAt: new Date().toISOString(),
    };
    try {
      const existing = await existingPdf(destination);
      if (existing) {
        records.push({ ...base, status: 'downloaded', ...existing });
        console.log(`already present ${candidate.kind} ${id} ${filename}`);
      } else {
        const file = await downloadFile(fileUrl, destination);
        records.push({ ...base, status: 'downloaded', ...file });
        console.log(`downloaded ${candidate.kind} ${id} ${filename}`);
      }
    } catch (error) {
      records.push({ ...base, status: 'error', error: String(error) });
      console.error(`failed ${candidate.kind} ${id}: ${String(error)}`);
    }
  };

  for (let index = 0; index < candidates.length; index += concurrency) {
    const batch = candidates.slice(index, index + concurrency);
    await Promise.all(batch.map(downloadCandidate));
    await writeCheckpoint();
    await sleep(delayMs);
  }

  await writeCheckpoint();
  console.log(JSON.stringify({ inventoryPath, books: books.size, exams: exams.size, records: records.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
