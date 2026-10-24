import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createCanvas, type Canvas } from '@napi-rs/canvas';
import { NapiCanvasFactory, loadPdfjs } from './pdfjs-runtime.js';
import type { ImportManifest, BBox, Extraction, ExtractedPage, ExtractedLesson, VisualAsset } from './contracts.js';

const EXTRACTOR = 'pdfjs-dist@4.8.69+napi-canvas@0.1.88';
const MAX_INPUT_BYTES = 500 * 1024 * 1024;
const MAX_DOCUMENT_PAGES = 500;
const MAX_SELECTED_PAGES = 200;
const MAX_PAGE_PIXELS = 32_000_000;
const MAX_TOTAL_RENDER_PIXELS = 160_000_000;
const DEFAULT_SCALE = 1.5;
const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const require = createRequire(import.meta.url);
const STANDARD_FONT_DATA_URL = `${path.dirname(require.resolve('pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf'))}${path.sep}`;

type TextFragment = {
  str: string;
  bbox: BBox;
  dir?: string;
  hasEOL?: boolean;
  order: number;
};

type PageRender = {
  page: number;
  width: number;
  height: number;
  canvas: Canvas;
  text: string;
  textStatus: 'native' | 'needs_ocr';
  fragments: TextFragment[];
};

function sha256(data: Uint8Array | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function assertFiniteNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
}

function validateBBox(bbox: readonly number[], label: string): BBox {
  if (bbox.length !== 4) throw new Error(`${label} must have four normalized values`);
  for (const value of bbox) assertFiniteNumber(value, `${label} value`);
  const [x, y, w, h] = bbox;
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || x > 1 || y > 1 || w > 1 || h > 1 || x + w > 1.000001 || y + h > 1.000001) {
    throw new Error(`${label} must be a normalized top-left crop within the page`);
  }
  return [x, y, w, h];
}

function validatePage(page: number, pageCount: number, label: string): void {
  if (!Number.isInteger(page) || page < 1 || page > pageCount) {
    throw new Error(`${label} page ${page} is outside the PDF page range 1-${pageCount}`);
  }
}

function multiplyMatrices(a: number[], b: number[]): number[] {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function applyMatrix(matrix: number[], x: number, y: number): [number, number] {
  return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
}

function textBBox(item: { transform: number[]; width: number; height: number }, viewport: { transform: number[]; width: number; height: number }): BBox {
  const matrix = multiplyMatrices(viewport.transform, item.transform);
  const points = [applyMatrix(matrix, 0, 0), applyMatrix(matrix, item.width, 0), applyMatrix(matrix, 0, item.height), applyMatrix(matrix, item.width, item.height)];
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const left = Math.max(0, Math.min(...xs));
  const top = Math.max(0, Math.min(...ys));
  const right = Math.min(viewport.width, Math.max(...xs));
  const bottom = Math.min(viewport.height, Math.max(...ys));
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  return [left / viewport.width, top / viewport.height, Math.min(1 - left / viewport.width, width / viewport.width), Math.min(1 - top / viewport.height, height / viewport.height)];
}

function intersects(a: BBox, b: BBox): boolean {
  return a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
}

function formatText(fragments: TextFragment[]): string {
  let result = '';
  let previous: TextFragment | undefined;
  for (const fragment of fragments) {
    if (!fragment.str) continue;
    if (result && previous) {
      const yDelta = Math.abs(fragment.bbox[1] - previous.bbox[1]);
      const lineHeight = Math.max(fragment.bbox[3], previous.bbox[3]);
      if (previous.hasEOL || yDelta > lineHeight * 0.65) result += '\n';
      else if (!/^[\s,.;:!?%)]/.test(fragment.str) && !/[\s([{]$/.test(result)) result += ' ';
    }
    result += fragment.str;
    previous = fragment;
  }
  return result.trim();
}

function textForBBox(fragments: TextFragment[], bbox?: BBox): string {
  return formatText(fragments.filter(fragment => !bbox || intersects(fragment.bbox, bbox)));
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function atomicWrite(filePath: string, data: string | Uint8Array): Promise<void> {
  const temp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, data, { mode: 0o600 });
  await fs.rename(temp, filePath);
}

function cropCanvas(source: Canvas, bbox: BBox): Canvas {
  const x = Math.floor(bbox[0] * source.width);
  const y = Math.floor(bbox[1] * source.height);
  const right = Math.min(source.width, Math.ceil((bbox[0] + bbox[2]) * source.width));
  const bottom = Math.min(source.height, Math.ceil((bbox[1] + bbox[3]) * source.height));
  const width = Math.max(1, right - x);
  const height = Math.max(1, bottom - y);
  const result = createCanvas(width, height);
  const context = result.getContext('2d');
  context.drawImage(source, x, y, width, height, 0, 0, width, height);
  return result;
}

async function saveAsset(canvas: Canvas, dataDir: string): Promise<{ objectKey: string; sha256: string; width: number; height: number }> {
  const bytes = canvas.encodeSync('png');
  const digest = sha256(bytes);
  const objectKey = `assets/${digest}.png`;
  const filePath = path.join(dataDir, objectKey);
  await ensureDir(path.dirname(filePath));
  try {
    await fs.access(filePath);
  } catch {
    await atomicWrite(filePath, bytes);
  }
  return { objectKey, sha256: digest, width: canvas.width, height: canvas.height };
}

function lessonEntries(manifest: ImportManifest): Array<{ lessonId: string; lesson: ImportManifest['units'][number]['lessons'][number] }> {
  return manifest.units.flatMap(unit => unit.lessons.map(lesson => ({ lessonId: lesson.id, lesson })));
}

/** Extract native PDF text and manifest-mapped, rendered visual assets. */
export async function extractPdf(input: { pdfPath: string; dataDir: string; manifest: ImportManifest; scale?: number; maxPages?: number }): Promise<Extraction> {
  const scale = input.scale ?? DEFAULT_SCALE;
  if (!Number.isFinite(scale) || scale < MIN_SCALE || scale > MAX_SCALE) throw new Error(`scale must be between ${MIN_SCALE} and ${MAX_SCALE}`);
  if (input.maxPages !== undefined && (!Number.isInteger(input.maxPages) || input.maxPages < 1 || input.maxPages > MAX_SELECTED_PAGES)) throw new Error(`maxPages must be an integer from 1 to ${MAX_SELECTED_PAGES}`);

  const sourceStat = await fs.stat(input.pdfPath);
  if (!sourceStat.isFile()) throw new Error(`PDF path is not a file: ${input.pdfPath}`);
  if (sourceStat.size <= 0 || sourceStat.size > MAX_INPUT_BYTES) throw new Error(`PDF input must be between 1 byte and ${MAX_INPUT_BYTES} bytes`);
  const sourceBytes = await fs.readFile(input.pdfPath);
  const sourceSha256 = sha256(sourceBytes);
  await ensureDir(path.join(input.dataDir, 'originals'));
  await ensureDir(path.join(input.dataDir, 'assets'));
  const originalKey = `originals/${sourceSha256}.pdf`;
  const originalPath = path.join(input.dataDir, originalKey);
  try {
    const existing = await fs.readFile(originalPath);
    if (sha256(existing) !== sourceSha256) throw new Error(`Content-addressed original is immutable but has unexpected contents: ${originalKey}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await atomicWrite(originalPath, sourceBytes);
  }

  const extractionSettings = { extractor: EXTRACTOR, scale, maxPages: input.maxPages ?? null };
  const versionId = `pdf-${sourceSha256.slice(0, 20)}-${sha256(Buffer.from(canonicalJson({ manifest: input.manifest, extractionSettings }))).slice(0, 28)}`;
  const warnings: string[] = [];
  const lessons = lessonEntries(input.manifest);
  const requestedPages = new Set<number>();
  for (const { lesson } of lessons) {
    for (const segment of lesson.segments) {
      if (!Number.isInteger(segment.page) || segment.page < 1) throw new Error(`Lesson ${lesson.id} has invalid page ${segment.page}`);
      requestedPages.add(segment.page);
      if (segment.bbox) validateBBox(segment.bbox, `Lesson ${lesson.id} segment`);
    }
    for (const visual of lesson.visuals) {
      if (visual.bbox) validateBBox(visual.bbox, `Visual ${visual.id}`);
      requestedPages.add(visual.page);
    }
  }
  if (!requestedPages.size) throw new Error('Manifest does not select any PDF pages');

  const { getDocument } = await loadPdfjs();
  let loadingTask: any;
  let document: any;
  try {
    loadingTask = getDocument({ data: new Uint8Array(sourceBytes), disableWorker: true, stopAtErrors: true, maxImageSize: MAX_PAGE_PIXELS, isEvalSupported: false, standardFontDataUrl: STANDARD_FONT_DATA_URL, CanvasFactory: NapiCanvasFactory } as any);
    document = await loadingTask.promise;
  } catch (error) {
    try { await loadingTask?.destroy?.(); } catch { /* cleanup must not mask parse errors */ }
    const message = error instanceof Error ? error.message : String(error);
    if (/password|encrypted|encryption/i.test(message)) throw new Error('Encrypted or password-protected PDFs are not supported');
    throw new Error(`Unable to parse PDF: ${message}`);
  }

  try {
    const pageCount = document.numPages as number;
    if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > MAX_DOCUMENT_PAGES) throw new Error(`PDF page count exceeds the limit of ${MAX_DOCUMENT_PAGES}`);
    for (const page of requestedPages) validatePage(page, pageCount, 'Manifest');
    const selectedPages = [...requestedPages].sort((a, b) => a - b);
    const pagesToExtract = input.maxPages ? selectedPages.slice(0, input.maxPages) : selectedPages;
    if (pagesToExtract.length > MAX_SELECTED_PAGES) throw new Error(`Manifest selects more than the ${MAX_SELECTED_PAGES}-page extraction limit`);
    if (pagesToExtract.length < selectedPages.length) warnings.push(`maxPages limited extraction to pages ${pagesToExtract.join(', ')}`);

    const rendered = new Map<number, PageRender>();
    let totalPixels = 0;
    for (const pageNumber of pagesToExtract) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const width = Math.ceil(viewport.width);
      const height = Math.ceil(viewport.height);
      if (width < 1 || height < 1 || width * height > MAX_PAGE_PIXELS) throw new Error(`Rendered page ${pageNumber} exceeds the ${MAX_PAGE_PIXELS}-pixel limit`);
      totalPixels += width * height;
      if (totalPixels > MAX_TOTAL_RENDER_PIXELS) throw new Error(`Selected pages exceed the ${MAX_TOTAL_RENDER_PIXELS}-pixel render limit`);
      const canvas = createCanvas(width, height);
      const context = canvas.getContext('2d');
      const renderTask = page.render({ canvasContext: context as any, viewport, background: 'white', intent: 'print' });
      try {
        await renderTask.promise;
      } catch (error) {
        try { renderTask.cancel(); } catch { /* already finished */ }
        throw error;
      }
      const textContent = await page.getTextContent({ disableNormalization: false });
      const fragments: TextFragment[] = [];
      let order = 0;
      let hasRtl = false;
      for (const item of textContent.items as Array<any>) {
        if (!('str' in item) || typeof item.str !== 'string' || !item.str) continue;
        const bbox = textBBox(item, viewport);
        fragments.push({ str: item.str, bbox, dir: item.dir, hasEOL: item.hasEOL, order: order++ });
        if (item.dir === 'rtl' || /[\u0590-\u08ff]/u.test(item.str)) hasRtl = true;
      }
      if (hasRtl) warnings.push(`Page ${pageNumber}: RTL text is kept in PDF.js document order; positioned bboxes should be used for display.`);
      const text = formatText(fragments);
      const textStatus = text.trim() ? 'native' : 'needs_ocr';
      if (textStatus === 'needs_ocr') warnings.push(`Page ${pageNumber} has no native text; OCR is required and was not performed.`);
      rendered.set(pageNumber, { page: pageNumber, width, height, canvas, text, textStatus, fragments });
    }

    const pages: ExtractedPage[] = [];
    const assets: VisualAsset[] = [];
    for (const pageNumber of pagesToExtract) {
      const page = rendered.get(pageNumber)!;
      pages.push({ page: page.page, width: page.width, height: page.height, text: page.text, textStatus: page.textStatus });
      const saved = await saveAsset(page.canvas, input.dataDir);
      assets.push({ id: `page-${pageNumber}`, objectKey: saved.objectKey, sha256: saved.sha256, mimeType: 'image/png', width: saved.width, height: saved.height, page: pageNumber, bbox: [0, 0, 1, 1], kind: 'page', caption: `Page ${pageNumber} preview`, purpose: 'Use the full rendered textbook page as source context.', lessonIds: lessons.filter(({ lesson }) => lesson.segments.some(segment => segment.page === pageNumber) || lesson.visuals.some(visual => visual.page === pageNumber)).map(({ lessonId }) => lessonId) });
    }

    for (const { lessonId, lesson } of lessons) {
      for (const visual of lesson.visuals) {
        if (!pagesToExtract.includes(visual.page)) continue;
        const page = rendered.get(visual.page)!;
        const bbox = validateBBox(visual.bbox, `Visual ${visual.id}`);
        const saved = await saveAsset(cropCanvas(page.canvas, bbox), input.dataDir);
        const existing = assets.find(asset => asset.id === visual.id);
        if (existing) throw new Error(`Duplicate visual id ${visual.id}`);
        assets.push({ id: visual.id, objectKey: saved.objectKey, sha256: saved.sha256, mimeType: 'image/png', width: saved.width, height: saved.height, page: visual.page, bbox, kind: visual.kind, caption: visual.caption, purpose: visual.purpose, lessonIds: [lessonId] });
      }
    }

    const extractedLessons: ExtractedLesson[] = lessons.map(({ lessonId, lesson }) => {
      const segments = lesson.segments.flatMap(segment => {
        if (!pagesToExtract.includes(segment.page)) return [];
        const page = rendered.get(segment.page)!;
        const bbox = segment.bbox ? validateBBox(segment.bbox, `Lesson ${lessonId} segment`) : undefined;
        return [{ page: segment.page, ...(bbox ? { bbox } : {}), text: textForBBox(page.fragments, bbox), textStatus: page.textStatus }];
      });
      return { lessonId, segments, visualIds: lesson.visuals.filter(visual => pagesToExtract.includes(visual.page)).map(visual => visual.id) };
    });
    const extraction: Extraction = { versionId, sourceSha256, originalKey, pageCount, extractor: EXTRACTOR, pages, lessons: extractedLessons, assets, warnings: [...new Set(warnings)] };
    const manifestPath = path.join(input.dataDir, 'extractions', `${versionId}.json`);
    await ensureDir(path.dirname(manifestPath));
    await atomicWrite(manifestPath, JSON.stringify(extraction, null, 2));
    return extraction;
  } finally {
    try { await document.destroy(); } catch { /* cleanup must not mask extraction errors */ }
  }
}
